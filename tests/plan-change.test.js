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
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ButtonStyle, ChannelType, MessageFlags } from 'discord.js';
import { Roles } from '../dist/config.js';
import { calculatePlanChange } from '../dist/lib/proratedPlanChange.js';
import { calculateUnusedValue, calculateProportionalRefund } from '../dist/lib/proportionalRefund.js';
import { subscriptionStore } from '../dist/lib/subscriptionStore.js';
import { SubscriptionCommand } from '../dist/commands/SubscriptionCommand.js';
import { PlanChangeVerifyHandler } from '../dist/interaction-handlers/PlanChangeVerifyHandler.js';
import { setupSubscriptionExpiryChecker } from '../dist/lib/subscriptionExpiryChecker.js';
import { logRoleChange } from '../dist/lib/roleChangeLog.js';
import { EMBED_COLORS, EMBED_FOOTER } from '../dist/engine/SEmbed.js';
import { notifyBuyerOfPlanChange } from '../dist/lib/planChangeNotification.js';
import { planChangeRequestEmbed } from '../dist/lib/planChangePresentation.js';
const id = '11111111-1111-4111-8111-111111111111';
const currency = { code: 'IDR', minorUnitDigits: 0 };
const period = (startAt = 0, endAt = 100, price = 10000) => ({ startAt, endAt, price, currency: { ...currency }, source: 'testing' });
const record = () => ({ subscriptionId: 'subscription', guildId: 'guild', userId: 'buyer', roleId: Roles.DONATUR.id, durationMonths: 1, expiresAt: 100, paymentHistoryComplete: true, paidPeriods: [period()] });
function tiers(t) {
  for (const [key, value] of [['DONATUR', 'donatur'], ['BILLION', 'billion'], ['RICHMAN', 'richman']]) {
    const old = Roles[key].id; Roles[key].id = value; t.after(() => { Roles[key].id = old; });
  }
}
test('mid-period upgrade uses gross credit with no deduction', t => {
  tiers(t); const r = record(); const q = calculatePlanChange(r, 'billion', 1, 'upgrade', 50);
  assert.equal(q.credit, 5000); assert.equal(q.newPrice, 25000); assert.equal(q.amountToPay, 20000);
  assert.equal(q.newExpiresAt, 50 + 30 * 86400000);
  assert.equal(calculateProportionalRefund(r, 50).net, 4750);
});
test('downgrade yields manually settled credit balance', t => {
  tiers(t); const q = calculatePlanChange({ ...record(), roleId: 'richman', paidPeriods: [period(0, 100, 50000)] }, 'donatur', 1, 'downgrade', 50);
  assert.equal(q.credit, 25000); assert.equal(q.amountToPay, 0); assert.equal(q.creditBalance, 15000);
});
test('multiple periods round half-up once, including future periods', t => {
  tiers(t); const r = { ...record(), expiresAt: 6, paidPeriods: [period(0, 3, 1), period(3, 6, 1)] };
  assert.equal(calculateUnusedValue(r, 2).gross, 1);
  assert.equal(calculatePlanChange(r, 'billion', 1, 'upgrade', 2).credit, 1);
  assert.equal(calculateUnusedValue({ ...record(), expiresAt: 2, paidPeriods: [period(0, 2, 1)] }, 1).gross, 1);
});
for (const [name, change, target, direction, at, pattern] of [
  ['same tier', {}, 'donatur', 'upgrade', 50, /Same tier/],
  ['wrong direction', {}, 'billion', 'downgrade', 50, /direction/],
  ['incomplete history', { paymentHistoryComplete: false }, 'billion', 'upgrade', 50, /repair/],
  ['expired', {}, 'billion', 'upgrade', 100, /No refundable time/],
  ['unsupported role', {}, 'missing', 'upgrade', 50, /unsupported/],
  ['invalid duration', {}, 'billion', 'upgrade', 50, /duration/],
]) test('calculation rejects ' + name, t => { tiers(t); assert.throws(() => calculatePlanChange({ ...record(), ...change }, target, name === 'invalid duration' ? 2 : 1, direction, at), pattern); });

function fixture(t, scenario = '') {
  tiers(t); let r = record(), request, receipt, failing = true;
  const oldChannel = process.env.BUY_LOG_CHANNEL; process.env.BUY_LOG_CHANNEL = 'log';
  t.after(() => { if (oldChannel === undefined) delete process.env.BUY_LOG_CHANNEL; else process.env.BUY_LOG_CHANNEL = oldChannel; });
  t.mock.method(Date, 'now', () => 50); t.mock.method(console, 'error', () => {});
  const events = [], replies = [], sent = [], edits = [], announcements = [];
  const fault = stage => { if (scenario === stage && failing) throw new Error(stage); };
  t.mock.method(subscriptionStore, 'get', async () => { fault('read'); return r; });
  t.mock.method(subscriptionStore, 'getPlanChangeRequest', async () => request);
  t.mock.method(subscriptionStore, 'getPlanChangeReceipt', async () => receipt);
  t.mock.method(subscriptionStore, 'findActivePlanChange', async () => request && !['failed', 'completed'].includes(request.status) ? request : undefined);
  t.mock.method(subscriptionStore, 'createPlanChangeRequest', async value => { request = { ...value, id }; return request; });
  t.mock.method(subscriptionStore, 'bindPlanChangeLog', async () => { fault('binding'); Object.assign(request, { status: 'logged', logMessageId: 'message' }); return request; });
  t.mock.method(subscriptionStore, 'saveApprovalOrigin', async () => {});
  t.mock.method(subscriptionStore, 'beginPlanChange', async (_, value) => { events.push('begin'); receipt = value; r.pendingPlanChangeId = id; request.status = 'verified'; return receipt; });
  t.mock.method(subscriptionStore, 'abortPlanChange', async () => { events.push('abort'); delete r.pendingPlanChangeId; request.status = 'failed'; });
  t.mock.method(subscriptionStore, 'completePlanChange', async () => { fault('complete'); events.push('complete'); Object.assign(r, { roleId: request.toRoleId, paidPeriods: [receipt.newPaidPeriod], expiresAt: receipt.newExpiresAt }); delete r.pendingPlanChangeId; request.status = 'completed'; return receipt; });
  t.mock.method(subscriptionStore, 'markAnnounced', async () => { if (request.announced) return false; request.announced = true; return true; });
  const cache = new Map([['donatur', {}]]);
  const channel = { id: 'log', type: ChannelType.GuildText, send: async payload => { fault('send'); sent.push(payload); return { id: 'message', edit: async payload => { fault('enable'); edits.push(payload); } }; } };
  const guild = { id: 'guild', name: 'Server', roles: { cache: new Map() }, channels: { cache: new Map([['log', channel]]), fetch: async channelId => {
    if (channelId === 'log') { fault('role log'); return { ...channel, guild }; }
    return { guild, isTextBased: () => true, send: async payload => announcements.push(payload) };
  } }, members: { fetch: async () => { fault('fetch'); return member; } } };
  const member = { id: 'buyer', guild, send: async () => { events.push('dm'); fault('dm'); }, roles: { cache,
    add: async roleId => { fault('add'); events.push('add'); cache.set(roleId, {}); },
    remove: async roleId => { fault('remove'); events.push('remove'); cache.delete(roleId); },
  } };
  const base = { guild, inCachedGuild: () => true, member: { permissions: { has: () => true }, roles: { cache: new Map() } }, user: { id: 'staff', tag: 'Staff' },
    channelId: 'command', reply: async p => replies.push(p), editReply: async p => { fault('update'); replies.push(p); }, followUp: async p => replies.push(p) };
  const submit = { ...base, editReply: async p => replies.push(p), options: { getUser: () => ({ id: 'buyer', tag: 'Buyer' }), getString: name => name === 'role' ? 'BILLION' : '1' }, deferReply: async p => assert.equal(p.flags, MessageFlags.Ephemeral) };
  const button = { ...base, channelId: 'log', customId: `plan_change_verify_${id}`, message: { id: 'message' }, deferUpdate: async () => events.push('defer') };
  return { submit, button, events, replies, sent, edits, announcements, channel, guild, member,
    get record() { return r; }, get request() { return request; }, get receipt() { return receipt; },
    missing: () => { r = undefined; }, recover: () => { failing = false; },
  };
}
const submit = f => SubscriptionCommand.prototype.chatInputUpgrade.call(SubscriptionCommand.prototype, f.submit);
const verify = f => PlanChangeVerifyHandler.prototype.run(f.button);
test('command logs estimates, UUID-only bound button and ephemeral confirmation', async t => {
  const f = fixture(t); await submit(f);
  assert.equal(f.request.status, 'logged'); assert.equal(f.record.pendingPlanChangeId, undefined);
  const embed = f.sent[0].embeds[0].data;
  assert.equal(f.request.buyerTag, 'Buyer'); assert.equal(f.request.requesterTag, 'Staff');
  assert.deepEqual(embed.fields.map(x => x.name), ['Buyer', 'Old Tier', 'New Tier', 'Duration', 'Prorated Credit', 'New Price', 'Amount to Pay (estimate)', 'Requested By', 'Status']);
  assert.equal(embed.fields[0].value, 'Buyer (buyer)');
  assert.equal(embed.fields[3].value, '1 Month');
  assert.equal(embed.fields[7].value, 'Staff');
  assert.equal(embed.fields.at(-1).value, '⏳ Pending verification'); assert.equal(embed.fields.at(-1).inline, false);
  assert.equal(embed.footer.text, `${EMBED_FOOTER} • Purchases`); assert.equal(embed.color, EMBED_COLORS.WARNING);
  assert.equal(embed.fields.find(x => x.name === 'Amount to Pay (estimate)').value, 'IDR 20.000');
  const button = f.sent[0].components[0].toJSON().components[0];
  assert.equal(button.label, 'Verify & Change Plan'); assert.equal(button.emoji.name, '✅'); assert.equal(button.style, ButtonStyle.Success);
  assert.equal(f.sent[0].components[0].toJSON().components[0].custom_id, `plan_change_verify_${id}`);
  assert.equal(f.sent[0].components[0].toJSON().components[0].disabled, true);
  assert.equal(f.edits[0].components[0].toJSON().components[0].disabled, false);
  assert.equal(f.replies[0].embeds[0].data.title, '✅ Plan Change Logged');
  assert.match(f.replies[0].embeds[0].data.description, /Successfully logged plan change for \*\*Buyer\*\*/);
  await submit(f); assert.equal(f.sent.length, 1); assert.match(f.replies.at(-1).content, /already pending/);
});
for (const scenario of ['guild', 'admin', 'channel', 'missing', 'history', 'refund', 'pending', 'same', 'direction', 'duration', 'role', 'expired', 'read']) test('command rejects ' + scenario, async t => {
  const f = fixture(t, scenario);
  if (scenario === 'guild') f.submit.inCachedGuild = () => false;
  if (scenario === 'admin') f.submit.member.permissions.has = () => false;
  if (scenario === 'channel') f.guild.channels.cache.clear();
  if (scenario === 'missing') f.missing();
  if (scenario === 'history') f.record.paymentHistoryComplete = false;
  if (scenario === 'refund') f.record.pendingRefundId = 'refund';
  if (scenario === 'pending') f.record.pendingPlanChangeId = 'pending';
  if (scenario === 'same') f.submit.options.getString = n => n === 'role' ? 'DONATUR' : '1';
  if (scenario === 'direction') f.record.roleId = 'richman';
  if (scenario === 'duration') f.submit.options.getString = n => n === 'role' ? 'BILLION' : '2';
  if (scenario === 'role') f.submit.options.getString = n => n === 'role' ? 'UNKNOWN' : '1';
  if (scenario === 'expired') f.record.expiresAt = 50;
  await submit(f); assert.equal(f.sent.length, 0); assert.match(f.replies.at(-1).content, /❌/);
});
for (const scenario of ['send', 'binding', 'enable']) test('logging failure marks request failed: ' + scenario, async t => {
  const f = fixture(t, scenario); await submit(f); assert.equal(f.request.status, 'failed'); assert.equal(f.record.pendingPlanChangeId, undefined);
  f.recover(); await submit(f); assert.equal(f.request.status, 'logged');
});
test('handler authorizes staff and rejects malformed IDs and wrong bindings', async t => {
  const f = fixture(t); await submit(f); f.button.member.permissions.has = () => false;
  await verify(f); assert.match(f.replies.at(-1).content, /permission/); assert.equal(f.events.length, 0);
  f.button.member.permissions.has = () => true; f.button.message.id = 'other'; await verify(f); assert.match(f.replies.at(-1).content, /bound/);
  const context = { some: () => true, none: () => false };
  assert.equal(PlanChangeVerifyHandler.prototype.parse.call(context, { customId: `plan_change_verify_${id}` }), true);
  for (const value of ['buy_verify_' + id, 'plan_change_verify_short', 'plan_change_verify_' + id + '_amount']) assert.equal(PlanChangeVerifyHandler.prototype.parse.call(context, { customId: value }), false);
});
test('success adds before removal, saves before DM, announces once and ignores double click', async t => {
  const f = fixture(t); await submit(f); await Promise.all([verify(f), verify(f)]);
  assert.equal(f.request.status, 'completed'); assert.equal(f.record.roleId, 'billion');
  assert.ok(f.events.indexOf('add') < f.events.indexOf('remove')); assert.ok(f.events.indexOf('complete') < f.events.indexOf('dm'));
  assert.equal(f.events.filter(x => x === 'add').length, 1); assert.equal(f.events.filter(x => x === 'dm').length, 1); assert.equal(f.announcements.length, 1);
  assert.equal(f.replies.at(-1).components[0].toJSON().components[0].disabled, true);
  const final = f.replies.at(-1).embeds[0].data;
  assert.equal(final.color, EMBED_COLORS.CONFIRMED);
  assert.equal(final.fields.find(x => x.name === 'Status').value, '✅ Verified by <@staff>');
  assert.equal(final.fields.find(x => x.name === 'Verified By').value, '<@staff> (<t:0:F>)');
  assert.equal(final.fields.find(x => x.name === 'Final Calculation').value, '<t:0:F>');
  assert.equal(final.fields.find(x => x.name === 'Amount to Pay').value, 'IDR 20.000');
  assert.equal(f.announcements[0].embeds[0].data.title, '📣 Upgrade Info');
  assert.equal(f.announcements[0].embeds[0].data.color, EMBED_COLORS.INFO);
  assert.deepEqual(f.announcements[0].allowedMentions, { parse: [] });
});
test('add failure aborts and clears pending flag', async t => {
  const f = fixture(t, 'add'); await submit(f); await verify(f);
  assert.equal(f.request.status, 'failed'); assert.equal(f.record.pendingPlanChangeId, undefined); assert.equal(f.member.roles.cache.has('donatur'), true);
});
for (const scenario of ['remove', 'complete']) test(scenario + ' failure freezes receipt and resumes on second click', async t => {
  const f = fixture(t, scenario); await submit(f); await verify(f);
  assert.equal(f.record.pendingPlanChangeId, id); assert.equal(f.request.status, 'verified'); const saved = f.receipt;
  f.recover(); await verify(f); assert.equal(f.record.pendingPlanChangeId, undefined); assert.equal(f.receipt, saved);
  assert.equal(f.events.filter(x => x === 'begin').length, 1); assert.equal(f.request.status, 'completed');
});
test('stale request fails without changing roles', async t => {
  const f = fixture(t); await submit(f); f.record.subscriptionId = 'replacement'; await verify(f);
  assert.equal(f.request.status, 'failed'); assert.equal(f.events.includes('add'), false);
});
for (const scenario of ['dm', 'role log', 'update']) test(scenario + ' failure preserves completion and replay does not repeat side effects', async t => {
  const f = fixture(t, scenario); await submit(f); await verify(f); assert.equal(f.request.status, 'completed');
  f.recover(); await verify(f); assert.equal(f.events.filter(x => x === 'add').length, 1); assert.equal(f.events.filter(x => x === 'dm').length, 1); assert.equal(f.announcements.length, 1);
});

for (const version of [1, 2]) test('storage migrates version ' + version + ', guards both ways and completes atomically across reload', async t => {
  tiers(t); const directory = await mkdtemp(join(tmpdir(), 'plan-change-')); const original = process.cwd();
  t.after(async () => { process.chdir(original); await rm(directory, { recursive: true, force: true }); }); process.chdir(directory); await mkdir('data');
  const prior = { version, subscriptions: { guild: { buyer: record() } }, renewalApprovals: { renewal: { requestId: 'renewal' } }, refunds: {}, refundRequests: {}, approvalOrigins: { origin: { commandChannelId: 'origin', announced: true } } };
  await writeFile('data/subscriptions.json', JSON.stringify(prior));
  const { subscriptionStore: store } = await import(`../dist/lib/subscriptionStore.js?plan-${version}`);
  const request = { id, buyerTag: 'Buyer', requesterTag: 'Staff', subscriptionId: 'subscription', guildId: 'guild', userId: 'buyer', fromRoleId: 'donatur', toRoleId: 'billion', durationMonths: 1, direction: 'upgrade', requestedBy: 'staff', requestedAt: 50, commandChannelId: 'command', announced: false, logChannelId: 'log', status: 'logging' };
  await store.createPlanChangeRequest(request);
  await assert.rejects(store.createPlanChangeRequest({ ...request, id: 'other' }), /plan change is pending/);
  const refund = { refundId: 'refund', subscriptionId: 'subscription', guildId: 'guild', userId: 'buyer', roleId: 'donatur', status: 'pending' };
  await assert.rejects(store.beginRefund(refund), /plan change is pending/);
  await assert.rejects(store.set(record()), /plan change is pending/); await assert.rejects(store.delete('guild', 'buyer'), /plan change is pending/);
  await assert.rejects(store.saveRenewalApproval(record(), { requestId: 'new' }), /plan change is pending/);
  await store.bindPlanChangeLog(id, 'log', 'message');
  const q = calculatePlanChange(record(), 'billion', 1, 'upgrade', 50);
  const receipt = { ...q, id, subscriptionId: 'subscription', guildId: 'guild', userId: 'buyer', oldRoleId: 'donatur', oldPaidPeriods: record().paidPeriods, newPaidPeriod: period(q.at, q.newExpiresAt, q.newPrice), verifiedAt: 50, verifiedBy: 'staff' };
  await store.beginPlanChange(id, receipt);
  const { subscriptionStore: reload } = await import(`../dist/lib/subscriptionStore.js?plan-reload-${version}`);
  assert.deepEqual(await reload.getPlanChangeReceipt(id), receipt); assert.equal((await reload.get('guild', 'buyer')).pendingPlanChangeId, id);
  assert.deepEqual(await reload.completePlanChange(id), receipt); await reload.completePlanChange(id);
  const changed = await reload.get('guild', 'buyer'); assert.equal(changed.roleId, 'billion'); assert.equal(changed.subscriptionId, 'subscription'); assert.equal(changed.pendingPlanChangeId, undefined);
  assert.equal((await reload.getPlanChangeRequest(id)).status, 'completed'); assert.deepEqual(await reload.getRenewalApproval('renewal'), prior.renewalApprovals.renewal);
  const bytes = JSON.parse(await readFile('data/subscriptions.json', 'utf8')); assert.equal(bytes.version, 3); assert.deepEqual(bytes.approvalOrigins, prior.approvalOrigins);
  await reload.beginRefund({ ...refund, roleId: 'billion' });
  await assert.rejects(reload.createPlanChangeRequest({ ...request, id: 'another', fromRoleId: 'billion' }), /cancellation is pending/);
});
test('expiry skips pending flag and awaiting request and logs automatic removal', async t => {
  let callback, current = { ...record(), pendingPlanChangeId: id }, active;
  const events = []; const old = process.env.BUY_LOG_CHANNEL; process.env.BUY_LOG_CHANNEL = 'log'; t.after(() => { if (old === undefined) delete process.env.BUY_LOG_CHANNEL; else process.env.BUY_LOG_CHANNEL = old; });
  t.mock.method(globalThis, 'setInterval', fn => { callback = fn; return 0; }); t.mock.method(console, 'log', () => {});
  t.mock.method(subscriptionStore, 'getAll', async () => [current]); t.mock.method(subscriptionStore, 'get', async () => current);
  t.mock.method(subscriptionStore, 'findActivePlanChange', async () => active); t.mock.method(subscriptionStore, 'delete', async () => events.push('delete'));
  const guild = { id: 'guild', available: true, members: { fetch: async () => ({ roles: { remove: async () => events.push('remove') } }) }, channels: { fetch: async () => ({ type: ChannelType.GuildText, guild, send: async p => { events.push('log'); assert.deepEqual(p.allowedMentions, { parse: [] }); assert.equal(p.embeds[0].data.fields.find(f => f.name === 'Reason').value, 'Expired'); } }) } };
  setupSubscriptionExpiryChecker({ guilds: { cache: new Map([['guild', guild]]) } });
  await callback(); assert.deepEqual(events, []); delete current.pendingPlanChangeId; active = { status: 'logged' }; await callback(); assert.deepEqual(events, []);
  active = undefined; await callback(); assert.deepEqual(events, ['remove', 'log', 'delete']);
});
test('role log catches unavailable channels without propagating', async t => {
  const error = t.mock.method(console, 'error', () => {});
  await logRoleChange({ channels: { fetch: async () => { throw new Error('offline'); } } }, { buyerId: 'buyer', fromRoleId: 'old', reason: 'Expired' });
  assert.equal(error.mock.callCount(), 1);
});

test('downgrade command displays a Credit Balance estimate', async t => {
  const f = fixture(t); f.record.roleId = 'richman'; f.record.paidPeriods = [period(0, 100, 50000)];
  f.submit.options.getString = name => name === 'role' ? 'DONATUR' : '1';
  await SubscriptionCommand.prototype.chatInputDowngrade.call(SubscriptionCommand.prototype, f.submit);
  assert.equal(f.request.direction, 'downgrade');
  assert.equal(f.sent[0].embeds[0].data.fields.find(x => x.name === 'Credit Balance (estimate)').value, 'IDR 15.000');
});
test('expired awaiting request fails and releases the active request guard', async t => {
  const f = fixture(t); await submit(f); t.mock.method(Date, 'now', () => 100); await verify(f);
  assert.equal(f.request.status, 'failed'); assert.equal(f.events.includes('add'), false);
});
test('saved receipt identity mismatch prevents role operations', async t => {
  const f = fixture(t, 'remove'); await submit(f); await verify(f);
  f.receipt.toRoleId = 'richman'; f.events.length = 0; f.recover(); await verify(f);
  assert.equal(f.events.includes('add'), false); assert.equal(f.record.pendingPlanChangeId, id);
});
test('announcement failure preserves completed plan and claims once', async t => {
  const f = fixture(t); await submit(f);
  const fetch = f.guild.channels.fetch;
  f.guild.channels.fetch = async channelId => {
    if (channelId === 'log') return fetch(channelId);
    throw new Error('offline announcement');
  };
  await verify(f); assert.equal(f.request.status, 'completed'); assert.equal(f.request.announced, true);
  await verify(f); assert.equal(f.events.filter(e => e === 'add').length, 1);
});
test('founder can verify without Administrator', async t => {
  const f = fixture(t); await submit(f); f.button.member.permissions.has = () => false;
  const old = Roles.FOUNDER.id; Roles.FOUNDER.id = 'founder'; t.after(() => { Roles.FOUNDER.id = old; });
  f.button.member.roles.cache.set('founder', {});
  await verify(f); assert.equal(f.request.status, 'completed');
});
test('stale renewal after tier change cannot restore the old role', async t => {
  const { RenewApproveHandler } = await import('../dist/interaction-handlers/RenewApproveHandler.js');
  const f = fixture(t); await submit(f); await verify(f); f.events.length = 0;
  const subscriptionId = '22222222-2222-4222-8222-222222222222'; f.record.subscriptionId = subscriptionId;
  t.mock.method(subscriptionStore, 'getRenewalApproval', async () => undefined);
  const oldRole = '12345678901234567';
  const button = { ...f.button, customId: `renew_approve_12345678901234568_${oldRole}_1_${subscriptionId}` };
  await RenewApproveHandler.prototype.run(button);
  assert.match(f.replies.at(-1).content, /tier changed/); assert.equal(f.events.includes('add'), false);
});

test('staff log formats plural duration and supports older requests without tags', async t => {
  const f = fixture(t); f.submit.options.getString = name => name === 'role' ? 'BILLION' : '6';
  await submit(f); assert.equal(f.sent[0].embeds[0].data.fields.find(x => x.name === 'Duration').value, '6 Months');
  delete f.request.buyerTag; delete f.request.requesterTag;
  const embed = planChangeRequestEmbed(f.request, calculatePlanChange(f.record, 'billion', 6, 'upgrade', 50), currency).data;
  assert.equal(embed.fields[0].value, 'buyer (buyer)'); assert.equal(embed.fields.find(x => x.name === 'Requested By').value, 'staff');
});
for (const direction of ['upgrade', 'downgrade']) test(direction + ' DM uses buyer layout and final amounts', async t => {
  const f = fixture(t);
  if (direction === 'downgrade') {
    f.record.roleId = 'richman'; f.record.paidPeriods = [period(0, 100, 50000)];
    f.submit.options.getString = name => name === 'role' ? 'DONATUR' : '1';
    await SubscriptionCommand.prototype.chatInputDowngrade.call(SubscriptionCommand.prototype, f.submit);
  } else await submit(f);
  f.guild.roles = { cache: new Map([['donatur', { name: 'Donatur Tier' }], ['billion', { name: 'Billion Tier' }], ['richman', { name: 'Richman Tier' }]]) };
  const send = t.mock.method(f.member, 'send', async () => {});
  await verify(f);
  const payload = send.mock.calls[0].arguments[0], embed = payload.embeds[0].data;
  assert.equal(embed.title, direction === 'upgrade' ? '✅ Your Subscription Has Been Upgraded' : '✅ Your Subscription Has Been Downgraded');
  assert.equal(embed.color, EMBED_COLORS.CONFIRMED); assert.equal(embed.footer.text, `${EMBED_FOOTER} • Purchases`); assert.ok(embed.timestamp);
  assert.match(embed.description, /Recorded for manual payment; the bot does not take payment/);
  assert.equal(payload.components, undefined);
  assert.deepEqual(embed.fields.map(x => x.name), ['Server', 'Old Tier', 'New Tier', 'Duration', 'Prorated Credit', 'New Price', direction === 'upgrade' ? 'Amount to Pay' : 'Credit Balance', 'Expires']);
  assert.ok(embed.fields.every(x => x.inline)); assert.equal(embed.fields[0].value, 'Server');
  assert.equal(embed.fields[1].value, direction === 'upgrade' ? 'Donatur Tier' : 'Richman Tier');
  assert.equal(embed.fields[2].value, direction === 'upgrade' ? 'Billion Tier' : 'Donatur Tier');
  assert.equal(embed.fields[6].value, direction === 'upgrade' ? 'IDR 20.000' : 'IDR 15.000');
  assert.equal(embed.fields[7].value, `<t:${Math.floor(f.receipt.newExpiresAt / 1000)}:F>`);
  f.guild.roles.cache.clear(); f.request.fromRoleId = 'unknown'; f.request.durationMonths = 6;
  await notifyBuyerOfPlanChange(f.member, f.request, f.receipt);
  const fallback = send.mock.calls[1].arguments[0].embeds[0].data;
  assert.equal(fallback.fields[1].value, 'Subscription'); assert.equal(fallback.fields[2].value, direction === 'upgrade' ? 'BILLION' : 'DONATUR');
  assert.equal(fallback.fields[3].value, '6 Months');
  const error = t.mock.method(console, 'error', () => {});
  t.mock.method(f.member, 'send', async () => { throw new Error('blocked'); });
  await notifyBuyerOfPlanChange(f.member, f.request, f.receipt);
  assert.match(error.mock.calls[0].arguments[0], /plan change DM to user buyer/);
});
