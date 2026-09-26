/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { TssCommand } from '../dist/commands/tts.js';
import { Roles } from '../dist/config.js';
import {
  finishTTSUsage,
  getTTSUsage,
  reserveTTSUsage,
  RESERVATION_TTL_MS,
} from '../dist/lib/ttsUsage.js';

const directory = await mkdtemp(join(tmpdir(), 'tts-usage-test-'));
process.env.TTS_USAGE_FILE = join(directory, 'usage.json');
const originalFetch = globalThis.fetch;
const originalRoles = Object.fromEntries(
  Object.entries(Roles).map(([name, role]) => [name, role.id]),
);
after(async () => {
  globalThis.fetch = originalFetch;
  for (const [name, id] of Object.entries(originalRoles)) Roles[name].id = id;
  await rm(directory, { recursive: true, force: true });
});
beforeEach(async () => {
  await rm(process.env.TTS_USAGE_FILE, { force: true });
  for (const [name, id] of Object.entries(originalRoles)) Roles[name].id = id;
  Roles.MEMBER.id = 'member-role';
  Roles.BILLION.id = 'billion-role';
  globalThis.fetch = originalFetch;
});

function interaction(userId = 'user-1', roles = ['member-role']) {
  const replies = [];
  return {
    user: { id: userId },
    member: { roles: { cache: { has: (id) => roles.includes(id) } } },
    options: { getString: () => 'Hello' },
    replies,
    async reply(value) { replies.push(value); return value; },
    async deferReply() {},
    async editReply(value) { replies.push(value); return value; },
  };
}

function speechService(moderation = 'SAFE', speechOk = true) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (url.endsWith('/chat/completions')) {
      return { ok: true, async json() { return { choices: [{ message: { content: moderation } }] }; } };
    }
    return { ok: speechOk, status: 503, async arrayBuffer() { return new Uint8Array([1, 2, 3]).buffer; } };
  };
  return calls;
}

test('role limits and exhaustion are enforced before speech requests', async () => {
  const calls = speechService();
  for (let i = 0; i < 4; i++) {
    const request = interaction();
    await TssCommand.prototype.chatInputRun(request);
    assert.equal(request.replies.at(-1).embeds.length, 1);
  }
  const blocked = interaction();
  await TssCommand.prototype.chatInputRun(blocked);
  assert.match(blocked.replies.at(-1).content, /MEMBER.*4\/4/);
  assert.equal(calls.length, 8);

  const promoted = interaction('user-1', ['member-role', 'billion-role']);
  await TssCommand.prototype.chatInputRun(promoted);
  assert.match(promoted.replies.at(-1).embeds[0].data.fields[1].value, /BILLION/);
  assert.equal((await getTTSUsage('user-1', Date.now())).count, 5);
});

test('24-hour window resets only after 24 hours', async () => {
  const start = 1_000_000;
  const first = await reserveTTSUsage('user-1', start, 1);
  await finishTTSUsage('user-1', first.usage.lastReset, first.reservationId, false);
  assert.equal((await reserveTTSUsage('user-1', start + 86_400_000, 1)).reservationId, null);
  const reset = await reserveTTSUsage('user-1', start + 86_400_001, 1);
  assert.ok(reset.reservationId);
  assert.equal(reset.usage.lastReset, start + 86_400_001);
});

test('moderation rejection and generation failure refund quota', async (t) => {
  t.mock.method(console, 'error', () => {});
  const calls = speechService('UNSAFE');
  const rejected = interaction();
  await TssCommand.prototype.chatInputRun(rejected);
  assert.match(rejected.replies.at(-1).content, /violates/);
  assert.equal(calls.length, 1);
  assert.equal((await getTTSUsage('user-1', Date.now())).count, 0);

  speechService('SAFE', false);
  const failed = interaction();
  await TssCommand.prototype.chatInputRun(failed);
  assert.match(failed.replies.at(-1), /unavailable/);
  assert.equal((await getTTSUsage('user-1', Date.now())).count, 0);
});

test('concurrent requests cannot both claim the last generation', async () => {
  const results = await Promise.all(
    Array.from({ length: 12 }, () => reserveTTSUsage('user-1', Date.now(), 1)),
  );
  assert.equal(results.filter((result) => result.reservationId).length, 1);
  assert.equal((await getTTSUsage('user-1', Date.now())).count, 1);
});

test('concurrent command requests send only one speech request for the last slot', async () => {
  for (let i = 0; i < 3; i++) {
    const claimed = await reserveTTSUsage('user-1', Date.now(), 4);
    await finishTTSUsage('user-1', claimed.usage.lastReset, claimed.reservationId, false);
  }
  const calls = speechService();
  const requests = [interaction(), interaction()];
  await Promise.all(requests.map((request) => TssCommand.prototype.chatInputRun(request)));
  assert.equal(calls.filter((url) => url.endsWith('/audio/speech')).length, 1);
  assert.equal(requests.filter((request) => request.replies.at(-1).embeds).length, 1);
  assert.equal(requests.filter((request) => /limit/.test(request.replies.at(-1).content)).length, 1);
});

test('unfinished reservation survives restart, then expires and is reclaimed', async () => {
  const start = Date.now();
  const first = await reserveTTSUsage('user-1', start, 1);
  const restartedStore = await import(`../dist/lib/ttsUsage.js?restart=${start}`);
  assert.equal((await restartedStore.reserveTTSUsage('user-1', start + 1, 1)).reservationId, null);
  const recovered = await restartedStore.reserveTTSUsage(
    'user-1', start + RESERVATION_TTL_MS, 1,
  );
  assert.ok(recovered.reservationId);
  assert.equal(recovered.usage.count, 1);
  await restartedStore.finishTTSUsage('user-1', first.usage.lastReset, first.reservationId, true);
  assert.equal((await getTTSUsage('user-1', start + RESERVATION_TTL_MS)).count, 1);
});

test('storage failure never permits an untracked generation', async (t) => {
  t.mock.method(console, 'error', () => {});
  const calls = speechService();
  process.env.TTS_USAGE_FILE = directory;
  try {
    const request = interaction();
    await TssCommand.prototype.chatInputRun(request);
    assert.match(request.replies.at(-1).content, /unavailable/);
    assert.equal(calls.length, 0);
  } finally {
    process.env.TTS_USAGE_FILE = join(directory, 'usage.json');
  }
});

test('failed final storage write prevents audio delivery and pending quota expires', async (t) => {
  t.mock.method(console, 'error', () => {});
  const usageFile = process.env.TTS_USAGE_FILE;
  globalThis.fetch = async (url) => {
    if (url.endsWith('/chat/completions')) {
      return { ok: true, async json() { return { choices: [{ message: { content: 'SAFE' } }] }; } };
    }
    return {
      ok: true,
      async arrayBuffer() {
        process.env.TTS_USAGE_FILE = directory;
        return new Uint8Array([1, 2, 3]).buffer;
      },
    };
  };
  try {
    const request = interaction();
    await TssCommand.prototype.chatInputRun(request);
    assert.match(request.replies.at(-1), /unavailable/);
    assert.equal(request.replies.some((reply) => reply.files), false);
  } finally {
    process.env.TTS_USAGE_FILE = usageFile;
  }
  const pending = await getTTSUsage('user-1', Date.now());
  assert.equal(pending.count, 1);
  assert.equal((await getTTSUsage('user-1', Date.now() + RESERVATION_TTL_MS)).count, 0);
});
