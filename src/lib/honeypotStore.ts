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
  utimes,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export type HoneypotRecord = {
  guildId: string;
  userId: string;
  deadline: number | null;
  token: string;
  status: 'pending' | 'submitted' | 'approved' | 'rejected' | 'banned';
  challenge: {
    answer: number;
    stringCode: string;
    openedAt: number;
    expiresAt: number;
  } | null;
};

type Records = Record<string, Record<string, HoneypotRecord>>;
const storagePath = () =>
  resolve(process.env.HONEYPOT_DATA_FILE ?? 'data/honeypot.json');
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

function validate(value: unknown): Records {
  if (!isObject(value))
    throw new Error('Invalid honeypot storage: expected guild records');
  for (const [guildId, users] of Object.entries(value)) {
    if (!isObject(users) || !guildId)
      throw new Error('Invalid honeypot storage: expected user records');
    for (const [userId, raw] of Object.entries(users)) {
      if (
        !isObject(raw) ||
        raw.guildId !== guildId ||
        raw.userId !== userId ||
        !userId ||
        (raw.deadline !== null &&
          (!Number.isSafeInteger(raw.deadline) ||
            (raw.deadline as number) < 0)) ||
        typeof raw.token !== 'string' ||
        !raw.token ||
        !['pending', 'submitted', 'approved', 'rejected', 'banned'].includes(
          raw.status as string,
        ) ||
        (raw.status === 'pending') !== (raw.deadline !== null)
      )
        throw new Error('Invalid honeypot storage: invalid record');
      if (raw.challenge !== null) {
        const challenge = raw.challenge;
        if (
          !isObject(challenge) ||
          raw.status !== 'pending' ||
          !Number.isSafeInteger(challenge.answer) ||
          typeof challenge.stringCode !== 'string' ||
          !challenge.stringCode ||
          !Number.isSafeInteger(challenge.openedAt) ||
          !Number.isSafeInteger(challenge.expiresAt) ||
          (challenge.expiresAt as number) <= (challenge.openedAt as number)
        )
          throw new Error('Invalid honeypot storage: invalid challenge');
      }
    }
  }
  return value as Records;
}

async function read(path = storagePath()): Promise<Records> {
  try {
    return validate(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

export async function getHoneypotRecord(
  guildId: string,
  userId: string,
): Promise<HoneypotRecord | null> {
  return (await read())[guildId]?.[userId] ?? null;
}

export async function getAllHoneypotRecords(): Promise<HoneypotRecord[]> {
  return Object.values(await read()).flatMap((users) => Object.values(users));
}

export async function updateHoneypotRecord<T>(
  guildId: string,
  userId: string,
  change: (
    current: HoneypotRecord | null,
  ) => Promise<[HoneypotRecord | null, T]> | [HoneypotRecord | null, T],
): Promise<T> {
  const path = storagePath();
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
      throw new Error('Honeypot storage is busy');
    await new Promise((done) => setTimeout(done, 25));
  }
  const heartbeat = setInterval(() => {
    void utimes(ownedMarker, new Date(), new Date()).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT')
          console.error('Failed to refresh honeypot lock:', error);
      },
    );
  }, 5_000);
  heartbeat.unref();
  try {
    const records = await read(path);
    const current = records[guildId]?.[userId] ?? null;
    const [next, result] = await change(current);
    if (next !== current) {
      if (next) {
        if (next.guildId !== guildId || next.userId !== userId)
          throw new Error('Honeypot record key mismatch');
        (records[guildId] ??= {})[userId] = next;
      } else if (records[guildId]) {
        delete records[guildId][userId];
        if (Object.keys(records[guildId]).length === 0) delete records[guildId];
      }
      validate(records);
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
    clearInterval(heartbeat);
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
