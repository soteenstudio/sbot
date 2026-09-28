/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

export type ActiveLFGSession = {
  game: string;
  rank: string;
  maxPlayers: number;
  author: string;
  authorId: string;
  channelId: string;
  messageId: string;
  vcId: string;
  participantIds: Set<string>;
  kickedIds: Set<string>;
};

/** Active sessions are keyed by their host's user ID. */
export const activeLFG = new Map<string, ActiveLFGSession>();
/** Sessions visible in memory while their first write is still pending. */
export const pendingLFGInitialSaves = new WeakSet<ActiveLFGSession>();

const declineCooldowns = new WeakMap<ActiveLFGSession, Map<string, number>>();
export const LFG_DECLINE_COOLDOWN_MS = 60_000;

export function declineCooldownRemaining(
  session: ActiveLFGSession,
  joinerId: string,
  now = Date.now(),
): number {
  const expiresAt = declineCooldowns.get(session)?.get(joinerId) ?? 0;
  if (expiresAt <= now) {
    declineCooldowns.get(session)?.delete(joinerId);
    return 0;
  }
  return expiresAt - now;
}

export function recordLFGDecline(
  session: ActiveLFGSession,
  joinerId: string,
  now = Date.now(),
): void {
  let cooldowns = declineCooldowns.get(session);
  if (!cooldowns) {
    cooldowns = new Map();
    declineCooldowns.set(session, cooldowns);
  }
  cooldowns.set(joinerId, now + LFG_DECLINE_COOLDOWN_MS);
}
