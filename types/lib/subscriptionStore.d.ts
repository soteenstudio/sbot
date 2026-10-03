/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
import type { PlanChangeDirection, PlanChangeQuote } from './proratedPlanChange.js';
import type { SubscriptionDuration } from './subscriptionPrices.js';
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
export interface RefundRequest {
    requestId: string;
    guildId: string;
    userId: string;
    roleId: string;
    subscriptionId: string;
    requestedBy: string;
    requesterTag: string;
    requestedAt: number;
    logChannelId: string;
    logMessageId?: string;
    commandChannelId?: string;
    announced?: boolean;
    status: 'logging' | 'logged' | 'verified' | 'completed';
    refundId?: string;
    verifiedBy?: string;
    verifiedAt?: number;
}
export interface PlanChangeRequest {
    id: string;
    subscriptionId: string;
    userId: string;
    guildId: string;
    fromRoleId: string;
    toRoleId: string;
    durationMonths: SubscriptionDuration;
    direction: PlanChangeDirection;
    requestedBy: string;
    requestedAt: number;
    commandChannelId: string;
    announced: boolean;
    logChannelId: string;
    logMessageId?: string;
    status: 'logging' | 'logged' | 'verified' | 'completed' | 'failed';
}
export interface PlanChangeReceipt extends PlanChangeQuote {
    id: string;
    subscriptionId: string;
    guildId: string;
    userId: string;
    oldRoleId: string;
    oldPaidPeriods: PaidPeriod[];
    newPaidPeriod: PaidPeriod;
    verifiedAt: number;
    verifiedBy: string;
}
export interface SubscriptionRecord {
    subscriptionId?: string;
    paidPeriods?: PaidPeriod[];
    paymentHistoryComplete?: boolean;
    pendingRefundId?: string;
    pendingPlanChangeId?: string;
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
    approvedById?: string;
}
export interface ApprovalOrigin {
    commandChannelId: string;
    announced: boolean;
}
export declare const PLAN_CHANGE_PENDING = "Subscription plan change is pending; retry /subscription upgrade or /subscription downgrade";
export declare const subscriptionStore: {
    getPlanChangeRequest(id: string): Promise<PlanChangeRequest | undefined>;
    getPlanChangeReceipt(id: string): Promise<PlanChangeReceipt | undefined>;
    findActivePlanChange(subscriptionId: string): Promise<PlanChangeRequest | undefined>;
    createPlanChangeRequest(request: PlanChangeRequest): Promise<PlanChangeRequest>;
    bindPlanChangeLog(id: string, channelId: string, messageId: string): Promise<PlanChangeRequest>;
    beginPlanChange(id: string, receipt: PlanChangeReceipt): Promise<PlanChangeReceipt>;
    abortPlanChange(id: string): Promise<void>;
    completePlanChange(id: string): Promise<PlanChangeReceipt>;
    saveApprovalOrigin(key: string, commandChannelId: string): Promise<void>;
    getApprovalOrigin(key: string): Promise<ApprovalOrigin | undefined>;
    markAnnounced(key: string): Promise<boolean>;
    getRefundRequest(requestId: string): Promise<RefundRequest | undefined>;
    createRefundRequest(request: RefundRequest): Promise<RefundRequest>;
    bindRefundLog(requestId: string, channelId: string, messageId: string): Promise<RefundRequest>;
    verifyRefundRequest(requestId: string, receipt: RefundReceipt, verifiedAt: number): Promise<RefundReceipt>;
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
