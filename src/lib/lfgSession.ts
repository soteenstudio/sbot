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
import { activeLFG, type ActiveLFGSession } from './lfg-data.js';

export type LFGSession = Omit<ActiveLFGSession, 'participantIds' | 'kickedIds'> & {
  participantIds: string[];
  kickedIds: string[];
};

type LFGRecords = Record<string, LFGSession>;

export function toLFGSession(session: ActiveLFGSession): LFGSession {
  return {
    ...session,
    participantIds: [...session.participantIds],
    kickedIds: [...session.kickedIds],
  };
}

export function toActiveLFGSession(session: LFGSession): ActiveLFGSession {
  return {
    ...session,
    participantIds: new Set(session.participantIds),
    kickedIds: new Set(session.kickedIds),
  };
}

export async function restoreLFGSessions(): Promise<void> {
  const records = await getAllLFGSessions();
  activeLFG.clear();
  for (const session of records) {
    activeLFG.set(session.authorId, toActiveLFGSession(session));
  }
}

const lfgPath = () =>
  resolve(process.env.LFG_DATA_FILE ?? 'data/lfg-sessions.json');

async function readLFG(path: string): Promise<LFGRecords> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as LFGRecords;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

async function updateLFG<T>(
  change: (records: LFGRecords) => [T, boolean],
): Promise<T> {
  const path = lfgPath();
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
      throw new Error('LFG storage is busy');
    await new Promise((done) => setTimeout(done, 25));
  }

  try {
    const records = await readLFG(path);
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

export async function getLFGSession(hostId: string): Promise<LFGSession | null> {
  const records = await readLFG(lfgPath());
  return records[hostId] ?? null;
}

export async function getAllLFGSessions(): Promise<LFGSession[]> {
  return Object.values(await readLFG(lfgPath()));
}

export async function saveLFGSession(session: ActiveLFGSession): Promise<void> {
  await updateLFG((records) => {
    records[session.authorId] = toLFGSession(session);
    return [undefined, true];
  });
}

export async function deleteLFGSession(hostId: string): Promise<boolean> {
  return updateLFG((records) => {
    if (!records[hostId]) return [false, false];
    delete records[hostId];
    return [true, true];
  });
}
