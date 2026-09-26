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
import { beforeEach, test } from 'node:test';
import { ChannelType } from 'discord.js';
import { PollCooldown, cooldowns } from '../dist/preconditions/PollCooldown.js';
import { TssCommand, usageTracker } from '../dist/commands/tts.js';
import { PollCommand } from '../dist/commands/PollCommand.js';
import { ReportCommand } from '../dist/commands/ReportCommand.js';
import { activePolls } from '../dist/lib/pollData.js';
import { runUsageCleanup } from '../dist/lib/usageCleanup.js';

const userId = '123456789012345678';
const hour = 60 * 60 * 1000;
const day = 24 * hour;

beforeEach(() => {
  cooldowns.clear();
  usageTracker.clear();
  activePolls.clear();
});

test('one cleanup pass drops expired poll and TTS entries at their existing boundaries', () => {
  cooldowns.set('expired', 0);
  cooldowns.set('active', 1);
  usageTracker.set('expired', { count: 4, lastReset: 0 });
  usageTracker.set('active', { count: 4, lastReset: 1 });

  runUsageCleanup(hour);
  assert.equal(cooldowns.has('expired'), false);
  assert.equal(cooldowns.has('active'), true);
  assert.equal(usageTracker.has('expired'), true);

  runUsageCleanup(day);
  assert.equal(usageTracker.has('expired'), true);
  runUsageCleanup(day + 1);
  assert.equal(usageTracker.has('expired'), false);
  assert.equal(usageTracker.has('active'), true);
});

test('poll cooldown still blocks repeat creation and allows it after one hour', async (t) => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const replies = [];
  const interaction = {
    user: { id: userId },
    member: { roles: { cache: { some: () => false } } },
    async reply(value) {
      replies.push(value);
    },
  };
  const precondition = {
    ok: () => ({ success: true }),
    error: (value) => ({ success: false, ...value }),
  };

  assert.equal(
    (await PollCooldown.prototype.chatInputRun.call(precondition, interaction))
      .success,
    true,
  );
  now += hour - 1;
  assert.equal(
    (await PollCooldown.prototype.chatInputRun.call(precondition, interaction))
      .success,
    false,
  );
  assert.match(replies[0].content, /another poll/);
  now++;
  runUsageCleanup(now);
  assert.equal(
    (await PollCooldown.prototype.chatInputRun.call(precondition, interaction))
      .success,
    true,
  );
});

test('poll replies can be fetched and edited after creation', async () => {
  const edits = [];
  const replies = [];
  const messageId = '234567890123456789';
  const channelId = '345678901234567890';
  const channel = {
    isTextBased: () => true,
    messages: {
      async fetch(id) {
        assert.equal(id, messageId);
        return {
          async edit(value) {
            edits.push(value);
          },
        };
      },
    },
  };
  const interaction = {
    user: { id: userId },
    channelId,
    options: {
      getString: (name) => (name === 'question' ? 'Ready?' : 'Yes|No'),
    },
    client: {
      channels: {
        async fetch(id) {
          assert.equal(id, channelId);
          return channel;
        },
      },
    },
    async reply(value) {
      replies.push(value);
      return { id: messageId };
    },
  };

  await PollCommand.prototype.create.call({}, interaction);
  assert.equal(activePolls.get(userId).messageId, messageId);
  assert.equal(replies[0].fetchReply, true);
  await PollCommand.prototype.close.call({}, interaction);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].components[0].components[0].data.disabled, true);
  assert.equal(activePolls.has(userId), false);
});

test('TTS quota blocks a fifth request and resets after 24 hours', async (t) => {
  let now = day;
  t.mock.method(Date, 'now', () => now);
  const fetch = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ choices: [{ message: { content: 'UNSAFE' } }] }),
  );
  let deferred = 0;
  const interaction = {
    user: { id: userId },
    member: { roles: { cache: { has: () => false } } },
    options: { getString: () => 'example' },
    async reply(value) {
      return value;
    },
    async deferReply() {
      deferred++;
    },
    async editReply(value) {
      return value;
    },
  };
  usageTracker.set(userId, { count: 4, lastReset: 0 });

  const blocked = await TssCommand.prototype.chatInputRun.call({}, interaction);
  assert.match(blocked.content, /daily speech generation limit/);
  assert.equal(fetch.mock.callCount(), 0);

  now++;
  const reply = await TssCommand.prototype.chatInputRun.call({}, interaction);
  assert.match(reply.content, /cannot be converted/);
  assert.equal(deferred, 1);
  assert.equal(usageTracker.get(userId).count, 0);
  assert.equal(usageTracker.get(userId).lastReset, now);
});

test('report sends through the cached guild channel', async (t) => {
  const previousChannel = process.env.REPORT_CHANNEL;
  t.after(() => {
    if (previousChannel === undefined) delete process.env.REPORT_CHANNEL;
    else process.env.REPORT_CHANNEL = previousChannel;
  });
  process.env.REPORT_CHANNEL = '456789012345678901';
  const sent = [];
  const replies = [];
  const channel = {
    type: ChannelType.GuildText,
    async send(value) {
      sent.push(value);
    },
  };
  await ReportCommand.prototype.chatInputRun.call(
    {},
    {
      options: { getString: (name) => (name === 'reason' ? 'Problem' : 'bug') },
      guild: {
        channels: { cache: new Map([[process.env.REPORT_CHANNEL, channel]]) },
      },
      user: { id: userId, tag: 'tester' },
      async reply(value) {
        replies.push(value);
      },
    },
  );
  assert.equal(sent.length, 1);
  assert.match(replies[0].content, /report has been sent/);
});
