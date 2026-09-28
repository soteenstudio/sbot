/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
export type TTSUsage = {
    count: number;
    lastReset: number;
    pending: Record<string, number>;
};
export declare const RESERVATION_TTL_MS: number;
export declare function getTTSUsage(userId: string, now: number): Promise<TTSUsage>;
export declare function reserveTTSUsage(userId: string, now: number, limit: number): Promise<{
    usage: TTSUsage;
    reservationId: string | null;
}>;
export declare function finishTTSUsage(userId: string, lastReset: number, reservationId: string, refund: boolean): Promise<boolean>;
