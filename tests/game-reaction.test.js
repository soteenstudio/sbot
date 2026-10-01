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
import { ChannelType, Collection } from 'discord.js';
import Database from 'better-sqlite3';

const directory = await mkdtemp(join(tmpdir(), 'game-selection-'));
process.env.GAME_SELECTION_DATA_FILE = join(directory, 'selection.json');
process.env.GAME_SELECTION_DB_FILE = join(directory, 'selection.sqlite');
process.env.INTERESTS_CHANNEL = 'interests';
after(() => rm(directory, { recursive: true, force: true }));

const { GameReactionListener } = await import('../dist/listeners/GameReactionListener.js');
const { GameReactionRemoveListener } = await import('../dist/listeners/GameReactionRemoveListener.js');
const { GameEmbedSetupListener } = await import('../dist/listeners/GameReactionSetupListener.js');
const { saveGameSelectionMessage, loadGameSelectionMessage, isGameSelectionMessage } = await import('../dist/lib/gameSelection.js');
const { emojiMap } = await import('../dist/config/emojiMap.js');
const { Games } = await import('../dist/games.js');
const emojis = Object.keys(emojiMap);
const title = '🎮 Select Your Favorite Games!';
const description = 'React below to automatically get your favorite game roles!\n\n' +
  Object.entries(emojiMap).map(([emoji, key]) => `(${emoji})---|\u00A0\u00A0**${Games[key].label}**`).join('\n\n');
const add = (reaction, user) => GameReactionListener.prototype.run(reaction, user);
const remove = (reaction, user) => GameReactionRemoveListener.prototype.run(reaction, user);
const setup = (client) => GameEmbedSetupListener.prototype.run(client);

beforeEach(async () => {
  await saveGameSelectionMessage('interests', '');
  Games[emojiMap[emojis[0]]].roleId = 'game-role';
});

function message(id = 'selection', matching = true) {
  return {
    id, author: { id: 'bot' },
    embeds: [{ title, description: matching ? description : 'outdated' }],
    reactions: { cache: new Collection() },
    edits: [], reacted: [],
    async edit(payload) { this.edits.push(payload); },
    async react(emoji) { this.reacted.push(emoji); },
  };
}

function clientFor(fetch, sent = message()) {
  const channel = {
    type: ChannelType.GuildText,
    messages: { fetch },
    sends: 0,
    async send() { this.sends++; return sent; },
  };
  return { user: { id: 'bot' }, channels: { async fetch() { return channel; } }, channel };
}

function eventFixture() {
  const calls = [];
  const roles = {
    cache: new Collection([['game-role', {}]]),
    async add(role) { calls.push(['add', role]); },
    async remove(role) { calls.push(['remove', role]); },
  };
  const reaction = {
    partial: false, emoji: { name: emojis[0] },
    message: {
      id: 'selection', channelId: 'interests', guildId: 'guild',
      guild: { members: { async fetch() { return { roles }; } } },
    },
  };
  return { calls, reaction, roles, user: { id: 'member', tag: 'member', bot: false, partial: false } };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('add and remove reject other messages and channels before fetching partials', async () => {
  await saveGameSelectionMessage('interests', 'selection');
  for (const handler of [add, remove]) {
    for (const change of [{ id: 'other' }, { channelId: 'other' }]) {
      const { reaction, user, calls } = eventFixture();
      Object.assign(reaction.message, change);
      reaction.partial = true;
      reaction.fetch = () => assert.fail('unrelated reaction fetched');
      await handler(reaction, user);
      assert.deepEqual(calls, []);
    }
  }
});

test('active selection assigns the role despite a stale cache claiming membership', async () => {
  await saveGameSelectionMessage('interests', 'selection');
  const { reaction, user, calls } = eventFixture();
  await add(reaction, user);
  assert.deepEqual(calls, [['add', 'game-role']]);
});

test('add then remove preserves arrival order across a delayed partial fetch', async () => {
  await saveGameSelectionMessage('interests', 'selection');
  const { reaction, user, calls } = eventFixture();
  const gate = deferred();
  const started = deferred();
  const partial = { ...reaction, partial: true, async fetch() { started.resolve(); await gate.promise; return reaction; } };
  const adding = add(partial, user);
  await started.promise;
  const removing = remove(reaction, user);
  gate.resolve();
  await Promise.all([adding, removing]);
  assert.deepEqual(calls, [['add', 'game-role'], ['remove', 'game-role']]);
});

test('remove then add preserves arrival order while another member proceeds', async () => {
  await saveGameSelectionMessage('interests', 'selection');
  const { reaction, user, calls, roles } = eventFixture();
  const gate = deferred();
  const started = deferred();
  roles.remove = async (role) => { started.resolve(); await gate.promise; calls.push(['remove', role]); };
  const removing = remove(reaction, user);
  await started.promise;
  const adding = add(reaction, user);
  const other = eventFixture();
  await add(other.reaction, { ...user, id: 'other' });
  assert.deepEqual(other.calls, [['add', 'game-role']]);
  assert.deepEqual(calls, []);
  gate.resolve();
  await Promise.all([removing, adding]);
  assert.deepEqual(calls, [['remove', 'game-role'], ['add', 'game-role']]);
});

test('a failed role operation does not block the next event', async () => {
  await saveGameSelectionMessage('interests', 'selection');
  const { reaction, user, calls, roles } = eventFixture();
  roles.add = async () => { throw new Error('synthetic role failure'); };
  await Promise.all([add(reaction, user), remove(reaction, user)]);
  assert.deepEqual(calls, [['remove', 'game-role']]);
});

test('matching saved selection is fetched directly and missing bot reactions are repaired without editing', async () => {
  await saveGameSelectionMessage('interests', 'old-selection');
  const existing = message('old-selection');
  existing.reactions.cache.set('bot', { emoji: { name: emojis[0] }, me: true });
  existing.reactions.cache.set('human', { emoji: { name: emojis[1] }, me: false });
  const client = clientFor(async (id) => { assert.equal(id, 'old-selection'); return existing; });
  await setup(client);
  assert.equal(client.channel.sends, 0);
  assert.deepEqual(existing.edits, []);
  assert.deepEqual(existing.reacted, emojis.slice(1));
  assert.equal(isGameSelectionMessage('interests', 'old-selection'), true);
});

test('history pagination finds an older selection and persists it before updating and repairing reactions', async () => {
  const existing = message('older', false);
  const requests = [];
  const client = clientFor(async (options) => {
    requests.push(options);
    return options.before ? new Collection([['older', existing]]) : new Collection(
      Array.from({ length: 100 }, (_, i) => [String(200-i), { id: String(200-i), author: { id: 'human' }, embeds: [] }]),
    );
  });
  await setup(client);
  assert.deepEqual(requests, [{ limit: 100, before: undefined }, { limit: 100, before: '101' }]);
  assert.equal(client.channel.sends, 0);
  assert.equal(existing.edits.length, 1);
  assert.deepEqual(existing.reacted, emojis);
  assert.equal(await loadGameSelectionMessage('interests'), 'older');
  const db = new Database(process.env.GAME_SELECTION_DB_FILE, { readonly: true });
  try {
    assert.deepEqual(db.prepare('SELECT * FROM game_selection').get(), { channel_id: 'interests', message_id: 'older' });
  } finally {
    db.close();
  }
  assert.equal(await loadGameSelectionMessage('other-channel'), undefined);
});

test('a missing saved message falls back to history instead of duplicating a selection', async () => {
  await saveGameSelectionMessage('interests', 'deleted');
  const existing = message('found');
  const client = clientFor(async (request) => {
    if (typeof request === 'string') throw Object.assign(new Error('unknown message'), { code: 10008 });
    return new Collection([['found', existing]]);
  });
  await setup(client);
  assert.equal(client.channel.sends, 0);
  assert.equal(await loadGameSelectionMessage('interests'), 'found');
});

test('selection is created only after history is exhausted and is saved before reacting', async () => {
  const sent = message('new');
  sent.react = async (emoji) => {
    assert.equal(await loadGameSelectionMessage('interests'), 'new');
    assert.equal(isGameSelectionMessage('interests', 'new'), true);
    sent.reacted.push(emoji);
  };
  const client = clientFor(async () => new Collection(), sent);
  await setup(client);
  assert.equal(client.channel.sends, 1);
  assert.deepEqual(sent.reacted, emojis);
});

test('lookup failures do not create duplicate selections', async () => {
  for (const saved of [false, true]) {
    if (saved) await saveGameSelectionMessage('interests', 'saved');
    const client = clientFor(async () => { throw Object.assign(new Error('missing access'), { code: 50001 }); });
    await setup(client);
    assert.equal(client.channel.sends, 0);
  }
});
