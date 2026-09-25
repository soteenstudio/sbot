/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export type ChatUsage = { count: number; lastReset: number };
type UsageRecords = Record<string, ChatUsage>;

const DAY_MS = 24 * 60 * 60 * 1000;
const usagePath = () => resolve(process.env.CHAT_USAGE_FILE ?? 'data/chat-usage.json');

async function readUsage(path: string): Promise<UsageRecords> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as UsageRecords;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

function currentUsage(records: UsageRecords, userId: string, now: number): ChatUsage {
  const usage = records[userId];
  return usage && now - usage.lastReset <= DAY_MS
    ? usage
    : { count: 0, lastReset: now };
}

async function updateUsage<T>(change: (records: UsageRecords) => [T, boolean]): Promise<T> {
  const path = usagePath();
  const lockPath = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true });

  const started = Date.now();
  let ownedMarker: string | undefined;
  while (!ownedMarker) {
    // Prepare a nonempty directory before publishing it as the lock. This keeps
    // a newly acquired lock nonempty even when another caller is removing a stale one.
    const candidatePath = `${lockPath}.${randomUUID()}.tmp`;
    const markerName = randomUUID();
    const candidateMarker = join(candidatePath, markerName);
    await mkdir(candidatePath);
    try {
      await writeFile(candidateMarker, '');
      await rename(candidatePath, lockPath);
      ownedMarker = join(lockPath, markerName);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST' && code !== 'ENOTEMPTY' && code !== 'ENOTDIR') throw error;
    } finally {
      await unlink(candidateMarker).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
      await rmdir(candidatePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    if (ownedMarker) break;

    try {
      const markers = await readdir(lockPath);
      if (markers.length === 0) {
        await rmdir(lockPath);
        continue;
      }
      if (markers.length === 1) {
        const markerPath = join(lockPath, markers[0]);
        if (Date.now() - (await stat(markerPath)).mtimeMs > 30_000) {
          // The marker name identifies the observed owner. A replacement lock
          // has a different name, so this rename cannot take its marker.
          const stalePath = `${lockPath}.${randomUUID()}.stale`;
          await rename(markerPath, stalePath);
          try {
            await rmdir(lockPath);
          } finally {
            await unlink(stalePath);
          }
          continue;
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTEMPTY' && code !== 'EEXIST' && code !== 'ENOTDIR') throw error;
    }
    if (Date.now() - started > 35_000) throw new Error('Chat usage storage is busy');
    await new Promise((done) => setTimeout(done, 25));
  }

  try {
    const records = await readUsage(path);
    const [result, changed] = change(records);
    if (changed) {
      const temporaryPath = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryPath, JSON.stringify(records));
        await rename(temporaryPath, path);
      } finally {
        await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
    }
    return result;
  } finally {
    await unlink(ownedMarker).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    await rmdir(lockPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY' && error.code !== 'EEXIST') throw error;
    });
  }
}

export async function getChatUsage(userId: string, now: number): Promise<ChatUsage> {
  return currentUsage(await readUsage(usagePath()), userId, now);
}

export async function consumeChatUsage(
  userId: string,
  now: number,
  limit: number,
): Promise<{ usage: ChatUsage; consumed: boolean }> {
  return updateUsage<{ usage: ChatUsage; consumed: boolean }>((records) => {
    const usage = currentUsage(records, userId, now);
    if (usage.count >= limit) return [{ usage, consumed: false }, false];
    const updated = { count: usage.count + 1, lastReset: usage.lastReset };
    records[userId] = updated;
    return [{ usage: updated, consumed: true }, true];
  });
}

export async function refundChatUsage(userId: string, lastReset: number): Promise<void> {
  await updateUsage((records) => {
    const usage = records[userId];
    if (!usage || usage.lastReset !== lastReset || usage.count === 0) return [undefined, false];
    records[userId] = { ...usage, count: usage.count - 1 };
    return [undefined, true];
  });
}
