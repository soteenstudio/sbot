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

export interface RenewalApproval {
  requestId: string;
  userId: string;
  guildId: string;
  roleId: string;
  durationMonths: number;
  expiresAt: number;
  approvedAt: number;
  approvedBy: string;
}

interface Storage {
  version: 1;
  subscriptions: Records;
  renewalApprovals: Record<string, RenewalApproval>;
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

async function replaceStorage(data: Storage): Promise<void> {
  const temporaryFile = `${DATA_FILE}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryFile, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(temporaryFile, DATA_FILE);
  } finally {
    await fs.rm(temporaryFile, { force: true });
  }
}

async function ensureDataFile(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch (error) {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    )
      throw error;
    await replaceStorage({
      version: 1,
      subscriptions: {},
      renewalApprovals: {},
    });
  }
}

async function readStorage(): Promise<Storage> {
  await ensureDataFile();
  const rawData = await fs.readFile(DATA_FILE, 'utf-8');
  const parsed = JSON.parse(rawData);
  return parsed.version === 1
    ? parsed
    : { version: 1, subscriptions: parsed, renewalApprovals: {} };
}

async function writeStorage(data: Storage): Promise<void> {
  await ensureDataFile();
  await replaceStorage(data);
}

export const subscriptionStore = {
  async getRenewalApproval(
    requestId: string,
  ): Promise<RenewalApproval | undefined> {
    return enqueue(
      async () => (await readStorage()).renewalApprovals[requestId],
    );
  },

  async saveRenewalApproval(
    record: SubscriptionRecord,
    approval: RenewalApproval,
  ): Promise<void> {
    return enqueue(async () => {
      const data = await readStorage();
      if (data.renewalApprovals[approval.requestId])
        throw new Error('Renewal already approved');
      data.subscriptions[record.guildId] ??= {};
      data.subscriptions[record.guildId][record.userId] = record;
      data.renewalApprovals[approval.requestId] = approval;
      await writeStorage(data);
    });
  },

  async get(
    guildId: string,
    userId: string,
  ): Promise<SubscriptionRecord | undefined> {
    return enqueue(async () => {
      const data = await readStorage();
      const storage = data.subscriptions;
      return storage[guildId]?.[userId];
    });
  },

  async set(record: SubscriptionRecord): Promise<void> {
    return enqueue(async () => {
      const data = await readStorage();
      const storage = data.subscriptions;
      if (!storage[record.guildId]) {
        storage[record.guildId] = {};
      }
      storage[record.guildId][record.userId] = record;
      await writeStorage(data);
    });
  },

  async delete(guildId: string, userId: string): Promise<void> {
    return enqueue(async () => {
      const data = await readStorage();
      const storage = data.subscriptions;
      if (storage[guildId]?.[userId]) {
        delete storage[guildId][userId];
        if (Object.keys(storage[guildId]).length === 0) {
          delete storage[guildId];
        }
        await writeStorage(data);
      }
    });
  },

  async getAll(): Promise<SubscriptionRecord[]> {
    return enqueue(async () => {
      const data = await readStorage();
      const storage = data.subscriptions;
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
