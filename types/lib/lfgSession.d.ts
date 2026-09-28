/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
import { type ActiveLFGSession } from './lfg-data.js';
export type LFGSession = Omit<ActiveLFGSession, 'participantIds' | 'kickedIds'> & {
    participantIds: string[];
    kickedIds: string[];
};
export declare function toLFGSession(session: ActiveLFGSession): LFGSession;
export declare function toActiveLFGSession(session: LFGSession): ActiveLFGSession;
export declare function restoreLFGSessions(): Promise<void>;
export declare function getLFGSession(hostId: string): Promise<LFGSession | null>;
export declare function getAllLFGSessions(): Promise<LFGSession[]>;
export declare function saveLFGSession(session: ActiveLFGSession): Promise<void>;
export declare function deleteLFGSession(hostId: string): Promise<boolean>;
