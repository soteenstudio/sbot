/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

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

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'meme-sessions.json');
let storageQueue: Promise<void> = Promise.resolve();

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageQueue.then(operation);
  // A failed operation must not block subsequent storage requests.
  storageQueue = result.then(
    () => {},
    () => {},
  );
  return result;
}

async function replaceStorage(
  data: Record<string, MemeSession>,
): Promise<void> {
  const temporaryFile = `${DATA_FILE}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryFile, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(temporaryFile, DATA_FILE);
  } finally {
    await fs.rm(temporaryFile, { force: true });
  }
}

async function ensureDataFile(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.access(DATA_FILE);
  } catch {
    await replaceStorage({});
  }
}

async function readStorage(): Promise<Record<string, MemeSession>> {
  await ensureDataFile();
  try {
    const rawData = await fs.readFile(DATA_FILE, 'utf-8');
    return JSON.parse(rawData);
  } catch {
    return {};
  }
}

async function writeStorage(data: Record<string, MemeSession>): Promise<void> {
  await ensureDataFile();

  const keys = Object.keys(data);
  if (keys.length > 100) {
    delete data[keys[0]];
  }

  await replaceStorage(data);
}

export const memeHistory = {
  async get(messageId: string): Promise<MemeSession | undefined> {
    return enqueue(async () => {
      const storage = await readStorage();
      return storage[messageId];
    });
  },

  async set(messageId: string, session: MemeSession): Promise<void> {
    return enqueue(async () => {
      const storage = await readStorage();

      if (session.history.length > 20) {
        session.history = session.history.slice(-20);
        session.currentIndex = Math.min(
          session.currentIndex,
          session.history.length - 1,
        );
      }

      storage[messageId] = session;
      await writeStorage(storage);
    });
  },

  async has(messageId: string): Promise<boolean> {
    return enqueue(async () => {
      const storage = await readStorage();
      return Boolean(storage[messageId]);
    });
  },

  async delete(messageId: string): Promise<void> {
    return enqueue(async () => {
      const storage = await readStorage();
      if (storage[messageId]) {
        delete storage[messageId];
        await writeStorage(storage);
      }
    });
  },
};

export async function cleanupMemeHistory(messageId: string): Promise<void> {
  await memeHistory.delete(messageId);
}
