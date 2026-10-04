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
import type { PlanChangeRequest, PlanChangeReceipt } from './subscriptionStore.js';
export declare function notifyBuyerOfPlanChange(member: GuildMember, request: PlanChangeRequest, receipt: PlanChangeReceipt): Promise<void>;
