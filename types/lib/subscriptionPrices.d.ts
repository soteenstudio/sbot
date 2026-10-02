/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
export declare const SUBSCRIPTION_TIERS: readonly ["DONATUR", "BILLION", "RICHMAN"];
export declare const SUBSCRIPTION_DURATIONS: readonly [1, 6, 12];
export type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[number];
export type SubscriptionDuration = (typeof SUBSCRIPTION_DURATIONS)[number];
export interface SubscriptionCurrency {
    code: string;
    minorUnitDigits: number;
}
export declare const subscriptionPrices: {
    currency: SubscriptionCurrency | undefined;
    prices: Record<SubscriptionTier, Record<SubscriptionDuration, number | undefined>>;
};
export declare function validateMoney(amount: number): void;
export declare function getSubscriptionPrice(tier: string, duration: number): number;
export interface RefundBreakdown {
    gross: number;
    tax: number;
    net: number;
}
export declare function calculateRefundDeduction(gross: number): RefundBreakdown;
export declare function formatSubscriptionMoney(amount: number, currency: SubscriptionCurrency): string;
