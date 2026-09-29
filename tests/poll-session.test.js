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
import { PollCommand } from '../dist/commands/PollCommand.js';
import { PollButtonHandler } from '../dist/interaction-handlers/PollButtonHandler.js';
import { activePolls } from '../dist/lib/pollData.js';
import {
  checkAndRecordPollCooldown,
  getPoll,
  restorePolls,
} from '../dist/lib/pollSession.js';
import { PollCooldown } from '../dist/preconditions/PollCooldown.js';

const directory = await mkdtemp(join(tmpdir(), 'poll-session-test-'));
process.env.POLL_DATA_FILE = join(directory, 'polls.json');
after(() => rm(directory, { recursive: true, force: true }));
beforeEach(async () => {
  activePolls.clear();
  await rm(process.env.POLL_DATA_FILE, { force: true });
});

const authorId = '123456789012345678';
const messageId = '234567890123456789';

function command(message = messageId, client = {}) {
  let lastReply;
  return {
    user: { id: authorId },
    channelId: '345678901234567890',
    client,
    options: {
      getString(name) {
        return name === 'question' ? 'Which option?' : 'Alpha|Beta';
      },
    },
    async reply(value) {
      lastReply = value;
      return { id: message };
    },
    get lastReply() { return lastReply; },
  };
}

function button(voterId, message = messageId, option = 1) {
  let lastReply;
  return {
    customId: `poll_${authorId}_${option}`,
    message: { id: message },
    user: { id: voterId },
    async deferReply() {},
    async editReply(value) {
      lastReply = value;
      return value;
    },
    get lastReply() { return lastReply; },
  };
}

test('create persists poll details; restart restores Maps and Sets', async () => {
  const request = command();
  await PollCommand.prototype.create(request);
  const stored = await getPoll(authorId);
  assert.equal(stored.authorId, authorId);
  assert.equal(stored.question, 'Which option?');
  assert.deepEqual(stored.options, ['Alpha', 'Beta']);
  assert.equal(stored.channelId, request.channelId);
  assert.equal(stored.messageId, messageId);
  activePolls.clear();
  await restorePolls();
  assert.ok(activePolls.get(authorId).votes instanceof Map);
  assert.ok(activePolls.get(authorId).voters instanceof Set);
});

test('votes persist, duplicate votes are rejected, and results survive restart', async () => {
  await PollCommand.prototype.create(command());
  const vote = button('voter-1');
  await PollButtonHandler.prototype.run(vote);
  assert.match(vote.lastReply.content, /recorded/);
  activePolls.clear();
  await restorePolls();
  assert.equal(activePolls.get(authorId).votes.get(1), 1);
  assert.equal(activePolls.get(authorId).voters.has('voter-1'), true);
  const duplicate = button('voter-1');
  await PollButtonHandler.prototype.run(duplicate);
  assert.match(duplicate.lastReply.content, /already voted/);
  const results = command();
  await PollCommand.prototype.results(results);
  assert.match(results.lastReply.embeds[0].data.description, /Alpha — 1 vote/);
  assert.match(results.lastReply.embeds[0].data.description, /Beta — 0 votes/);
});

test('concurrent votes count once per voter without lost updates', async () => {
  await PollCommand.prototype.create(command());
  const votes = Array.from({ length: 10 }, (_, index) => button(`voter-${index}`));
  votes.push(button('voter-0'));
  await Promise.all(votes.map((vote) => PollButtonHandler.prototype.run(vote)));
  const poll = await getPoll(authorId);
  assert.equal(poll.votes.get(1), 10);
  assert.equal(poll.voters.size, 10);
  assert.equal(activePolls.get(authorId).votes.get(1), 10);
});

test('close deletes storage before confirmation, even if message edit fails', async () => {
  await PollCommand.prototype.create(command());
  const closing = command(messageId, {
    channels: {
      async fetch() {
        return {
          isTextBased: () => true,
          messages: { async fetch() { return { async edit() { throw new Error('edit failed'); } }; } },
        };
      },
    },
  });
  await PollCommand.prototype.close(closing);
  assert.match(closing.lastReply.content, /has been closed/);
  assert.equal(await getPoll(authorId), null);
  activePolls.clear();
  await restorePolls();
  const vote = button('voter-1');
  await PollButtonHandler.prototype.run(vote);
  assert.match(vote.lastReply.content, /no longer accepting/);
});

test('an earlier poll button cannot vote in the same author’s new poll', async () => {
  await PollCommand.prototype.create(command('old-message'));
  await PollCommand.prototype.close(command('old-message'));
  await PollCommand.prototype.create(command('new-message'));
  activePolls.clear();
  await restorePolls();
  const stale = button('voter-1', 'old-message');
  await PollButtonHandler.prototype.run(stale);
  assert.match(stale.lastReply.content, /no longer accepting/);
  assert.equal((await getPoll(authorId)).votes.size, 0);
  const fresh = button('voter-1', 'new-message');
  await PollButtonHandler.prototype.run(fresh);
  assert.match(fresh.lastReply.content, /recorded/);
});

test('cooldown survives restart and expires after one hour', async () => {
  const now = Date.now();
  const request = command();
  request.member = { roles: { cache: { some: () => false } } };
  const precondition = {
    ok: () => ({ allowed: true }),
    error: (value) => ({ allowed: false, ...value }),
  };
  const allowed = await PollCooldown.prototype.chatInputRun.call(precondition, request);
  assert.equal(allowed.allowed, true);
  activePolls.clear();
  await restorePolls();
  const blocked = await PollCooldown.prototype.chatInputRun.call(precondition, request);
  assert.equal(blocked.allowed, false);
  assert.match(request.lastReply.content, /create another poll/);
  assert.equal(await checkAndRecordPollCooldown(authorId, now + 3601000, 3600000), 0);
});

test('poll creation removes the reply when a competing save wins', async () => {
  const request = command('losing-message');
  const reply = request.reply;
  let deleted = false;
  let followUp;
  request.reply = async (value) => {
    await PollCommand.prototype.create(command('winning-message'));
    return reply(value);
  };
  request.deleteReply = async () => { deleted = true; };
  request.followUp = async (value) => { followUp = value; };
  await PollCommand.prototype.create(request);
  assert.equal(deleted, true);
  assert.match(followUp.content, /already have an active poll/);
  assert.equal((await getPoll(authorId)).messageId, 'winning-message');
});

test('poll creation deletes the reply and propagates save rejection even if cleanup fails', async () => {
  const path = process.env.POLL_DATA_FILE;
  for (const cleanupFails of [false, true]) {
    const request = command();
    let deleted = false;
    request.reply = async () => {
      process.env.POLL_DATA_FILE = directory;
      return { id: messageId };
    };
    request.deleteReply = async () => {
      deleted = true;
      if (cleanupFails) throw new Error('cleanup failed');
    };
    try {
      await assert.rejects(PollCommand.prototype.create(request), (error) =>
        ['EISDIR', 'EXDEV'].includes(error.code),
      );
      assert.equal(deleted, true);
    } finally {
      process.env.POLL_DATA_FILE = path;
    }
  }
});

test('invalid poll requests do not reserve cooldown', async () => {
  const precondition = { ok: () => true, error: () => false };
  const request = command();
  request.member = { roles: { cache: { some: () => false } } };
  await PollCommand.prototype.create(command());
  assert.equal(await PollCooldown.prototype.chatInputRun.call(precondition, request), false);
  assert.match(request.lastReply.content, /already have an active poll/);
  await PollCommand.prototype.close(command());
  request.options.getString = () => '1|2|3|4|5|6';
  assert.equal(await PollCooldown.prototype.chatInputRun.call(precondition, request), false);
  assert.match(request.lastReply.content, /at most five/);
  request.options.getString = () => '1|2|3|4|5';
  assert.equal(await PollCooldown.prototype.chatInputRun.call(precondition, request), true);
});

test('poll storage rejects invalid roots and maps without overwriting them', async () => {
  const { writeFile, readFile } = await import('node:fs/promises');
  for (const value of [null, [], 1, 'polls', { polls: null }, { polls: [] }, { cooldowns: 1 }, { cooldowns: [] }]) {
    const raw = JSON.stringify(value);
    await writeFile(process.env.POLL_DATA_FILE, raw);
    await assert.rejects(getPoll(authorId), /Invalid poll storage/);
    await assert.rejects(checkAndRecordPollCooldown(authorId, Date.now(), 1000), /Invalid poll storage/);
    assert.equal(await readFile(process.env.POLL_DATA_FILE, 'utf8'), raw);
  }
  for (const value of [{}, { polls: {} }, { cooldowns: {} }]) {
    await writeFile(process.env.POLL_DATA_FILE, JSON.stringify(value));
    assert.equal(await getPoll(authorId), null);
    assert.equal(await checkAndRecordPollCooldown(authorId, Date.now(), 1000), 0);
  }
});
