/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const roleChanges = new Map<string, Promise<void>>();

const dbPath = resolve(
  process.env.GAME_SELECTION_DATA_FILE ?? 'data/game-selection.sqlite',
);

mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS game_selection (
    channel_id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL
  )
`);

const selectionMessages = new Map<string, string>();

const rows = db
  .prepare('SELECT channel_id, message_id FROM game_selection')
  .all() as { channel_id: string; message_id: string }[];
for (const row of rows) {
  selectionMessages.set(row.channel_id, row.message_id);
}

export function isGameSelectionMessage(channelId: string, messageId: string) {
  return selectionMessages.get(channelId) === messageId;
}

export async function loadGameSelectionMessage(channelId: string) {
  if (selectionMessages.has(channelId)) {
    return selectionMessages.get(channelId);
  }

  const row = db
    .prepare('SELECT message_id FROM game_selection WHERE channel_id = ?')
    .get(channelId) as { message_id: string } | undefined;

  if (row) {
    selectionMessages.set(channelId, row.message_id);
    return row.message_id;
  }

  return undefined;
}

export async function saveGameSelectionMessage(
  channelId: string,
  messageId: string,
) {
  const stmt = db.prepare(`
    INSERT INTO game_selection (channel_id, message_id) 
    VALUES (?, ?) 
    ON CONFLICT(channel_id) 
    DO UPDATE SET message_id = excluded.message_id
  `);

  stmt.run(channelId, messageId);

  selectionMessages.set(channelId, messageId);
}

export function enqueueGameRoleChange(
  key: string,
  change: () => Promise<void>,
) {
  const operation = (roleChanges.get(key) ?? Promise.resolve()).then(change);
  const settled = operation.catch(() => {});
  roleChanges.set(key, settled);
  void settled.then(() => {
    if (roleChanges.get(key) === settled) roleChanges.delete(key);
  });
  return operation;
}
