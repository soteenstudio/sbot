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
import { activePolls, type ActivePoll } from './pollData.js';

export type StoredPoll = Omit<ActivePoll, 'votes' | 'voters'> & {
  votes: [number, number][];
  voters: string[];
};

type PollRecords = {
  polls: Record<string, StoredPoll>;
  cooldowns: Record<string, number>;
};

export function toStoredPoll(poll: ActivePoll): StoredPoll {
  return { ...poll, votes: [...poll.votes], voters: [...poll.voters] };
}

export function toActivePoll(poll: StoredPoll): ActivePoll {
  return { ...poll, votes: new Map(poll.votes), voters: new Set(poll.voters) };
}

const pollPath = () => resolve(process.env.POLL_DATA_FILE ?? 'data/polls.json');

async function readPolls(path: string): Promise<PollRecords> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as PollRecords;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { polls: {}, cooldowns: {} };
    throw error;
  }
}

async function updatePolls<T>(
  change: (records: PollRecords) => [T, boolean],
): Promise<T> {
  const path = pollPath();
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
    if (Date.now() - started > 35_000) throw new Error('Poll storage is busy');
    await new Promise((done) => setTimeout(done, 25));
  }

  try {
    const records = await readPolls(path);
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
    // Keep the in-memory cache in step with the committed state while locked.
    activePolls.clear();
    for (const poll of Object.values(records.polls))
      activePolls.set(poll.authorId, toActivePoll(poll));
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

export async function restorePolls(): Promise<void> {
  const records = await readPolls(pollPath());
  activePolls.clear();
  for (const poll of Object.values(records.polls))
    activePolls.set(poll.authorId, toActivePoll(poll));
}

export async function getPoll(authorId: string): Promise<ActivePoll | null> {
  const poll = (await readPolls(pollPath())).polls[authorId];
  return poll ? toActivePoll(poll) : null;
}

export async function savePoll(poll: ActivePoll): Promise<boolean> {
  return updatePolls((records) => {
    if (records.polls[poll.authorId]) return [false, false];
    records.polls[poll.authorId] = toStoredPoll(poll);
    return [true, true];
  });
}

export type VoteResult = 'accepted' | 'duplicate' | 'closed' | 'invalid';

export async function recordVote(
  authorId: string,
  messageId: string,
  option: number,
  voterId: string,
): Promise<VoteResult> {
  return updatePolls((records) => {
    const stored = records.polls[authorId];
    if (!stored || stored.messageId !== messageId) return ['closed', false];
    if (
      !Number.isInteger(option) ||
      option < 1 ||
      option > stored.options.length
    )
      return ['invalid', false];
    const poll = toActivePoll(stored);
    if (poll.voters.has(voterId)) return ['duplicate', false];
    poll.voters.add(voterId);
    poll.votes.set(option, (poll.votes.get(option) ?? 0) + 1);
    records.polls[authorId] = toStoredPoll(poll);
    return ['accepted', true];
  });
}

export async function deletePoll(authorId: string): Promise<ActivePoll | null> {
  return updatePolls((records) => {
    const poll = records.polls[authorId];
    if (!poll) return [null, false];
    delete records.polls[authorId];
    return [toActivePoll(poll), true];
  });
}

export async function checkAndRecordPollCooldown(
  authorId: string,
  now: number,
  duration: number,
): Promise<number> {
  return updatePolls((records) => {
    const lastUsed = records.cooldowns[authorId];
    const remaining = lastUsed ? duration - (now - lastUsed) : 0;
    if (remaining > 0) return [remaining, false];
    records.cooldowns[authorId] = now;
    return [0, true];
  });
}
