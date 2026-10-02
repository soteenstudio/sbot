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
import { ChannelType, ButtonStyle, MessageFlags, EmbedBuilder } from 'discord.js';
import { SubscriptionCommand } from '../dist/commands/SubscriptionCommand.js';
import { RefundVerifyHandler } from '../dist/interaction-handlers/RefundVerifyHandler.js';
import { subscriptionStore } from '../dist/lib/subscriptionStore.js';
import { EMBED_COLORS, EMBED_FOOTER } from '../dist/engine/SEmbed.js';
import { Roles } from '../dist/config.js';

const id = '11111111-1111-4111-8111-111111111111';
function fixture(t, scenario = '') {
  let now = 50, record = { guildId: 'guild', userId: 'buyer', roleId: 'tier', subscriptionId: 'subscription', durationMonths: 1,
    expiresAt: 100, paymentHistoryComplete: true,
    paidPeriods: [{ startAt: 0, endAt: 100, price: 10000, currency: { code: 'IDR', minorUnitDigits: 0 }, source: 'testing' }] };
  let request, receipt, failing = true;
  const announcements = [];
  t.mock.method(subscriptionStore, 'markAnnounced', async () => { if (!request?.commandChannelId || request.announced) return false; request.announced = true; return true; });
  const events = [], responses = [], edits = [], sent = [];
  const old = process.env.BUY_LOG_CHANNEL; process.env.BUY_LOG_CHANNEL = 'log';
  t.after(() => { if (old === undefined) delete process.env.BUY_LOG_CHANNEL; else process.env.BUY_LOG_CHANNEL = old; });
  t.mock.method(console, 'error', () => {});
  t.mock.method(Date, 'now', () => now);
  const fault = stage => { if (scenario === stage && failing) throw new Error(stage); };
  t.mock.method(subscriptionStore, 'get', async () => { fault('read failure'); return record; });
  t.mock.method(subscriptionStore, 'getRefundRequest', async requestId => request?.requestId === requestId ? request : undefined);
  t.mock.method(subscriptionStore, 'getRefund', async () => receipt);
  t.mock.method(subscriptionStore, 'createRefundRequest', async r => {
    fault('request failure'); if (!request) request = { ...r, requestId: id }; return request;
  });
  t.mock.method(subscriptionStore, 'bindRefundLog', async (requestId, channelId, messageId) => {
    fault('binding failure'); Object.assign(request, { logMessageId: messageId, status: 'logged' }); return request;
  });
  t.mock.method(subscriptionStore, 'verifyRefundRequest', async (requestId, r, verifiedAt) => {
    fault('prepare failure'); events.push('verify');
    receipt ??= r; record.pendingRefundId = receipt.refundId;
    Object.assign(request, { refundId: receipt.refundId, status: 'verified', verifiedBy: r.staffId, verifiedAt }); return receipt;
  });
  t.mock.method(subscriptionStore, 'beginRefund', async () => assert.fail('submission must not begin cancellation'));
  t.mock.method(subscriptionStore, 'completeRefund', async () => {
    fault('complete failure'); events.push('complete'); receipt.status = 'completed'; request.status = 'completed'; record = undefined; return receipt;
  });
  const message = { id: 'message', edit: async payload => { fault('enable failure'); edits.push(payload); } };
  const channel = { id: 'log', type: scenario === 'wrong channel' ? ChannelType.GuildVoice : ChannelType.GuildText,
    send: async payload => { fault('send failure'); sent.push(payload); return { ...message, id: sent.length === 1 ? 'message' : 'recovered' }; },
    messages: { fetch: async () => message } };
  const cache = new Map(scenario === 'absent role' ? [] : [['tier', {}]]);
  const guild = { id: 'guild', name: 'Server', channels: { cache: new Map(scenario === 'missing channel' ? [] : [['log', channel]]) },
    roles: { cache: new Map() }, members: { fetch: async () => { fault('fetch failure'); return member; } } };
  const member = { id: 'buyer', guild, roles: { cache, remove: async () => { fault('remove failure'); events.push('remove'); cache.delete('tier'); } },
    send: async payload => { events.push('dm'); assert.equal(record, undefined); assert.match(payload.embeds[0].data.description, /The 5% tax does not include inter-bank transfer fees\./); fault('blocked DM'); } };
  guild.channels.fetch = async channelId => { assert.equal(channelId, 'command-channel'); return { guild, isTextBased: () => true, send: async payload => announcements.push(payload) }; };
  const base = { channelId: 'command-channel', guild, inCachedGuild: () => true, user: { id: 'staff', tag: 'Admin' },
    member: { permissions: { has: () => true }, roles: { cache: new Map() } },
    reply: async payload => responses.push(payload), editReply: async payload => { fault('log update failure'); edits.push(payload); },
    followUp: async payload => responses.push(payload) };
  const submit = { ...base, options: { getUser: () => ({ id: 'buyer', tag: 'Buyer' }) },
    deferReply: async payload => assert.equal(payload.flags, MessageFlags.Ephemeral), editReply: async payload => responses.push(payload) };
  const button = { ...base, channelId: 'log', customId: `refund_verify_${id}`, message,
    deferUpdate: async () => events.push('defer') };
  return { announcements, submit, button, events, responses, edits, sent,
    get record() { return record; }, get request() { return request; }, get receipt() { return receipt; },
    advance: value => { now = value; }, recover: () => { failing = false; },
    replace: () => { record = { ...record, subscriptionId: 'replacement' }; },
    renew: () => { record.paidPeriods.push({ ...record.paidPeriods[0], startAt: 100, endAt: 200 }); record.expiresAt = 200; },
    legacy: () => { record.paymentHistoryComplete = false; },
  };
}

function assertButton(row, disabled) {
  const button = row.toJSON().components[0];
  assert.equal(button.style, ButtonStyle.Success); assert.equal(button.emoji.name, '✅');
  assert.equal(button.label, 'Verify & Refund'); assert.equal(button.disabled, disabled);
  assert.ok(button.custom_id.length <= 100);
}

test('refund prefix is separate from purchases and renewals', () => {
  const context = { some: () => true, none: () => false };
  for (const prefix of ['buy_verify_', 'renew_approve_', 'other']) assert.equal(RefundVerifyHandler.prototype.parse.call(context, { customId: prefix + id }), false);
  assert.equal(RefundVerifyHandler.prototype.parse.call(context, { customId: `refund_verify_${id}` }), true);
});

for (const scenario of ['', 'missing channel', 'wrong channel', 'send failure', 'request failure', 'binding failure', 'enable failure', 'read failure']) {
  test(`submission preserves access: ${scenario || 'success'}`, async t => {
    const f = fixture(t, scenario); await SubscriptionCommand.prototype.chatInputRefund(f.submit);
    assert.equal(f.record.pendingRefundId, undefined); assert.equal(f.events.length, 0); assert.equal(f.receipt, undefined);
    if (!scenario) {
      const embed = f.sent[0].embeds[0].toJSON();
      assert.equal(embed.title, '💸 Subscription Refund Request'); assert.equal(embed.color, EMBED_COLORS.WARNING);
      assert.equal(embed.footer.text, `${EMBED_FOOTER} • Purchases`); assert.ok(embed.timestamp);
      assert.equal(embed.fields.find(x => x.name === 'Status').value, '⏳ Pending verification');
      assert.equal(embed.fields.find(x => x.name === 'Estimated Net Refund').value, 'IDR 4.750');
      assert.match(embed.description, /The 5% tax does not include inter-bank transfer fees\./);
      assertButton(f.sent[0].components[0], true); assertButton(f.edits[0].components[0], false);
      const confirmation = f.responses.at(-1).embeds[0].toJSON();
      assert.equal(confirmation.title, '✅ Refund Logged');
      assert.deepEqual(confirmation.fields, embed.fields.filter(field => field.name.startsWith('Estimated ')));
      assert.equal(confirmation.color, EMBED_COLORS.CONFIRMED);
      assert.equal(confirmation.footer.text, `${EMBED_FOOTER} • Purchases`);
      assert.ok(confirmation.timestamp);
      assert.match(confirmation.description, /Amounts are estimates/);
      assert.match(confirmation.description, /recalculates.*remaining time at verification/);
      assert.match(confirmation.description, /recorded for manual payment/);
      assert.match(confirmation.description, /bot does not transfer funds/);
      assert.match(confirmation.description, /dummy test prices/);
      assert.match(confirmation.description, /The 5% tax does not include inter-bank transfer fees\./);
      assert.equal(f.sent[0].components[0].toJSON().components[0].custom_id, `refund_verify_${id}`);
      await SubscriptionCommand.prototype.chatInputRefund(f.submit); assert.equal(f.sent.length, 1);
      assert.match(f.responses.at(-1).content, /existing log message/);
      assert.equal(f.responses.at(-1).embeds, undefined);
    } else {
      assert.match(f.responses.at(-1).content, /❌/);
      assert.equal(f.responses.at(-1).embeds, undefined);
      assert.doesNotMatch(f.responses.at(-1).content, /Refund Logged|IDR|Estimated .*Refund/);
      if (['send failure', 'binding failure', 'enable failure'].includes(scenario)) {
        if (scenario === 'binding failure') {
          await RefundVerifyHandler.prototype.run(f.button); assert.equal(f.events.length, 0);
        }
        f.recover(); await SubscriptionCommand.prototype.chatInputRefund(f.submit);
        assert.equal(f.request.status, 'logged'); assert.equal(f.events.length, 0);
        if (scenario === 'enable failure') assert.equal(f.sent.length, 1);
      }
    }
  });
}

for (const scenario of ['', 'absent role', 'blocked DM', 'fetch failure', 'prepare failure', 'remove failure', 'complete failure', 'log update failure']) {
  test(`verified cancellation: ${scenario || 'success'}`, async t => {
    const f = fixture(t, scenario); await SubscriptionCommand.prototype.chatInputRefund(f.submit);
    f.advance(60); await RefundVerifyHandler.prototype.run(f.button);
    if (['', 'absent role', 'blocked DM'].includes(scenario)) {
      assert.equal(f.receipt.gross, 4000); assert.equal(f.record, undefined);
      assert.equal(f.events.filter(e => e === 'dm').length, 1);
      const final = f.edits.at(-1); assertButton(final.components[0], true);
      const embed = final.embeds[0].toJSON(); assert.equal(embed.color, EMBED_COLORS.CONFIRMED);
      assert.equal(embed.footer.text, `${EMBED_FOOTER} • Purchases`); assert.ok(embed.timestamp);
      for (const name of ['Verified By', 'Final Calculation', 'Refund Reference', 'Gross Refund', '5% Deduction', 'Net Refund']) assert.ok(embed.fields.some(x => x.name === name));
      await Promise.all([RefundVerifyHandler.prototype.run(f.button), RefundVerifyHandler.prototype.run(f.button)]);
      assert.equal(f.events.filter(e => e === 'dm').length, 1); assert.equal(f.events.filter(e => e === 'complete').length, 1);
      f.replace(); await RefundVerifyHandler.prototype.run(f.button); assert.equal(f.record.subscriptionId, 'replacement');
    } else {
      assert.equal(f.events.filter(e => e === 'dm').length, 0);
      assert.match(f.responses.at(-1).content, /❌/);
      f.recover(); f.advance(90); await RefundVerifyHandler.prototype.run(f.button);
      assert.equal(f.receipt.gross, ['fetch failure', 'prepare failure'].includes(scenario) ? 1000 : 4000);
      assert.equal(f.record, undefined); assert.equal(f.events.filter(e => e === 'dm').length, 1);
    }
  });
}

for (const scenario of ['wrong guild', 'wrong channel', 'wrong message', 'malformed', 'unauthorized', 'unlogged', 'stale', 'expired', 'legacy']) {
  test(`verification rejects ${scenario}`, async t => {
    const f = fixture(t); await SubscriptionCommand.prototype.chatInputRefund(f.submit);
    let button = { ...f.button };
    if (scenario === 'wrong guild') button.guild = { ...button.guild, id: 'other' };
    if (scenario === 'wrong channel') button.channelId = 'other';
    if (scenario === 'wrong message') button.message = { id: 'other' };
    if (scenario === 'malformed') button.customId += '_5000';
    if (scenario === 'unauthorized') button.member = { permissions: { has: () => false }, roles: { cache: new Map() } };
    if (scenario === 'unlogged') f.request.status = 'logging';
    if (scenario === 'stale') f.replace();
    if (scenario === 'expired') f.advance(100);
    if (scenario === 'legacy') f.legacy();
    await RefundVerifyHandler.prototype.run(button);
    assert.ok(f.record); assert.equal(f.receipt, undefined); assert.ok(!f.events.includes('remove')); assert.ok(!f.events.includes('dm'));
    assert.equal(f.responses.at(-1).flags, MessageFlags.Ephemeral);
  });
}

test('verification includes renewal periods and concurrent clicks cancel once', async t => {
  const f = fixture(t); await SubscriptionCommand.prototype.chatInputRefund(f.submit); f.renew(); f.advance(60);
  await Promise.all([RefundVerifyHandler.prototype.run(f.button), RefundVerifyHandler.prototype.run(f.button)]);
  assert.equal(f.receipt.gross, 14000); assert.equal(f.events.filter(e => e === 'complete').length, 1); assert.equal(f.events.filter(e => e === 'dm').length, 1);
});

for (const role of ['FOUNDER', 'DEPUTY']) test(`${role} can verify`, async t => {
  const f = fixture(t); const old = Roles[role].id; Roles[role].id = role; t.after(() => { Roles[role].id = old; });
  await SubscriptionCommand.prototype.chatInputRefund(f.submit);
  f.button.member = { permissions: { has: () => false }, roles: { cache: new Map([[role, {}]]) } };
  await RefundVerifyHandler.prototype.run(f.button); assert.equal(f.receipt.status, 'completed');
});

test('completed log failure can be repaired without another cancellation or DM', async t => {
  const f = fixture(t); await SubscriptionCommand.prototype.chatInputRefund(f.submit);
  const edit = f.button.editReply; let count = 0;
  f.button.editReply = async payload => { if (++count === 2) throw new Error('log offline'); await edit(payload); };
  await RefundVerifyHandler.prototype.run(f.button);
  assert.equal(f.receipt.status, 'completed'); assert.match(f.responses.at(-1).content, /Refund completed.*repair/);
  await RefundVerifyHandler.prototype.run(f.button);
  assert.equal(f.events.filter(e => e === 'complete').length, 1); assert.equal(f.events.filter(e => e === 'dm').length, 1);
  assertButton(f.edits.at(-1).components[0], true);
});

test('pending cancellation submission directs staff to its bound verification log', async t => {
  const f = fixture(t, 'remove failure'); await SubscriptionCommand.prototype.chatInputRefund(f.submit);
  await RefundVerifyHandler.prototype.run(f.button); const gross = f.receipt.gross;
  await SubscriptionCommand.prototype.chatInputRefund(f.submit);
  assert.match(f.responses.at(-1).content, /existing log message/);
  assert.equal(f.sent.length, 1); assert.equal(f.receipt.gross, gross); assert.ok(f.record.pendingRefundId);
});

test('a different request cannot compete with a saved pending cancellation', async t => {
  const f = fixture(t, 'remove failure'); await SubscriptionCommand.prototype.chatInputRefund(f.submit);
  await RefundVerifyHandler.prototype.run(f.button); f.recover();
  const secondId = '22222222-2222-4222-8222-222222222222';
  const second = { ...f.request, requestId: secondId, refundId: undefined, status: 'logged' };
  t.mock.method(subscriptionStore, 'getRefundRequest', async requestId => requestId === secondId ? second : f.request);
  await RefundVerifyHandler.prototype.run({ ...f.button, customId: `refund_verify_${secondId}` });
  assert.match(f.responses.at(-1).content, /Another cancellation/); assert.equal(f.events.filter(e => e === 'verify').length, 1);
  await RefundVerifyHandler.prototype.run(f.button); assert.equal(f.events.filter(e => e === 'dm').length, 1);
});

test('request storage read failure rejects verification before access changes', async t => {
  const f = fixture(t); await SubscriptionCommand.prototype.chatInputRefund(f.submit);
  t.mock.method(subscriptionStore, 'getRefundRequest', async () => { throw new Error('offline'); });
  await RefundVerifyHandler.prototype.run(f.button);
  assert.match(f.responses.at(-1).content, /Failed to load/); assert.equal(f.events.length, 0);
});

test('durable requests preserve active access, deduplicate, and atomically freeze verification across reload', async t => {
  const { mkdtemp, readFile, writeFile, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const directory = await mkdtemp(join(process.cwd(), '.refund-requests-'));
  const original = process.cwd();
  t.after(async () => { process.chdir(original); await rm(directory, { recursive: true, force: true }); });
  process.chdir(directory);
  const { subscriptionStore: store } = await import('../dist/lib/subscriptionStore.js?request-durable');
  const record = { guildId: 'guild', userId: 'buyer', roleId: 'tier', subscriptionId: 'identity', durationMonths: 1, expiresAt: 100 };
  await store.set(record);
  const request = { requestId: id, ...record, requestedBy: 'staff', requesterTag: 'Admin', requestedAt: 10, logChannelId: 'log', status: 'logging' };
  const [first, second] = await Promise.all([store.createRefundRequest(request), store.createRefundRequest({ ...request, requestId: 'other' })]);
  assert.equal(first.requestId, second.requestId); assert.deepEqual(await store.get('guild', 'buyer'), record);
  const receipt = { refundId: id, ...record, refundAt: 50, gross: 5000, tax: 250, net: 4750,
    currency: { code: 'IDR', minorUnitDigits: 0 }, staffId: 'approver', staffTag: 'Approver', status: 'pending' };
  await assert.rejects(store.verifyRefundRequest(id, receipt, 50), /not logged/);
  await assert.rejects(store.bindRefundLog(id, 'wrong', 'message'), /Invalid/);
  await store.bindRefundLog(id, 'log', 'message');
  const before = await readFile('data/subscriptions.json', 'utf8');
  await writeFile('data/subscriptions.json', '{broken');
  await assert.rejects(store.verifyRefundRequest(id, receipt, 50), SyntaxError);
  assert.equal(await readFile('data/subscriptions.json', 'utf8'), '{broken');
  await writeFile('data/subscriptions.json', before);
  await store.verifyRefundRequest(id, receipt, 50);
  const { subscriptionStore: reload } = await import('../dist/lib/subscriptionStore.js?request-durable-reload');
  assert.equal((await reload.get('guild', 'buyer')).pendingRefundId, id);
  assert.equal((await reload.getRefundRequest(id)).verifiedBy, 'approver');
  assert.equal((await reload.verifyRefundRequest(id, { ...receipt, gross: 1000 }, 90)).gross, 5000);
  await reload.completeRefund(id);
  assert.equal((await reload.getRefundRequest(id)).status, 'completed');
  assert.equal((await reload.getRefund(id)).net, 4750);
});

test('confirmation construction failure keeps the posted log bound and confirms without amounts', async t => {
  const f = fixture(t);
  const setTitle = EmbedBuilder.prototype.setTitle;
  t.mock.method(EmbedBuilder.prototype, 'setTitle', function(title) {
    if (title === '✅ Refund Logged') throw new Error('confirmation unavailable');
    return setTitle.call(this, title);
  });
  await SubscriptionCommand.prototype.chatInputRefund(f.submit);
  assert.equal(f.sent.length, 1);
  assert.equal(f.request.status, 'logged');
  assert.equal(f.request.logMessageId, 'message');
  assertButton(f.edits[0].components[0], false);
  assert.equal(f.responses.at(-1).embeds, undefined);
  assert.match(f.responses.at(-1).content, /✅ Refund Logged/);
  assert.doesNotMatch(f.responses.at(-1).content, /IDR|Estimated .*Refund|logging did not finish/);
  assert.equal(f.events.length, 0);
  assert.equal(f.receipt, undefined);
  assert.equal(console.error.mock.calls.at(-1).arguments[0], 'Failed to build refund confirmation:');
});

for (const scenario of ['', 'complete failure']) test('refund announcement: ' + (scenario || 'success'), async t => {
  const f = fixture(t, scenario);
  await SubscriptionCommand.prototype.chatInputRefund(f.submit);
  assert.equal(f.request.commandChannelId, 'command-channel');
  assert.equal(f.button.customId, `refund_verify_${id}`);
  await RefundVerifyHandler.prototype.run(f.button);
  await RefundVerifyHandler.prototype.run(f.button);
  assert.equal(f.announcements.length, scenario ? 0 : 1);
  if (!scenario) {
    assert.deepEqual(f.announcements[0].allowedMentions, { parse: [] });
    assert.equal(f.announcements[0].embeds[0].toJSON().description, '<@staff> has verified this process (Refund)');
  }
});

for (const pending of [false, true]) test(`missing buyer completes refund: pending=${pending}`, async t => {
  const f = fixture(t, pending ? 'remove failure' : '');
  await SubscriptionCommand.prototype.chatInputRefund(f.submit);
  if (pending) {
    await RefundVerifyHandler.prototype.run(f.button);
    assert.equal(f.receipt.status, 'pending');
    f.advance(90);
  }
  t.mock.method(f.button.guild.members, 'fetch', async () => {
    throw Object.assign(new Error('Unknown Member'), { code: 10007 });
  });
  await RefundVerifyHandler.prototype.run(f.button);
  assert.equal(f.record, undefined);
  assert.equal(f.receipt.status, 'completed');
  assert.equal(f.receipt.gross, 5000);
  assert.equal(f.request.status, 'completed');
  assertButton(f.edits.at(-1).components[0], true);
  await RefundVerifyHandler.prototype.run(f.button);
  assert.equal(f.events.filter(e => e === 'verify').length, 1);
  assert.equal(f.events.filter(e => e === 'complete').length, 1);
  assert.equal(f.events.filter(e => e === 'remove').length, 0);
  assert.equal(f.events.filter(e => e === 'dm').length, 0);
  assert.equal(f.announcements.length, 1);
});

test('other Discord fetch errors preserve the subscription and report the original error', async t => {
  const f = fixture(t);
  await SubscriptionCommand.prototype.chatInputRefund(f.submit);
  const error = Object.assign(new Error('Missing Permissions'), { code: 50013 });
  t.mock.method(f.button.guild.members, 'fetch', async () => { throw error; });
  await RefundVerifyHandler.prototype.run(f.button);
  assert.equal(f.record.pendingRefundId, undefined);
  assert.equal(f.receipt, undefined);
  assert.equal(f.request.status, 'logged');
  assert.deepEqual(f.events, ['defer']);
  assert.equal(f.announcements.length, 0);
  assert.equal(console.error.mock.calls.at(-1).arguments[1], error);
  assert.match(f.responses.at(-1).content, /Missing Permissions/);
});
