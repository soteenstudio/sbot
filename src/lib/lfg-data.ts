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
const pendingRequestCooldowns = new WeakMap<
  ActiveLFGSession,
  Map<string, number>
>();
const sendingRequests = new WeakMap<ActiveLFGSession, Set<string>>();
export const LFG_DECLINE_COOLDOWN_MS = 180_000;
export const LFG_PENDING_REQUEST_COOLDOWN_MS = 60_000;

export function formatLFGCooldown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  const minuteText = `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const secondText = `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;

  if (minutes === 0) return secondText;
  if (seconds === 0) return minuteText;
  return `${minuteText} ${secondText}`;
}

function cooldownRemaining(
  cooldowns: WeakMap<ActiveLFGSession, Map<string, number>>,
  session: ActiveLFGSession,
  joinerId: string,
  now: number,
): number {
  const entries = cooldowns.get(session);
  if (entries) {
    for (const [id, deadline] of entries) {
      if (deadline <= now) entries.delete(id);
    }
  }
  const expiresAt = entries?.get(joinerId) ?? 0;
  if (expiresAt <= now) {
    entries?.delete(joinerId);
    if (entries?.size === 0) cooldowns.delete(session);
    return 0;
  }
  return expiresAt - now;
}

function recordCooldown(
  cooldowns: WeakMap<ActiveLFGSession, Map<string, number>>,
  session: ActiveLFGSession,
  joinerId: string,
  duration: number,
  now: number,
): void {
  let entries = cooldowns.get(session);
  if (!entries) {
    entries = new Map();
    cooldowns.set(session, entries);
  }
  for (const [id, deadline] of entries) {
    if (deadline <= now) entries.delete(id);
  }
  entries.set(joinerId, now + duration);
}

export function declineCooldownRemaining(
  session: ActiveLFGSession,
  joinerId: string,
  now = Date.now(),
): number {
  return cooldownRemaining(declineCooldowns, session, joinerId, now);
}

export function recordLFGDecline(
  session: ActiveLFGSession,
  joinerId: string,
  now = Date.now(),
): void {
  recordCooldown(
    declineCooldowns,
    session,
    joinerId,
    LFG_DECLINE_COOLDOWN_MS,
    now,
  );
}

export function pendingRequestCooldownRemaining(
  session: ActiveLFGSession,
  joinerId: string,
  now = Date.now(),
): number {
  return cooldownRemaining(pendingRequestCooldowns, session, joinerId, now);
}

export function startLFGRequestSend(
  session: ActiveLFGSession,
  joinerId: string,
): boolean {
  if (pendingRequestCooldownRemaining(session, joinerId)) return false;
  let senders = sendingRequests.get(session);
  if (!senders) {
    senders = new Set();
    sendingRequests.set(session, senders);
  }
  if (senders.has(joinerId)) return false;
  senders.add(joinerId);
  return true;
}

export function finishLFGRequestSend(
  session: ActiveLFGSession,
  joinerId: string,
  sent: boolean,
  now = Date.now(),
): void {
  if (sent)
    recordCooldown(
      pendingRequestCooldowns,
      session,
      joinerId,
      LFG_PENDING_REQUEST_COOLDOWN_MS,
      now,
    );
  const senders = sendingRequests.get(session);
  senders?.delete(joinerId);
  if (senders?.size === 0) sendingRequests.delete(session);
}

export function clearPendingLFGRequest(
  session: ActiveLFGSession,
  joinerId: string,
): void {
  const entries = pendingRequestCooldowns.get(session);
  entries?.delete(joinerId);
  if (entries?.size === 0) pendingRequestCooldowns.delete(session);
}
