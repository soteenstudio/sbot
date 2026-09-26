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
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export type TTSUsage = {
  count: number;
  lastReset: number;
  pending: Record<string, number>;
};
type UsageRecords = Record<string, TTSUsage>;

const DAY_MS = 24 * 60 * 60 * 1000;
// Both remote requests have 60-second timeouts. Allow another minute for local work.
export const RESERVATION_TTL_MS = 3 * 60 * 1000;
const usagePath = () =>
  resolve(process.env.TTS_USAGE_FILE ?? 'data/tts-usage.json');

async function readUsage(path: string): Promise<UsageRecords> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as UsageRecords;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

function currentUsage(
  records: UsageRecords,
  userId: string,
  now: number,
): TTSUsage {
  const usage = records[userId];
  return usage && now - usage.lastReset <= DAY_MS
    ? usage
    : { count: 0, lastReset: now, pending: {} };
}

function expirePending(usage: TTSUsage, now: number): boolean {
  let changed = false;
  for (const [id, reservedAt] of Object.entries(usage.pending)) {
    if (now - reservedAt < RESERVATION_TTL_MS) continue;
    delete usage.pending[id];
    usage.count--;
    changed = true;
  }
  return changed;
}

async function updateUsage<T>(
  change: (records: UsageRecords) => [T, boolean],
): Promise<T> {
  const path = usagePath();
  const lockPath = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true });

  const started = Date.now();
  let ownedMarker: string | undefined;
  while (!ownedMarker) {
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
      if (code !== 'EEXIST' && code !== 'ENOTEMPTY' && code !== 'ENOTDIR')
        throw error;
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
      if (
        code !== 'ENOENT' &&
        code !== 'ENOTEMPTY' &&
        code !== 'EEXIST' &&
        code !== 'ENOTDIR'
      )
        throw error;
    }
    if (Date.now() - started > 35_000)
      throw new Error('TTS usage storage is busy');
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
      if (
        error.code !== 'ENOENT' &&
        error.code !== 'ENOTEMPTY' &&
        error.code !== 'EEXIST'
      )
        throw error;
    });
  }
}

export async function getTTSUsage(
  userId: string,
  now: number,
): Promise<TTSUsage> {
  return updateUsage((records) => {
    const usage = currentUsage(records, userId, now);
    const changed = expirePending(usage, now);
    if (changed) records[userId] = usage;
    return [usage, changed];
  });
}

export async function reserveTTSUsage(
  userId: string,
  now: number,
  limit: number,
): Promise<{ usage: TTSUsage; reservationId: string | null }> {
  return updateUsage<{ usage: TTSUsage; reservationId: string | null }>(
    (records) => {
      const usage = currentUsage(records, userId, now);
      const expired = expirePending(usage, now);
      if (usage.count >= limit) {
        if (expired) records[userId] = usage;
        return [{ usage, reservationId: null }, expired];
      }
      const reservationId = randomUUID();
      usage.count++;
      usage.pending[reservationId] = now;
      records[userId] = usage;
      return [{ usage, reservationId }, true];
    },
  );
}

export async function finishTTSUsage(
  userId: string,
  lastReset: number,
  reservationId: string,
  refund: boolean,
): Promise<void> {
  await updateUsage((records) => {
    const usage = records[userId];
    if (
      !usage ||
      usage.lastReset !== lastReset ||
      !Object.hasOwn(usage.pending, reservationId)
    )
      return [undefined, false];
    delete usage.pending[reservationId];
    if (refund) usage.count--;
    return [undefined, true];
  });
}
