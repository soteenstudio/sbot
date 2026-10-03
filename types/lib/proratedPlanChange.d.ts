/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
import type { SubscriptionRecord } from './subscriptionStore.js';
import { type SubscriptionDuration } from './subscriptionPrices.js';
export type PlanChangeDirection = 'upgrade' | 'downgrade';
export interface PlanChangeQuote {
    direction: PlanChangeDirection;
    fromRoleId: string;
    toRoleId: string;
    toDurationMonths: SubscriptionDuration;
    at: number;
    credit: number;
    newPrice: number;
    amountToPay: number;
    creditBalance: number;
    newExpiresAt: number;
}
export declare function calculatePlanChange(record: SubscriptionRecord, targetRoleId: string, durationMonths: SubscriptionDuration, direction: PlanChangeDirection, at: number): PlanChangeQuote;
