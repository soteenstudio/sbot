/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
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
export declare function getHoneypotRecord(guildId: string, userId: string): Promise<HoneypotRecord | null>;
export declare function getAllHoneypotRecords(): Promise<HoneypotRecord[]>;
export declare function updateHoneypotRecord<T>(guildId: string, userId: string, change: (current: HoneypotRecord | null) => Promise<[HoneypotRecord | null, T]> | [HoneypotRecord | null, T]): Promise<T>;
