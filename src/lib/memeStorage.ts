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
import { resolve, dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

export interface MemeData {
  title: string;
  imageUrl: string;
  postLink: string;
  author: string;
  subreddit: string;
}

export interface MemeSession {
  userId: string;
  history: MemeData[];
  currentIndex: number;
}

const DATA_DIR = resolve(process.cwd(), 'data');
const DB_FILE = join(DATA_DIR, 'meme-sessions.sqlite');

mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(DB_FILE);

db.exec(`
  CREATE TABLE IF NOT EXISTS meme_sessions (
    message_id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  )
`);

export const memeHistory = {
  async get(messageId: string): Promise<MemeSession | undefined> {
    const row = db
      .prepare('SELECT data FROM meme_sessions WHERE message_id = ?')
      .get(messageId) as { data: string } | undefined;

    if (!row) return undefined;
    return JSON.parse(row.data) as MemeSession;
  },

  async set(messageId: string, session: MemeSession): Promise<void> {
    if (session.history.length > 20) {
      session.history = session.history.slice(-20);
      session.currentIndex = Math.min(
        session.currentIndex,
        session.history.length - 1,
      );
    }

    const transaction = db.transaction(() => {
      const countRow = db
        .prepare('SELECT COUNT(*) as count FROM meme_sessions')
        .get() as { count: number };
      if (countRow.count >= 100) {
        db.prepare(
          'DELETE FROM meme_sessions WHERE message_id IN (SELECT message_id FROM meme_sessions LIMIT 1)',
        ).run();
      }

      db.prepare(
        `INSERT INTO meme_sessions (message_id, data) 
         VALUES (?, ?) 
         ON CONFLICT(message_id) 
         DO UPDATE SET data = excluded.data`,
      ).run(messageId, JSON.stringify(session));
    });

    transaction();
  },

  async has(messageId: string): Promise<boolean> {
    const row = db
      .prepare('SELECT 1 FROM meme_sessions WHERE message_id = ?')
      .get(messageId);
    return Boolean(row);
  },

  async delete(messageId: string): Promise<void> {
    db.prepare('DELETE FROM meme_sessions WHERE message_id = ?').run(messageId);
  },
};

export async function cleanupMemeHistory(messageId: string): Promise<void> {
  await memeHistory.delete(messageId);
}
