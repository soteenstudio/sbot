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
export declare function validatePaidPeriods(periods: PaidPeriod[]): {
    code: string;
    minorUnitDigits: number;
};
export declare function calculateUnusedValue(record: SubscriptionRecord, refundAt: number): {
    gross: number;
    currency: {
        code: string;
        minorUnitDigits: number;
    };
};
export declare function calculateProportionalRefund(record: SubscriptionRecord, refundAt: number): {
    currency: {
        code: string;
        minorUnitDigits: number;
    };
    gross: number;
    tax: number;
    net: number;
};
