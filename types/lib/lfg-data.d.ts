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
export declare const activeLFG: Map<string, ActiveLFGSession>;
/** Sessions visible in memory while their first write is still pending. */
export declare const pendingLFGInitialSaves: WeakSet<ActiveLFGSession>;
export declare const LFG_DECLINE_COOLDOWN_MS = 180000;
export declare const LFG_PENDING_REQUEST_COOLDOWN_MS = 60000;
export declare function declineCooldownRemaining(session: ActiveLFGSession, joinerId: string, now?: number): number;
export declare function recordLFGDecline(session: ActiveLFGSession, joinerId: string, now?: number): void;
export declare function pendingRequestCooldownRemaining(session: ActiveLFGSession, joinerId: string, now?: number): number;
export declare function startLFGRequestSend(session: ActiveLFGSession, joinerId: string): boolean;
export declare function finishLFGRequestSend(session: ActiveLFGSession, joinerId: string, sent: boolean, now?: number): void;
export declare function clearPendingLFGRequest(session: ActiveLFGSession, joinerId: string): void;
