/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
import { type GuildMember } from 'discord.js';
import type { SubscriptionRecord } from './subscriptionStore.js';
export declare function notifyBuyerOfPurchase(member: GuildMember, purchase: Pick<SubscriptionRecord, 'roleId' | 'durationMonths' | 'expiresAt'>): Promise<void>;
export declare function notifyBuyerOfRenewal(member: GuildMember, purchase: Pick<SubscriptionRecord, 'roleId' | 'durationMonths' | 'expiresAt'>): Promise<void>;
