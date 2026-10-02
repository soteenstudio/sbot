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

export interface SubscriptionRecord {
  userId: string;
  guildId: string;
  roleId: string;
  durationMonths: number;
  expiresAt: number;
}

type Records = Record<string, Record<string, SubscriptionRecord>>;

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'subscriptions.json');
let storageQueue: Promise<void> = Promise.resolve();

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageQueue.then(operation);
  storageQueue = result.then(
    () => {},
    () => {},
  );
  return result;
}

async function replaceStorage(data: Records): Promise<void> {
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

async function readStorage(): Promise<Records> {
  await ensureDataFile();
  try {
    const rawData = await fs.readFile(DATA_FILE, 'utf-8');
    return JSON.parse(rawData);
  } catch {
    return {};
  }
}

async function writeStorage(data: Records): Promise<void> {
  await ensureDataFile();
  await replaceStorage(data);
}

export const subscriptionStore = {
  async get(
    guildId: string,
    userId: string,
  ): Promise<SubscriptionRecord | undefined> {
    return enqueue(async () => {
      const storage = await readStorage();
      return storage[guildId]?.[userId];
    });
  },

  async set(record: SubscriptionRecord): Promise<void> {
    return enqueue(async () => {
      const storage = await readStorage();
      if (!storage[record.guildId]) {
        storage[record.guildId] = {};
      }
      storage[record.guildId][record.userId] = record;
      await writeStorage(storage);
    });
  },

  async delete(guildId: string, userId: string): Promise<void> {
    return enqueue(async () => {
      const storage = await readStorage();
      if (storage[guildId]?.[userId]) {
        delete storage[guildId][userId];
        if (Object.keys(storage[guildId]).length === 0) {
          delete storage[guildId];
        }
        await writeStorage(storage);
      }
    });
  },

  async getAll(): Promise<SubscriptionRecord[]> {
    return enqueue(async () => {
      const storage = await readStorage();
      const allRecords: SubscriptionRecord[] = [];
      for (const guildId of Object.keys(storage)) {
        for (const userId of Object.keys(storage[guildId])) {
          allRecords.push(storage[guildId][userId]);
        }
      }
      return allRecords;
    });
  },
};
