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
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const selectionMessages = new Map<string, string>();
const roleChanges = new Map<string, Promise<void>>();
const storagePath = () =>
  resolve(process.env.GAME_SELECTION_DATA_FILE ?? 'data/game-selection.json');

export function isGameSelectionMessage(channelId: string, messageId: string) {
  return selectionMessages.get(channelId) === messageId;
}

export async function loadGameSelectionMessage(
  channelId: string,
): Promise<string | undefined> {
  try {
    const saved = JSON.parse(await readFile(storagePath(), 'utf8'));
    return saved.channelId === channelId && typeof saved.messageId === 'string'
      ? saved.messageId
      : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function saveGameSelectionMessage(
  channelId: string,
  messageId: string,
) {
  const path = storagePath();
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporaryPath, JSON.stringify({ channelId, messageId }));
    await rename(temporaryPath, path);
    selectionMessages.set(channelId, messageId);
  } finally {
    await rm(temporaryPath, { force: true });
  }
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
