/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import type { PaidPeriod, SubscriptionRecord } from './subscriptionStore.js';
import {
  calculateRefundDeduction,
  formatSubscriptionMoney,
  validateMoney,
} from './subscriptionPrices.js';

export function validatePaidPeriods(periods: PaidPeriod[]) {
  if (!Array.isArray(periods) || !periods.length)
    throw new Error('Payment metadata repair required: missing paid periods');
  const currency = periods[0].currency;
  formatSubscriptionMoney(0, currency);
  for (const period of periods) {
    if (
      ![period.startAt, period.endAt].every(
        (t) => Number.isSafeInteger(t) && t >= 0,
      ) ||
      period.endAt <= period.startAt
    )
      throw new Error(
        'Payment metadata repair required: invalid period timestamps',
      );
    validateMoney(period.price);
    formatSubscriptionMoney(0, period.currency);
    if (
      period.currency.code !== currency.code ||
      period.currency.minorUnitDigits !== currency.minorUnitDigits
    )
      throw new Error('Payment metadata repair required: currency mismatch');
    if (!['testing', 'verified'].includes(period.source))
      throw new Error(
        'Payment metadata repair required: missing payment source',
      );
  }
  const ordered = [...periods].sort((a, b) => a.startAt - b.startAt);
  if (ordered.some((p, i) => i > 0 && p.startAt < ordered[i - 1].endAt))
    throw new Error('Payment metadata repair required: overlapping periods');
  return { ...currency };
}

export function calculateUnusedValue(
  record: SubscriptionRecord,
  refundAt: number,
) {
  if (!Number.isSafeInteger(refundAt) || refundAt < 0)
    throw new Error('Invalid refund timestamp');
  if (
    !record.subscriptionId ||
    record.paymentHistoryComplete !== true ||
    !record.paidPeriods
  )
    throw new Error(
      'Payment metadata repair required: incomplete historical payments',
    );
  const currency = validatePaidPeriods(record.paidPeriods);
  if (
    !Number.isSafeInteger(record.expiresAt) ||
    record.expiresAt !== Math.max(...record.paidPeriods.map((p) => p.endAt))
  )
    throw new Error(
      'Payment metadata repair required: expiration does not match paid periods',
    );
  if (refundAt >= record.expiresAt)
    throw new Error('No refundable time remains');
  let numerator = 0n,
    denominator = 1n,
    total = 0n;
  const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));
  for (const period of record.paidPeriods) {
    const duration = BigInt(period.endAt) - BigInt(period.startAt);
    const remaining = BigInt(
      Math.max(
        0,
        Math.min(period.endAt - refundAt, period.endAt - period.startAt),
      ),
    );
    numerator =
      numerator * duration + BigInt(period.price) * remaining * denominator;
    denominator *= duration;
    const divisor = gcd(numerator, denominator);
    numerator /= divisor;
    denominator /= divisor;
    total += BigInt(period.price);
  }
  const gross = (2n * numerator + denominator) / (2n * denominator);
  if (gross === 0n) throw new Error('No refundable time remains');
  if (gross > total || gross > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('Refund amount exceeds safe money range');
  return { gross: Number(gross), currency };
}

export function calculateProportionalRefund(
  record: SubscriptionRecord,
  refundAt: number,
) {
  const { gross, currency } = calculateUnusedValue(record, refundAt);
  return { ...calculateRefundDeduction(gross), currency };
}
