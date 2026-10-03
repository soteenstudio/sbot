/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
import { type Guild } from 'discord.js';
export declare function logRoleChange(guild: Guild, change: {
    buyerId: string;
    fromRoleId: string;
    toRoleId?: string;
    reason: 'Upgrade' | 'Downgrade' | 'Expired';
    staffId?: string;
    subscriptionId?: string;
}): Promise<void>;
