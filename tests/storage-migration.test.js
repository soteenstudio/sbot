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
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';

const execute = promisify(execFile);
const session = { userId: 'owner', history: [], currentIndex: 0 };
const stores = [
  {
    name: 'game-selection', module: 'gameSelection', table: 'game_selection',
    legacy: { channelId: 'channel', messageId: 'message' },
    invalid: { channelId: 'channel', messageId: null },
    check: `assert.equal(await store.loadGameSelectionMessage('channel'), 'message');
      assert.equal(store.isGameSelectionMessage('channel', 'message'), true);`,
    change: `await store.saveGameSelectionMessage('channel', 'new-message');`,
    checkChanged: `assert.equal(await store.loadGameSelectionMessage('channel'), 'new-message');`,
    checkEmpty: `assert.equal(await store.loadGameSelectionMessage('channel'), undefined);`,
  },
  {
    name: 'meme-sessions', module: 'memeStorage', table: 'meme_sessions',
    legacy: { 'z-first': session, 'a-second': { ...session, userId: 'second-owner' } },
    invalid: [],
    check: `assert.deepEqual(await store.memeHistory.get('z-first'), ${JSON.stringify(session)});
      assert.equal((await store.memeHistory.get('a-second')).userId, 'second-owner');`,
    change: `await store.memeHistory.delete('z-first'); await store.memeHistory.delete('a-second');`,
    checkChanged: `assert.equal(await store.memeHistory.has('z-first'), false);
      assert.equal(await store.memeHistory.has('a-second'), false);`,
    checkEmpty: `assert.equal(await store.memeHistory.has('z-first'), false);`,
  },
];

async function fixture(t, store, custom = false) {
  const directory = await mkdtemp(join(tmpdir(), 'storage-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'data'));
  const legacyPath = join(directory, custom ? 'custom-selection.json' : `data/${store.name}.json`);
  const dbPath = join(directory, custom ? 'nested/selection.sqlite' : `data/${store.name}.sqlite`);
  const env = { ...process.env };
  delete env.GAME_SELECTION_DATA_FILE;
  delete env.GAME_SELECTION_DB_FILE;
  if (custom) {
    env.GAME_SELECTION_DATA_FILE = legacyPath;
    env.GAME_SELECTION_DB_FILE = dbPath;
  }
  const moduleUrl = new URL(`../dist/lib/${store.module}.js`, import.meta.url).href;
  const run = (code = '') => execute(process.execPath, ['--input-type=module', '-e',
    `import assert from 'node:assert/strict';
     const store = await import(${JSON.stringify(moduleUrl)}); ${code}`,
  ], { cwd: directory, env, timeout: 10000 });
  return { legacyPath, dbPath, run };
}

for (const store of stores) {
  test(`${store.name} imports legacy data once and preserves the source across restarts`, async (t) => {
    const { legacyPath, dbPath, run } = await fixture(t, store);
    const original = JSON.stringify(store.legacy);
    await writeFile(legacyPath, original);
    await run(store.check);
    assert.equal(await readFile(legacyPath, 'utf8'), original);
    if (store.name === 'meme-sessions') {
      const db = new Database(dbPath);
      try {
        assert.deepEqual(db.prepare('SELECT message_id FROM meme_sessions ORDER BY rowid').all(),
          [{ message_id: 'z-first' }, { message_id: 'a-second' }]);
      } finally { db.close(); }
    }
    await run(store.check + store.change);
    await run(store.checkChanged);
    assert.equal(await readFile(legacyPath, 'utf8'), original);
  });

  test(`${store.name} rolls back failed initialization and retries after repair`, async (t) => {
    const { legacyPath, dbPath, run } = await fixture(t, store);
    for (const invalid of ['{broken', JSON.stringify(store.invalid)]) {
      await writeFile(legacyPath, invalid);
      await assert.rejects(run());
      assert.equal(await readFile(legacyPath, 'utf8'), invalid);
      const db = new Database(dbPath);
      try {
        assert.equal(db.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').get(store.table), undefined);
      } finally { db.close(); }
    }
    await writeFile(legacyPath, JSON.stringify(store.legacy));
    await run(store.check);
  });

  test(`${store.name} does not import into an already initialized empty store`, async (t) => {
    const { legacyPath, run } = await fixture(t, store);
    await run(store.checkEmpty);
    await writeFile(legacyPath, JSON.stringify(store.legacy));
    await run(store.checkEmpty);
  });
}

test('game selection supports separate custom JSON and SQLite paths', async (t) => {
  const store = stores[0];
  const { legacyPath, run } = await fixture(t, store, true);
  const original = JSON.stringify(store.legacy);
  await writeFile(legacyPath, original);
  await run(store.check);
  assert.equal(await readFile(legacyPath, 'utf8'), original);
});
