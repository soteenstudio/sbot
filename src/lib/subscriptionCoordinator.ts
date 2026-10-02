/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

// Keep the complete role/storage transaction separate from the file IO queue.
// Callers must not recursively acquire the same guild/user key.
const changes = new Map<string, Promise<void>>();

export async function coordinateSubscriptionChange<T>(
  guildId: string,
  userId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = JSON.stringify([guildId, userId]);
  const result = (changes.get(key) ?? Promise.resolve()).then(operation);
  const settled = result.then(
    () => {},
    () => {},
  );
  changes.set(key, settled);
  try {
    return await result;
  } finally {
    if (changes.get(key) === settled) changes.delete(key);
  }
}
