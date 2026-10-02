/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
import type { Guild } from 'discord.js';
export type ApprovalKind = 'Buy' | 'Renew' | 'Refund';
export declare function announceApproval(guild: Guild, channelId: string | undefined, approverId: string, kind: ApprovalKind): Promise<void>;
export declare function announceSavedApproval(guild: Guild, key: string, approverId: string, kind: ApprovalKind): Promise<void>;
