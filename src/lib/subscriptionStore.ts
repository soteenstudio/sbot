/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
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
  status: 'logging' | 'logged' | 'verified' | 'completed';
  refundId?: string;
  verifiedBy?: string;
  verifiedAt?: number;
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

interface Storage {
  version: 2;
  subscriptions: Records;
  renewalApprovals: Record<string, RenewalApproval>;
  refunds: Record<string, RefundReceipt>;
  refundRequests: Record<string, RefundRequest>;
}

type Records = Record<string, Record<string, SubscriptionRecord>>;

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'subscriptions.json');
let storageQueue: Promise<void> = Promise.resolve();

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageQueue.then(operation);
  storageQueue = result.then(
    () => {},
    () => {},
  );
  return result;
}

async function replaceStorage(data: Storage): Promise<void> {
  const temporaryFile = `${DATA_FILE}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryFile, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(temporaryFile, DATA_FILE);
  } finally {
    await fs.rm(temporaryFile, { force: true });
  }
}

async function ensureDataFile(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch (error) {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    )
      throw error;
    await replaceStorage({
      version: 2,
      subscriptions: {},
      renewalApprovals: {},
      refunds: {},
      refundRequests: {},
    });
  }
}

async function readStorage(): Promise<Storage> {
  await ensureDataFile();
  const rawData = await fs.readFile(DATA_FILE, 'utf-8');
  const parsed = JSON.parse(rawData);
  if (parsed.version === 2)
    return { ...parsed, refundRequests: parsed.refundRequests ?? {} };
  if (parsed.version === 1)
    return {
      ...parsed,
      version: 2,
      refunds: parsed.refunds ?? {},
      refundRequests: parsed.refundRequests ?? {},
    };
  if ('version' in parsed)
    throw new Error('Unsupported subscription storage version');
  return {
    version: 2,
    subscriptions: parsed,
    renewalApprovals: {},
    refunds: {},
    refundRequests: {},
  };
}

async function writeStorage(data: Storage): Promise<void> {
  await ensureDataFile();
  await replaceStorage(data);
}

function assertNotCancelling(record: SubscriptionRecord | undefined) {
  if (record?.pendingRefundId)
    throw new Error('Subscription cancellation is pending; retry /refund');
}

export const subscriptionStore = {
  async getRefundRequest(
    requestId: string,
  ): Promise<RefundRequest | undefined> {
    return enqueue(async () => (await readStorage()).refundRequests[requestId]);
  },
  async createRefundRequest(request: RefundRequest): Promise<RefundRequest> {
    return enqueue(async () => {
      const data = await readStorage();
      const record = data.subscriptions[request.guildId]?.[request.userId];
      if (
        !record ||
        record.subscriptionId !== request.subscriptionId ||
        record.roleId !== request.roleId
      )
        throw new Error('Subscription changed');
      const existing = Object.values(data.refundRequests).find(
        (r) =>
          r.guildId === request.guildId &&
          r.userId === request.userId &&
          r.subscriptionId === request.subscriptionId &&
          r.status !== 'completed',
      );
      if (existing) return existing;
      if (data.refundRequests[request.requestId])
        throw new Error('Refund request reference already used');
      if (record.pendingRefundId) {
        const receipt = data.refunds[record.pendingRefundId];
        if (
          !receipt ||
          receipt.subscriptionId !== record.subscriptionId ||
          receipt.roleId !== record.roleId ||
          receipt.guildId !== request.guildId ||
          receipt.userId !== request.userId ||
          receipt.status !== 'pending'
        )
          throw new Error('Pending refund metadata repair required');
        request.refundId = receipt.refundId;
      }
      data.refundRequests[request.requestId] = request;
      await writeStorage(data);
      return request;
    });
  },
  async bindRefundLog(
    requestId: string,
    channelId: string,
    messageId: string,
  ): Promise<RefundRequest> {
    return enqueue(async () => {
      const data = await readStorage();
      const request = data.refundRequests[requestId];
      if (
        !request ||
        request.status !== 'logging' ||
        request.logChannelId !== channelId ||
        !messageId
      )
        throw new Error('Invalid refund log binding');
      if (request.logMessageId && request.logMessageId !== messageId)
        throw new Error('Refund log already bound');
      request.logMessageId = messageId;
      request.status = 'logged';
      await writeStorage(data);
      return request;
    });
  },
  async verifyRefundRequest(
    requestId: string,
    receipt: RefundReceipt,
    verifiedAt: number,
  ): Promise<RefundReceipt> {
    return enqueue(async () => {
      const data = await readStorage();
      const request = data.refundRequests[requestId];
      if (
        !request ||
        !request.logMessageId ||
        !['logged', 'verified'].includes(request.status)
      )
        throw new Error('Refund request is not logged');
      if (request.status === 'verified') {
        const saved = data.refunds[request.refundId!];
        if (!saved) throw new Error('Refund receipt missing');
        return saved;
      }
      const record = data.subscriptions[request.guildId]?.[request.userId];
      if (
        !record ||
        record.subscriptionId !== request.subscriptionId ||
        record.roleId !== request.roleId
      )
        throw new Error('Subscription changed');
      if (
        receipt.subscriptionId !== request.subscriptionId ||
        receipt.guildId !== request.guildId ||
        receipt.userId !== request.userId ||
        receipt.roleId !== request.roleId
      )
        throw new Error('Receipt identity mismatch');
      if (record.pendingRefundId && record.pendingRefundId !== request.refundId)
        throw new Error('Another cancellation is pending');
      const saved = request.refundId
        ? data.refunds[request.refundId]
        : undefined;
      if (request.refundId && !saved) throw new Error('Refund receipt missing');
      const frozen = saved ?? receipt;
      if (data.refunds[frozen.refundId] && !saved)
        throw new Error('Refund reference already used');
      request.refundId = frozen.refundId;
      request.status = 'verified';
      request.verifiedBy = receipt.staffId;
      request.verifiedAt = verifiedAt;
      record.pendingRefundId = frozen.refundId;
      data.refunds[frozen.refundId] = frozen;
      await writeStorage(data);
      return frozen;
    });
  },
  async getRefund(refundId: string): Promise<RefundReceipt | undefined> {
    return enqueue(async () => (await readStorage()).refunds[refundId]);
  },
  async findRefund(
    guildId: string,
    userId: string,
  ): Promise<RefundReceipt | undefined> {
    return enqueue(async () =>
      Object.values((await readStorage()).refunds)
        .filter((r) => r.guildId === guildId && r.userId === userId)
        .at(-1),
    );
  },
  async beginRefund(receipt: RefundReceipt): Promise<RefundReceipt> {
    return enqueue(async () => {
      const data = await readStorage();
      const prior = data.refunds[receipt.refundId];
      if (prior) return prior;
      const record = data.subscriptions[receipt.guildId]?.[receipt.userId];
      if (!record || record.subscriptionId !== receipt.subscriptionId)
        throw new Error('Subscription changed; no cancellation performed');
      assertNotCancelling(record);
      record.pendingRefundId = receipt.refundId;
      data.refunds[receipt.refundId] = receipt;
      await writeStorage(data);
      return receipt;
    });
  },
  async completeRefund(refundId: string): Promise<RefundReceipt> {
    return enqueue(async () => {
      const data = await readStorage();
      const receipt = data.refunds[refundId];
      if (!receipt) throw new Error('Refund receipt missing');
      if (receipt.status === 'completed') return receipt;
      const record = data.subscriptions[receipt.guildId]?.[receipt.userId];
      if (
        !record ||
        record.subscriptionId !== receipt.subscriptionId ||
        record.pendingRefundId !== refundId
      )
        throw new Error(
          'Subscription changed; recovery requires metadata repair',
        );
      receipt.status = 'completed';
      for (const request of Object.values(data.refundRequests)) {
        if (request.refundId === refundId) request.status = 'completed';
      }
      delete data.subscriptions[receipt.guildId][receipt.userId];
      if (!Object.keys(data.subscriptions[receipt.guildId]).length)
        delete data.subscriptions[receipt.guildId];
      await writeStorage(data);
      return receipt;
    });
  },
  async getRenewalApproval(
    requestId: string,
  ): Promise<RenewalApproval | undefined> {
    return enqueue(
      async () => (await readStorage()).renewalApprovals[requestId],
    );
  },

  async saveRenewalApproval(
    record: SubscriptionRecord,
    approval: RenewalApproval,
  ): Promise<void> {
    return enqueue(async () => {
      const data = await readStorage();
      if (data.renewalApprovals[approval.requestId])
        throw new Error('Renewal already approved');
      assertNotCancelling(data.subscriptions[record.guildId]?.[record.userId]);
      data.subscriptions[record.guildId] ??= {};
      data.subscriptions[record.guildId][record.userId] = record;
      data.renewalApprovals[approval.requestId] = approval;
      await writeStorage(data);
    });
  },

  async get(
    guildId: string,
    userId: string,
  ): Promise<SubscriptionRecord | undefined> {
    return enqueue(async () => {
      const data = await readStorage();
      const storage = data.subscriptions;
      return storage[guildId]?.[userId];
    });
  },

  async set(record: SubscriptionRecord): Promise<void> {
    return enqueue(async () => {
      const data = await readStorage();
      const storage = data.subscriptions;
      assertNotCancelling(storage[record.guildId]?.[record.userId]);
      if (!storage[record.guildId]) {
        storage[record.guildId] = {};
      }
      storage[record.guildId][record.userId] = record;
      await writeStorage(data);
    });
  },

  async delete(guildId: string, userId: string): Promise<void> {
    return enqueue(async () => {
      const data = await readStorage();
      const storage = data.subscriptions;
      assertNotCancelling(storage[guildId]?.[userId]);
      if (storage[guildId]?.[userId]) {
        delete storage[guildId][userId];
        if (Object.keys(storage[guildId]).length === 0) {
          delete storage[guildId];
        }
        await writeStorage(data);
      }
    });
  },

  async getAll(): Promise<SubscriptionRecord[]> {
    return enqueue(async () => {
      const data = await readStorage();
      const storage = data.subscriptions;
      const allRecords: SubscriptionRecord[] = [];
      for (const guildId of Object.keys(storage)) {
        for (const userId of Object.keys(storage[guildId])) {
          allRecords.push(storage[guildId][userId]);
        }
      }
      return allRecords;
    });
  },
};
