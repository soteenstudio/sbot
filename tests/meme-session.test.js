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
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import axios from 'axios';

const originalDirectory = process.cwd();
const directory = await fs.mkdtemp(join(tmpdir(), 'meme-session-test-'));
process.chdir(directory);
const { memeHistory } = await import('../dist/lib/memeStorage.js');
const { MemeCommand } = await import('../dist/commands/MemeCommand.js');
const { MemeButtonHandler } = await import('../dist/interaction-handlers/MemeButtonHandler.js');
const dataFile = join(directory, 'data', 'meme-sessions.json');
after(async () => {
  process.chdir(originalDirectory);
  await fs.rm(directory, { recursive: true, force: true });
});
beforeEach(() => fs.rm(join(directory, 'data'), { recursive: true, force: true }));

const meme = {
  title: 'Test meme', imageUrl: 'https://example.com/meme.png',
  postLink: 'https://example.com/post', author: 'tester', subreddit: 'random',
};
const session = () => ({ userId: 'owner', history: [meme], currentIndex: 0 });

function button(userId) {
  const calls = [];
  const interaction = { user: { id: userId }, calls };
  for (const method of ['reply', 'update', 'deferUpdate', 'editReply', 'followUp']) {
    interaction[method] = async (payload) => { calls.push({ method, payload }); };
  }
  return interaction;
}

test('command persists the invoking user before publishing buttons', async (t) => {
  t.mock.method(axios, 'get', async () => ({ data: { ...meme, url: meme.imageUrl } }));
  const interaction = {
    user: { id: 'owner' },
    async deferReply() {},
    async editReply(payload) {
      if (payload.components) assert.equal((await memeHistory.get('message')).userId, 'owner');
      return { id: 'message' };
    },
  };
  await MemeCommand.prototype.fetchMeme(interaction);
  assert.deepEqual(await memeHistory.get('message'), session());
});

for (const action of ['next', 'prev', 'close']) {
  test(`another user cannot ${action} or change session state`, async (t) => {
    const fetch = t.mock.method(axios, 'get', () => { throw new Error('Unexpected fetch'); });
    await memeHistory.set('message', session());
    const before = await fs.readFile(dataFile, 'utf8');
    const interaction = button('visitor');
    await MemeButtonHandler.prototype.run(interaction, { action, messageId: 'message' });
    assert.equal(interaction.calls.length, 1);
    assert.equal(interaction.calls[0].method, 'reply');
    assert.equal(interaction.calls[0].payload.ephemeral, true);
    assert.match(interaction.calls[0].payload.content, /Only the user/);
    assert.equal(await fs.readFile(dataFile, 'utf8'), before);
    assert.equal(fetch.mock.callCount(), 0);
  });
}

test('owner can fetch Next, navigate Previous, and Close', async (t) => {
  t.mock.method(axios, 'get', async () => ({ data: { ...meme, title: 'Next meme', url: meme.imageUrl } }));
  await memeHistory.set('message', session());
  for (const [action, index] of [['next', 1], ['prev', 0]]) {
    const interaction = button('owner');
    await MemeButtonHandler.prototype.run(interaction, { action, messageId: 'message' });
    assert.deepEqual(interaction.calls.map((call) => call.method), ['deferUpdate', 'editReply']);
    assert.equal((await memeHistory.get('message')).currentIndex, index);
    assert.equal((await memeHistory.get('message')).userId, 'owner');
  }
  const interaction = button('owner');
  await MemeButtonHandler.prototype.run(interaction, { action: 'close', messageId: 'message' });
  assert.equal(await memeHistory.has('message'), false);
  assert.equal(interaction.calls[0].method, 'update');
  assert.ok(interaction.calls[0].payload.components[0].components.every((component) => component.data.disabled));
});

test('missing and legacy sessions reject all actions ephemerally', async () => {
  for (const legacy of [false, true]) {
    if (legacy) {
      const old = session();
      delete old.userId;
      await memeHistory.set('message', old);
    }
    for (const action of ['next', 'prev', 'close']) {
      const interaction = button('owner');
      await MemeButtonHandler.prototype.run(interaction, { action, messageId: 'message' });
      assert.deepEqual(interaction.calls.map((call) => call.method), ['reply']);
      assert.equal(interaction.calls[0].payload.ephemeral, true);
      assert.equal(await memeHistory.has('message'), legacy);
    }
  }
});

test('concurrent initialization, sets, deletes, and reads preserve operation order', async () => {
  await Promise.all(Array.from({ length: 30 }, (_, index) => memeHistory.set(`message-${index}`, session())));
  const operations = [];
  for (let index = 0; index < 30; index++) {
    operations.push(memeHistory.delete(`message-${index}`));
    operations.push(memeHistory.set(`new-${index}`, session()));
    operations.push(memeHistory.has(`message-${index}`).then((exists) => assert.equal(exists, false)));
    operations.push(memeHistory.get(`new-${index}`).then((value) => assert.deepEqual(value, session())));
  }
  await Promise.all(operations);
  const saved = JSON.parse(await fs.readFile(dataFile, 'utf8'));
  assert.deepEqual(Object.keys(saved), Array.from({ length: 30 }, (_, index) => `new-${index}`));
});

test('writes leave the previous file intact until atomic replacement', async (t) => {
  await memeHistory.set('original', session());
  const original = await fs.readFile(dataFile, 'utf8');
  const rename = fs.rename.bind(fs);
  const replace = t.mock.method(fs, 'rename', async (source, destination) => {
    assert.equal(destination, dataFile);
    assert.notEqual(source, dataFile);
    assert.equal(await fs.readFile(dataFile, 'utf8'), original);
    assert.ok(JSON.parse(await fs.readFile(source, 'utf8')).new);
    return rename(source, destination);
  });
  await memeHistory.set('new', session());
  assert.equal(replace.mock.callCount(), 1);
  assert.deepEqual(await fs.readdir(join(directory, 'data')), ['meme-sessions.json']);
});

test('failed partial write preserves data, cleans up, and does not poison the queue', async (t) => {
  await memeHistory.set('original', session());
  const original = await fs.readFile(dataFile, 'utf8');
  const write = fs.writeFile.bind(fs);
  t.mock.method(fs, 'writeFile', async (file) => {
    await write(file, '{partial');
    throw new Error('simulated disk failure');
  }, { times: 1 });
  const failed = memeHistory.set('failed', session());
  const read = memeHistory.get('original');
  await assert.rejects(failed, /simulated disk failure/);
  assert.deepEqual(await read, session());
  assert.equal(await fs.readFile(dataFile, 'utf8'), original);
  assert.deepEqual(await fs.readdir(join(directory, 'data')), ['meme-sessions.json']);
  await memeHistory.set('recovered', session());
  assert.equal(await memeHistory.has('recovered'), true);
  assert.equal(await memeHistory.has('failed'), false);
});

test('history and session limits and malformed JSON fallback are preserved', async () => {
  await memeHistory.set('long', { ...session(), history: Array(25).fill(meme), currentIndex: 24 });
  const saved = await memeHistory.get('long');
  assert.equal(saved.history.length, 20);
  assert.equal(saved.currentIndex, 19);
  await Promise.all(Array.from({ length: 100 }, (_, index) => memeHistory.set(`message-${index}`, session())));
  assert.equal(await memeHistory.has('long'), false);
  assert.equal(Object.keys(JSON.parse(await fs.readFile(dataFile, 'utf8'))).length, 100);
  await fs.writeFile(dataFile, '{invalid');
  assert.equal(await memeHistory.get('missing'), undefined);
  await memeHistory.set('recovered', session());
  assert.deepEqual(await memeHistory.get('recovered'), session());
});
