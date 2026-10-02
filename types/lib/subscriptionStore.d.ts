/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
import type { SubscriptionCurrency } from './subscriptionPrices.js';
export interface PaidPeriod {
    startAt: number;
    endAt: number;
    price: number;
    currency: SubscriptionCurrency;
    source: 'testing' | 'verified';
}
export interface RefundReceipt {
    refundId: string;
    subscriptionId: string;
    guildId: string;
    userId: string;
    roleId: string;
    refundAt: number;
    gross: number;
    tax: number;
    net: number;
    currency: SubscriptionCurrency;
    staffId: string;
    staffTag: string;
    status: 'pending' | 'completed';
}
export interface SubscriptionRecord {
    subscriptionId?: string;
    paidPeriods?: PaidPeriod[];
    paymentHistoryComplete?: boolean;
    pendingRefundId?: string;
    userId: string;
    guildId: string;
    roleId: string;
    durationMonths: number;
    expiresAt: number;
}
export interface RenewalApproval {
    subscriptionId?: string;
    paidPeriod?: PaidPeriod;
    requestId: string;
    userId: string;
    guildId: string;
    roleId: string;
    durationMonths: number;
    expiresAt: number;
    approvedAt: number;
    approvedBy: string;
}
export declare const subscriptionStore: {
    getRefund(refundId: string): Promise<RefundReceipt | undefined>;
    findRefund(guildId: string, userId: string): Promise<RefundReceipt | undefined>;
    beginRefund(receipt: RefundReceipt): Promise<RefundReceipt>;
    completeRefund(refundId: string): Promise<RefundReceipt>;
    getRenewalApproval(requestId: string): Promise<RenewalApproval | undefined>;
    saveRenewalApproval(record: SubscriptionRecord, approval: RenewalApproval): Promise<void>;
    get(guildId: string, userId: string): Promise<SubscriptionRecord | undefined>;
    set(record: SubscriptionRecord): Promise<void>;
    delete(guildId: string, userId: string): Promise<void>;
    getAll(): Promise<SubscriptionRecord[]>;
};
