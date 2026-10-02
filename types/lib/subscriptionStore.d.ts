/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
export interface SubscriptionRecord {
    userId: string;
    guildId: string;
    roleId: string;
    durationMonths: number;
    expiresAt: number;
}
export interface RenewalApproval {
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
    getRenewalApproval(requestId: string): Promise<RenewalApproval | undefined>;
    saveRenewalApproval(record: SubscriptionRecord, approval: RenewalApproval): Promise<void>;
    get(guildId: string, userId: string): Promise<SubscriptionRecord | undefined>;
    set(record: SubscriptionRecord): Promise<void>;
    delete(guildId: string, userId: string): Promise<void>;
    getAll(): Promise<SubscriptionRecord[]>;
};
