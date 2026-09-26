/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

const cleanups: Array<(now: number) => void> = [];
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

export function runUsageCleanup(now = Date.now()): void {
  for (const cleanup of cleanups) cleanup(now);
}

export function registerUsageCleanup(cleanup: (now: number) => void): void {
  cleanups.push(cleanup);
  if (cleanups.length === 1) {
    setInterval(runUsageCleanup, CLEANUP_INTERVAL_MS).unref();
  }
}
