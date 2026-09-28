/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
import { type ActivePoll } from './pollData.js';
export type StoredPoll = Omit<ActivePoll, 'votes' | 'voters'> & {
    votes: [number, number][];
    voters: string[];
};
export declare function toStoredPoll(poll: ActivePoll): StoredPoll;
export declare function toActivePoll(poll: StoredPoll): ActivePoll;
export declare function restorePolls(): Promise<void>;
export declare function getPoll(authorId: string): Promise<ActivePoll | null>;
export declare function savePoll(poll: ActivePoll): Promise<boolean>;
export type VoteResult = 'accepted' | 'duplicate' | 'closed' | 'invalid';
export declare function recordVote(authorId: string, messageId: string, option: number, voterId: string): Promise<VoteResult>;
export declare function deletePoll(authorId: string): Promise<ActivePoll | null>;
export declare function checkAndRecordPollCooldown(authorId: string, now: number, duration: number): Promise<number>;
