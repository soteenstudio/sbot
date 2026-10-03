/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { Roles } from '../config.js';
import type { SubscriptionRecord } from './subscriptionStore.js';
import { calculateUnusedValue } from './proportionalRefund.js';
import {
  getPaymentAmount,
  getSubscriptionPrice,
  SUBSCRIPTION_TIERS,
  subscriptionPrices,
  type SubscriptionDuration,
} from './subscriptionPrices.js';

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
export function calculatePlanChange(
  record: SubscriptionRecord,
  targetRoleId: string,
  durationMonths: SubscriptionDuration,
  direction: PlanChangeDirection,
  at: number,
): PlanChangeQuote {
  const from = SUBSCRIPTION_TIERS.find(
    (t) => Roles[t].id && Roles[t].id === record.roleId,
  );
  const to = SUBSCRIPTION_TIERS.find(
    (t) => Roles[t].id && Roles[t].id === targetRoleId,
  );
  if (!from || !to)
    throw new Error('Subscription tier is unconfigured or unsupported');
  if (from === to)
    throw new Error('Same tier selected; use /subscription renew');
  const difference =
    getSubscriptionPrice(to, 1) - getSubscriptionPrice(from, 1);
  if (
    (direction !== 'upgrade' && direction !== 'downgrade') ||
    (direction === 'upgrade' ? difference <= 0 : difference >= 0)
  )
    throw new Error('Incorrect tier direction');
  const { gross: credit, currency } = calculateUnusedValue(record, at);
  const newPrice = getPaymentAmount(targetRoleId, durationMonths).amount;
  if (
    currency.code !== subscriptionPrices.currency!.code ||
    currency.minorUnitDigits !== subscriptionPrices.currency!.minorUnitDigits
  )
    throw new Error('Payment metadata repair required: currency mismatch');
  const newExpiresAt = at + durationMonths * 30 * 24 * 60 * 60 * 1000;
  if (!Number.isSafeInteger(newExpiresAt))
    throw new Error('Invalid plan expiration');
  return {
    direction,
    fromRoleId: record.roleId,
    toRoleId: targetRoleId,
    toDurationMonths: durationMonths,
    at,
    credit,
    newPrice,
    amountToPay: Math.max(newPrice - credit, 0),
    creditBalance: Math.max(credit - newPrice, 0),
    newExpiresAt,
  };
}
