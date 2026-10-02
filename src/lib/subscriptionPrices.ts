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

export const SUBSCRIPTION_TIERS = ['DONATUR', 'BILLION', 'RICHMAN'] as const;
export const SUBSCRIPTION_DURATIONS = [1, 6, 12] as const;
export type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[number];
export type SubscriptionDuration = (typeof SUBSCRIPTION_DURATIONS)[number];

export interface SubscriptionCurrency {
  code: string;
  minorUnitDigits: number;
}

export const subscriptionPrices: {
  currency: SubscriptionCurrency | undefined;
  prices: Record<
    SubscriptionTier,
    Record<SubscriptionDuration, number | undefined>
  >;
} = {
  currency: { code: 'IDR', minorUnitDigits: 0 },
  prices: {
    DONATUR: { 1: 10_000, 6: 60_000, 12: 120_000 },
    BILLION: { 1: 25_000, 6: 150_000, 12: 300_000 },
    RICHMAN: { 1: 50_000, 6: 300_000, 12: 600_000 },
  },
};

export function validateMoney(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0)
    throw new Error(
      'Amount must be a positive safe integer in currency minor units',
    );
}

export function getSubscriptionPrice(tier: string, duration: number): number {
  if (
    !SUBSCRIPTION_TIERS.includes(tier as SubscriptionTier) ||
    !SUBSCRIPTION_DURATIONS.includes(duration as SubscriptionDuration)
  )
    throw new Error('Unsupported subscription tier or duration');
  if (!subscriptionPrices.currency)
    throw new Error('Subscription currency is unconfigured');
  const amount =
    subscriptionPrices.prices[tier as SubscriptionTier][
      duration as SubscriptionDuration
    ];
  if (amount === undefined)
    throw new Error('Subscription price is unconfigured');
  validateMoney(amount);
  return amount;
}

export function getPaymentAmount(
  roleId: string,
  durationMonths: number,
): { amount: number; text: string } {
  const tier = SUBSCRIPTION_TIERS.find(
    (key) => roleId && Roles[key].id === roleId,
  );
  if (!tier)
    throw new Error('Subscription tier is unconfigured or unsupported');
  const amount = getSubscriptionPrice(tier, durationMonths);
  const currency = subscriptionPrices.currency;
  if (!currency) throw new Error('Subscription currency is unconfigured');
  return { amount, text: formatSubscriptionMoney(amount, currency) };
}

export interface RefundBreakdown {
  gross: number;
  tax: number;
  net: number;
}

export function calculateRefundDeduction(gross: number): RefundBreakdown {
  validateMoney(gross);
  const tax = Number((BigInt(gross) * 5n + 50n) / 100n);
  return { gross, tax, net: gross - tax };
}

export function formatSubscriptionMoney(
  amount: number,
  currency: SubscriptionCurrency,
): string {
  if (!Number.isSafeInteger(amount) || amount < 0)
    throw new Error(
      'Amount must be a nonnegative safe integer in currency minor units',
    );
  if (
    !/^[A-Z]{3}$/.test(currency.code) ||
    !Number.isInteger(currency.minorUnitDigits) ||
    currency.minorUnitDigits < 0 ||
    currency.minorUnitDigits > 6
  )
    throw new Error('Invalid currency configuration');
  const digits = BigInt(amount)
    .toString()
    .padStart(currency.minorUnitDigits + 1, '0');
  const integerDigits =
    currency.minorUnitDigits === 0
      ? digits
      : digits.slice(0, -currency.minorUnitDigits);
  const groupedInteger = integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const value =
    currency.minorUnitDigits === 0
      ? groupedInteger
      : `${groupedInteger},${digits.slice(-currency.minorUnitDigits)}`;
  return `${currency.code} ${value}`;
}

export function snapshotPaidPeriod(
  tier: string,
  duration: number,
  startAt: number,
  endAt: number,
) {
  const price = getSubscriptionPrice(tier, duration);
  const currency = { ...subscriptionPrices.currency! };
  formatSubscriptionMoney(price, currency);
  if (
    ![startAt, endAt].every(Number.isSafeInteger) ||
    startAt < 0 ||
    endAt <= startAt
  )
    throw new Error('Invalid paid period timestamps');
  return { startAt, endAt, price, currency, source: 'testing' as const };
}
