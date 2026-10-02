/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

export const SUBSCRIPTION_TIERS = ['DONATUR', 'BILLION', 'RICHMAN'] as const;
export const SUBSCRIPTION_DURATIONS = [1, 6, 12] as const;
export type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[number];
export type SubscriptionDuration = (typeof SUBSCRIPTION_DURATIONS)[number];

export interface SubscriptionCurrency {
  code: string;
  minorUnitDigits: number;
}

// Await the owner's currency and prices. Catalogue prices are not payment history.
export const subscriptionPrices: {
  currency: SubscriptionCurrency | undefined;
  prices: Record<
    SubscriptionTier,
    Record<SubscriptionDuration, number | undefined>
  >;
} = {
  currency: undefined,
  prices: {
    DONATUR: { 1: undefined, 6: undefined, 12: undefined },
    BILLION: { 1: undefined, 6: undefined, 12: undefined },
    RICHMAN: { 1: undefined, 6: undefined, 12: undefined },
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

export interface RefundBreakdown {
  gross: number;
  tax: number;
  net: number;
}

// Round the 5% deduction to the nearest minor unit, with ties rounded up.
// BigInt keeps the intermediate calculation exact even at MAX_SAFE_INTEGER.
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
  const value =
    currency.minorUnitDigits === 0
      ? digits
      : `${digits.slice(0, -currency.minorUnitDigits)}.${digits.slice(-currency.minorUnitDigits)}`;
  return `${currency.code} ${value}`;
}
