/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateProportionalRefund } from '../dist/lib/proportionalRefund.js';
import { snapshotPaidPeriod, subscriptionPrices } from '../dist/lib/subscriptionPrices.js';
import { RefundCommand } from '../dist/commands/RefundCommand.js';
import { subscriptionStore } from '../dist/lib/subscriptionStore.js';
import { MessageFlags } from 'discord.js';

const currency = { code: 'IDR', minorUnitDigits: 0 };
const period = (startAt = 0, endAt = 100, price = 10000) => ({ startAt, endAt, price, currency, source: 'testing' });
const subscription = periods => ({
  guildId: 'guild', userId: 'buyer', roleId: 'tier', subscriptionId: 'identity',
  durationMonths: 1, expiresAt: Math.max(...periods.map(p => p.endAt)),
  paidPeriods: periods, paymentHistoryComplete: true,
});

for (const tier of ['DONATUR', 'BILLION', 'RICHMAN']) for (const duration of [1, 6, 12]) {
  test(`snapshot refund ${tier} ${duration}`, () => {
    const p = snapshotPaidPeriod(tier, duration, 0, 100);
    assert.equal(p.source, 'testing');
    assert.equal(calculateProportionalRefund(subscription([p]), 0).gross, p.price);
    assert.equal(calculateProportionalRefund(subscription([p]), 50).gross, p.price / 2);
  });
}
test('exact rational sum rounds only once and includes future periods', () => {
  assert.equal(calculateProportionalRefund(subscription([period(0, 3, 1), period(3, 6, 1)]), 2).gross, 1);
  assert.equal(calculateProportionalRefund(subscription([period(0, 2, 1)]), 1).gross, 1);
  assert.equal(calculateProportionalRefund(subscription([period(0, 100), period(100, 200), period(200, 300)]), 50).gross, 25000);
  assert.equal(calculateProportionalRefund(subscription([period()]), 99).gross, 100);
  assert.throws(() => calculateProportionalRefund(subscription([period(0, 100, 1)]), 99), /No refundable time/);
  assert.throws(() => calculateProportionalRefund(subscription([period()]), 100), /No refundable time/);
});
test('invalid metadata is rejected and catalogue edits cannot alter snapshots', t => {
  for (const p of [period(0, 0), period(1.5, 100), period(0, 100, -1), { ...period(), currency: { code: 'bad', minorUnitDigits: 0 } }])
    assert.throws(() => calculateProportionalRefund(subscription([p]), 0));
  assert.throws(() => calculateProportionalRefund({ ...subscription([period()]), paymentHistoryComplete: false }, 0), /metadata repair/);
  assert.throws(() => calculateProportionalRefund(subscription([period(), { ...period(100, 200), currency: { code: 'USD', minorUnitDigits: 2 } }]), 0), /currency mismatch/);
  const p = snapshotPaidPeriod('DONATUR', 1, 0, 100);
  const old = subscriptionPrices.prices.DONATUR[1];
  t.after(() => { subscriptionPrices.prices.DONATUR[1] = old; });
  subscriptionPrices.prices.DONATUR[1] = 999999;
  assert.equal(calculateProportionalRefund(subscription([p]), 50).gross, 5000);
});

for (const scenario of ['success', 'absent role', 'blocked DM', 'fetch failure', 'prepare failure', 'remove failure', 'complete failure', 'legacy', 'expired']) {
  test(`refund lifecycle ${scenario}`, async t => {
    let record = subscription([period()]);
    if (scenario === 'legacy') record.paymentHistoryComplete = false;
    const events = [], receipts = new Map(), replies = [];
    let fail = true;
    t.mock.method(Date, 'now', () => scenario === 'expired' ? 100 : 50);
    t.mock.method(console, 'error', () => {});
    t.mock.method(subscriptionStore, 'get', async () => record);
    t.mock.method(subscriptionStore, 'getRefund', async id => receipts.get(id));
    t.mock.method(subscriptionStore, 'findRefund', async () => [...receipts.values()].at(-1));
    t.mock.method(subscriptionStore, 'beginRefund', async receipt => {
      events.push('prepare');
      if (scenario === 'prepare failure' && fail) throw new Error('storage unavailable');
      receipts.set(receipt.refundId, receipt); record.pendingRefundId = receipt.refundId; return receipt;
    });
    t.mock.method(subscriptionStore, 'completeRefund', async id => {
      events.push('complete');
      if (scenario === 'complete failure' && fail) throw new Error('storage unavailable');
      const receipt = receipts.get(id); receipt.status = 'completed'; record = undefined; return receipt;
    });
    const cache = new Map(scenario === 'absent role' ? [] : [['tier', {}]]);
    const guild = { id: 'guild', name: 'Server', roles: { cache: new Map() }, members: { fetch: async () => {
      if (scenario === 'fetch failure') throw new Error('Discord unavailable'); return member;
    } } };
    const member = { id: 'buyer', guild, roles: { cache, remove: async id => {
      events.push('remove'); if (scenario === 'remove failure' && fail) throw new Error('Discord permission');
      cache.delete(id);
    } }, send: async ({ embeds }) => {
      events.push('dm'); assert.equal(record, undefined);
      const embed = embeds[0].toJSON();
      assert.match(embed.description, /cancelled/);
      assert.match(embed.description, /The 5% tax does not include inter-bank transfer fees\./);
      assert.equal(embed.fields.find(f => f.name === 'Net Refund').value, 'IDR 4750');
      if (scenario === 'blocked DM') throw new Error('blocked');
    } };
    const interaction = {
      id: 'request', guild, inCachedGuild: () => true, user: { id: 'staff', tag: 'Admin' },
      member: { permissions: { has: () => true } }, options: { getUser: () => ({ id: 'buyer' }) },
      deferReply: async r => assert.equal(r.flags, MessageFlags.Ephemeral),
      editReply: async reply => { replies.push(reply); events.push('staff'); },
    };
    await RefundCommand.prototype.chatInputRun(interaction);
    if (['success', 'absent role', 'blocked DM'].includes(scenario)) {
      assert.deepEqual(events, ['prepare', ...(scenario === 'absent role' ? [] : ['remove']), 'complete', 'dm', 'staff']);
      assert.match(replies.at(-1).embeds[0].data.description, /manual payment/);
      await Promise.all([RefundCommand.prototype.chatInputRun(interaction), RefundCommand.prototype.chatInputRun(interaction)]);
      assert.equal(events.filter(e => e === 'dm').length, 1);
      record = { ...subscription([period()]), subscriptionId: 'replacement' };
      await RefundCommand.prototype.chatInputRun(interaction);
      assert.equal(record.subscriptionId, 'replacement');
    } else if (['remove failure', 'complete failure'].includes(scenario)) {
      assert.match(replies.at(-1).content, /pending/);
      assert.equal(record.pendingRefundId, 'guild:request');
      fail = false;
      t.mock.method(Date, 'now', () => 99);
      await RefundCommand.prototype.chatInputRun(interaction);
      assert.equal(receipts.get('guild:request').gross, 5000);
      assert.equal(events.filter(e => e === 'prepare').length, 1);
      assert.equal(record, undefined);
    } else {
      assert.ok(record); assert.ok(!events.includes('remove')); assert.ok(!events.includes('dm'));
    }
  });
}

test('durable cancellation survives reload, guards writes, and preserves renewal approvals', async t => {
  const { mkdtemp, mkdir, writeFile, readFile, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const directory = await mkdtemp(join(process.cwd(), '.refund-test-'));
  const original = process.cwd();
  t.after(async () => { process.chdir(original); await rm(directory, { recursive: true, force: true }); });
  process.chdir(directory);
  await mkdir('data');
  const record = subscription([period()]);
  const approval = { requestId: 'renewal', userId: 'buyer', guildId: 'guild', roleId: 'tier', durationMonths: 1, expiresAt: 100, approvedAt: 0, approvedBy: 'Admin' };
  await writeFile('data/subscriptions.json', JSON.stringify({ version: 1, subscriptions: { guild: { buyer: record } }, renewalApprovals: { renewal: approval } }));
  const { subscriptionStore: store } = await import('../dist/lib/subscriptionStore.js?refund-persistence');
  assert.deepEqual(await store.get('guild', 'buyer'), record);
  const receipt = { ...calculateProportionalRefund(record, 50), refundId: 'refund', subscriptionId: 'identity', guildId: 'guild', userId: 'buyer', roleId: 'tier', refundAt: 50, staffId: 'staff', staffTag: 'Admin', status: 'pending' };
  await store.beginRefund(receipt);
  const { subscriptionStore: reload } = await import('../dist/lib/subscriptionStore.js?refund-reload');
  assert.deepEqual(await reload.getRefund('refund'), receipt);
  await assert.rejects(reload.set({ ...record, subscriptionId: 'replacement' }), /cancellation is pending/);
  await assert.rejects(reload.delete('guild', 'buyer'), /cancellation is pending/);
  await assert.rejects(reload.saveRenewalApproval(record, { ...approval, requestId: 'new' }), /cancellation is pending/);
  assert.equal((await reload.completeRefund('refund')).status, 'completed');
  assert.equal(await reload.get('guild', 'buyer'), undefined);
  assert.deepEqual(await reload.getRenewalApproval('renewal'), approval);
  await reload.set({ ...record, subscriptionId: 'replacement' });
  await reload.completeRefund('refund');
  assert.equal((await reload.get('guild', 'buyer')).subscriptionId, 'replacement');
  const bytes = await readFile('data/subscriptions.json', 'utf8');
  assert.equal(JSON.parse(bytes).version, 2);
  await writeFile('data/subscriptions.json', '{broken');
  await assert.rejects(reload.beginRefund({ ...receipt, refundId: 'another' }), SyntaxError);
  assert.equal(await readFile('data/subscriptions.json', 'utf8'), '{broken');
});

test('pending cancellation blocks purchase, renewal submission/approval and expiry cleanup', async t => {
  const { BuyVerifyHandler } = await import('../dist/interaction-handlers/BuyVerifyHandler.js');
  const { RenewCommand } = await import('../dist/commands/RenewCommand.js');
  const { RenewApproveHandler } = await import('../dist/interaction-handlers/RenewApproveHandler.js');
  const { setupSubscriptionExpiryChecker } = await import('../dist/lib/subscriptionExpiryChecker.js');
  const buyer = '111111111111111111', role = '222222222222222222';
  const record = { ...subscription([period()]), userId: buyer, roleId: role, pendingRefundId: 'pending' };
  t.mock.method(subscriptionStore, 'get', async () => record);
  t.mock.method(subscriptionStore, 'getAll', async () => [record]);
  t.mock.method(subscriptionStore, 'getRenewalApproval', async () => undefined);
  t.mock.method(subscriptionStore, 'delete', async () => assert.fail('must retain recovery'));
  const oldLog = process.env.BUY_LOG_CHANNEL; process.env.BUY_LOG_CHANNEL = 'log';
  t.after(() => { if (oldLog === undefined) delete process.env.BUY_LOG_CHANNEL; else process.env.BUY_LOG_CHANNEL = oldLog; });
  const replies = [];
  const interaction = {
    inCachedGuild: () => true, guild: { id: 'guild', members: { fetch: async () => assert.fail('must not fetch') } },
    member: { permissions: { has: () => true } }, user: { tag: 'Admin' },
    options: { getUser: () => ({ id: buyer }), getString: () => '1' },
    deferUpdate: async () => {}, deferReply: async () => {},
    followUp: async reply => replies.push(reply.content), editReply: async reply => replies.push(reply.content),
    customId: `buy_verify_${buyer}_${role}_1`,
  };
  await BuyVerifyHandler.prototype.run(interaction);
  await RenewCommand.prototype.chatInputRun(interaction);
  await RenewApproveHandler.prototype.run({ ...interaction, customId: `renew_approve_${buyer}_${role}_1`, channelId: 'log', message: { id: 'request' } });
  assert.equal(replies.length, 3);
  for (const reply of replies) assert.match(reply, /Cancellation is pending/);
  let tick;
  t.mock.method(globalThis, 'setInterval', callback => { tick = callback; });
  setupSubscriptionExpiryChecker({ guilds: { cache: { get: () => assert.fail('must not touch roles') } } });
  await tick();
});
