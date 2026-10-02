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
import { expectedMoney } from './helpers/money.js';
import { test } from 'node:test';
import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { BuyVerifyHandler } from '../dist/interaction-handlers/BuyVerifyHandler.js';
import { RenewApproveHandler } from '../dist/interaction-handlers/RenewApproveHandler.js';
import { Roles } from '../dist/config.js';
import { SubscriptionCommand } from '../dist/commands/SubscriptionCommand.js';
import { subscriptionStore } from '../dist/lib/subscriptionStore.js';
import { setupSubscriptionExpiryChecker } from '../dist/lib/subscriptionExpiryChecker.js';
import { EMBED_COLORS, EMBED_FOOTER } from '../dist/engine/SEmbed.js';

import { getPaymentAmount, subscriptionPrices } from '../dist/lib/subscriptionPrices.js';

const buyerId = '111111111111111111';
const tierId = '222222222222222222';
const logId = '333333333333333333';
const now = 1800000000000;
const month = 30 * 24 * 60 * 60 * 1000;

function approvalComponents(customId, emoji = true) {
  const button = new ButtonBuilder()
    .setCustomId(customId)
    .setLabel('Approve Renewal')
    .setStyle(ButtonStyle.Success)
    .setDisabled(false);
  if (emoji) button.setEmoji('✅');
  return [new ActionRowBuilder().addComponents(button).toJSON()];
}

function assertApprovalButton(components, customId, disabled) {
  assert.equal(components.length, 1);
  const row = components[0].toJSON?.() ?? components[0];
  assert.equal(row.type, 1);
  assert.equal(row.components.length, 1);
  const button = row.components[0];
  assert.equal(button.type, 2);
  assert.equal(button.custom_id, customId);
  assert.equal(button.label, 'Approve Renewal');
  assert.equal(button.emoji.name, '✅');
  assert.equal(button.style, ButtonStyle.Success);
  assert.equal(Boolean(button.disabled), disabled);
}

function fixture(t, scenario = 'success', duration = '1', expiry = now + month, tier = 'DONATUR') {
  const origins = new Map(), announcements = [];
  t.mock.method(subscriptionStore, 'saveApprovalOrigin', async (key, commandChannelId) => { origins.set(key, { commandChannelId, announced: false }); });
  t.mock.method(subscriptionStore, 'getApprovalOrigin', async key => origins.get(key));
  t.mock.method(subscriptionStore, 'markAnnounced', async key => { const origin = origins.get(key); if (!origin || origin.announced) return false; origin.announced = true; return true; });
  const originalTiers = Object.fromEntries(['DONATUR', 'BILLION', 'RICHMAN'].map(key => [key, Roles[key].id]));
  for (const key of Object.keys(originalTiers)) Roles[key].id = undefined;
  Roles[tier].id = tierId;
  t.after(() => { for (const [key, id] of Object.entries(originalTiers)) Roles[key].id = id; });
  const originalLog = process.env.BUY_LOG_CHANNEL;
  process.env.BUY_LOG_CHANNEL = logId;
  t.after(() => { if (originalLog === undefined) delete process.env.BUY_LOG_CHANNEL; else process.env.BUY_LOG_CHANNEL = originalLog; });
  const events = [];
  let record = { guildId: 'guild', userId: buyerId, roleId: tierId, durationMonths: 6, expiresAt: expiry };
  const replies = [];
  const requests = [];
  const receipts = new Map();
  t.mock.method(subscriptionStore, 'getRenewalApproval', async (id) => receipts.get(id));
  t.mock.method(subscriptionStore, 'saveRenewalApproval', async (saved, receipt) => {
    events.push('save');
    if (scenario === 'save failure') throw new Error('save');
    record = saved;
    if (scenario === 'format failure') receipt.paidPeriod.currency = { code: 'bad', minorUnitDigits: 0 };
    receipts.set(receipt.requestId, receipt);
  });
  const logged = t.mock.method(console, 'error', () => {});
  t.mock.method(Date, 'now', () => now);
  t.mock.method(subscriptionStore, 'get', async () => {
    events.push('get');
    if (scenario === 'read failure') throw new Error('read');
    return scenario === 'missing subscription' ? undefined : record;
  });
  t.mock.method(subscriptionStore, 'set', async (saved) => {
    events.push('save');
    if (scenario === 'save failure') throw new Error('save');
    record = saved;
  });
  const guild = {
    id: 'guild', name: 'Test Server', available: true,
    channels: { cache: new Map([[logId, { type: 0, send: async request => { events.push('send'); if (scenario === 'send failure') throw new Error('send'); requests.push(request); return { id: '444444444444444444' }; } }]]) },
    roles: { cache: new Map([[tierId, { name: tier }]]), fetch: async () => {
      events.push('role');
      return scenario === 'missing role' ? null : { id: tierId };
    } },
    members: { fetch: async () => {
      events.push('fetch');
      if (scenario === 'missing member') throw new Error('fetch');
      return member;
    } },
  };
  const member = {
    id: buyerId, guild,
    roles: {
      cache: new Map(scenario === 'already has role' ? [[tierId, {}]] : []),
      add: async (roleId) => {
        assert.equal(roleId, tierId); events.push('add');
        if (scenario === 'role failure') throw new Error('add');
      },
      remove: async () => { events.push('remove'); },
    },
    send: async ({ embeds }) => {
      events.push('dm');
      assert.equal(events.at(-2), 'save');
      const embed = embeds[0].toJSON();
      assert.equal(embed.title, '✅ Your Subscription Has Been Renewed');
      assert.ok(embed.description.includes('Recorded for manual payment; the bot does not take payment.'));
      if (scenario !== 'format failure') assert.equal(embed.fields[3].name, 'Amount to Pay');
      assert.equal(embed.color, EMBED_COLORS.CONFIRMED);
      assert.equal(embed.footer.text, `${EMBED_FOOTER} • Purchases`);
      assert.deepEqual(Object.fromEntries(embed.fields.map(({ name, value }) => [name, value])), {
        Server: 'Test Server', 'Subscription Tier': tier,
        'Added Duration': `${duration} Month${duration === '1' ? '' : 's'}`,
        ...(scenario === 'format failure' ? {} : { 'Amount to Pay': expectedMoney(record.paidPeriods.at(-1).price) }),
        Expires: `<t:${Math.floor(record.expiresAt / 1000)}:F>`,
      });
      if (scenario === 'blocked DM') throw new Error('dm');
    },
  };
  const interaction = {
    guild, inCachedGuild: () => scenario !== 'DM',
    member: { permissions: { has: () => scenario !== 'unauthorized' }, roles: { cache: new Map() } },
    channelId: 'command-channel', user: { id: 'staff', tag: 'Admin' },
    options: { getUser: () => ({ id: buyerId, tag: 'Buyer' }), getString: () => duration },
    reply: async (reply) => { events.push('reply'); replies.push(reply); },
    deferReply: async ({ flags }) => { assert.equal(flags, MessageFlags.Ephemeral); events.push('defer'); },
    editReply: async (reply) => { events.push('staff'); replies.push(reply); },
  };
  const approval = {
    ...interaction, channelId: logId,
    customId: `renew_approve_${buyerId}_${tierId}_${duration}`,
    message: { id: '444444444444444444', embeds: [{ title: 'Renewal', fields: [{ name: 'Status', value: 'Pending' }] }], components: approvalComponents(`renew_approve_${buyerId}_${tierId}_${duration}`) },
    async editReply(reply) {
      await interaction.editReply(reply);
      if (reply.components) this.message.components = reply.components.map(row => row.toJSON());
    },
    deferUpdate: async () => { events.push('defer'); },
    followUp: async reply => { events.push('failure'); replies.push(reply); },
  };
  guild.channels.fetch = async () => ({ guild, isTextBased: () => true, send: async payload => announcements.push(payload) });
  return { announcements, approval, requests, member, setRecord: value => { record = value; }, events, replies, logged, guild, interaction, current: () => record };
}


for (const duration of ['1', '6', '12']) {
  for (const state of ['active', 'expired']) {
    test(`renew ${state} for ${duration} months preserves tier and saves before notifications`, async (t) => {
      const f = fixture(t, 'success', duration, state === 'active' ? now + month : now - month);
      await RenewApproveHandler.prototype.run(f.approval);
      const { paidPeriods, paymentHistoryComplete, subscriptionId, ...subscription } = f.current();
      assert.equal(paidPeriods.length, 1);
      assert.equal(paymentHistoryComplete, false);
      assert.deepEqual(subscription, {
        guildId: 'guild', userId: buyerId, roleId: tierId, durationMonths: Number(duration),
        expiresAt: now + (Number(duration) + (state === 'active' ? 1 : 0)) * month,
      });
      assert.deepEqual(f.events, ['defer', 'get', 'fetch', 'role', 'add', 'save', 'dm', 'staff']);
      assert.ok(f.replies.at(-1).embeds);
      assertApprovalButton(f.replies.at(-1).components, f.approval.customId, true);
    });
  }
}

for (const scenario of ['unauthorized', 'missing subscription', 'missing member', 'missing role', 'role failure', 'read failure', 'save failure', 'blocked DM', 'already has role']) {
  test(`renew handles ${scenario}`, async (t) => {
    const f = fixture(t, scenario);
    await RenewApproveHandler.prototype.run(f.approval);
    const success = ['blocked DM', 'already has role'].includes(scenario);
    assert.equal(Boolean(f.replies.at(-1).embeds), success);
    assert.equal(f.events.includes('dm'), success);
    assertApprovalButton(f.approval.message.components, f.approval.customId, success);
    if (!success) assert.ok(!f.events.includes('staff'));
    if (scenario === 'missing subscription') assert.match(f.replies.at(-1).content, /\/subscription buy/);
    if (scenario === 'save failure') assert.match(f.replies.at(-1).content, /role was restored.*could not be saved/);
    if (scenario === 'blocked DM') assert.equal(f.logged.mock.callCount(), 1);
    if (scenario === 'already has role') assert.ok(!f.events.includes('add'));
    if (['DM', 'unauthorized'].includes(scenario)) assert.deepEqual(f.events, ['reply']);
  });
}

for (const [duration, expiry] of [['2', now], ['1junk', now], ['1', NaN], ['1', Infinity], ['1', -1]]) {
  test(`renew rejects invalid duration ${duration} or expiry ${expiry} before role changes`, async (t) => {
    const f = fixture(t, 'success', duration, expiry);
    await RenewApproveHandler.prototype.run(f.approval);
    assert.ok(!f.events.includes('fetch'));
    assert.ok(!f.events.includes('save'));
    assert.ok(!f.replies.at(-1).embeds);
    assertApprovalButton(f.approval.message.components, f.approval.customId, false);
  });
}

test('simultaneous duplicate approvals apply once', async (t) => {
  const f = fixture(t);
  await Promise.all([RenewApproveHandler.prototype.run(f.approval), RenewApproveHandler.prototype.run(f.approval)]);
  assert.equal(f.current().expiresAt, now + 2 * month);
  assert.equal(f.events.filter(event => event === 'save').length, 1);
  assert.equal(f.events.filter(event => event === 'dm').length, 1);
  const updates = f.replies.filter(reply => reply.components);
  assert.equal(updates.length, 2);
  for (const update of updates) assertApprovalButton(update.components, f.approval.customId, true);
});

test('expiry snapshot racing with renewal re-reads and preserves renewed subscription', async (t) => {
  const f = fixture(t, 'success', '1', now - 1);
  let tick;
  let snapshotRead;
  const snapshotReady = new Promise((resolve) => { snapshotRead = resolve; });
  let allowSnapshot;
  const snapshotGate = new Promise((resolve) => { allowSnapshot = resolve; });
  t.mock.method(globalThis, 'setInterval', (callback) => { tick = callback; });
  t.mock.method(subscriptionStore, 'getAll', async () => {
    const snapshot = { ...f.current() };
    snapshotRead();
    await snapshotGate;
    return [snapshot];
  });
  t.mock.method(subscriptionStore, 'delete', async () => assert.fail('must preserve renewal'));
  setupSubscriptionExpiryChecker({ guilds: { cache: new Map([['guild', f.guild]]) } });
  const cleanup = tick();
  await snapshotReady;
  await RenewApproveHandler.prototype.run(f.approval);
  allowSnapshot();
  await cleanup;
  assert.ok(!f.events.includes('remove'));
  assert.equal(f.current().expiresAt, now + month);
});

for (const [name, grant] of [
  ['handler', (interaction) => BuyVerifyHandler.prototype.run(interaction)],
]) {
  test(`renewal racing with purchase ${name} rejects same-role purchase and extends only by approval`, async (t) => {
    const f = fixture(t);
    const purchase = {
      ...f.interaction,
      customId: `buy_verify_${buyerId}_${tierId}_1`,
      message: { embeds: [{ title: 'Purchase' }], components: [] },
      deferUpdate: async () => {},
      update: async () => {},
      followUp: async ({ content, ephemeral }) => {
        assert.equal(ephemeral, true);
        assert.match(content, /Use \/subscription renew/);
        f.events.push('purchase rejected');
      },
    };
    // Count persistence separately from the renewal notification assertions.
    const member = await f.guild.members.fetch(buyerId);
    member.send = async () => {};
    await Promise.all([
      RenewApproveHandler.prototype.run(f.approval),
      grant(purchase),
    ]);
    assert.equal(f.current().expiresAt, now + 2 * month);
    assert.equal(f.events.filter(event => event === 'save').length, 1);
    assert.ok(f.events.includes('purchase rejected'));
  });
}

for (const scenario of ['success', 'missing configuration', 'send failure', 'missing subscription', 'missing member', 'missing role', 'read failure', 'DM', 'unauthorized']) {
  test(`renew submission: ${scenario} never grants or persists`, async t => {
    const f = fixture(t, scenario);
    if (scenario === 'missing configuration') delete process.env.BUY_LOG_CHANNEL;
    const before = { ...f.current() };
    await SubscriptionCommand.prototype.chatInputRenew(f.interaction);
    assert.deepEqual(f.current(), before);
    for (const event of ['add', 'save', 'dm']) assert.ok(!f.events.includes(event));
    if (scenario === 'success') {
      assert.equal(f.events[0], 'defer');
      assert.equal(f.requests.length, 1);
      const embed = f.requests[0].embeds[0].toJSON();
      assert.equal(embed.fields.find(field => field.name === 'Status').value, '⏳ Pending approval');
      assertApprovalButton(f.requests[0].components, f.approval.customId, false);
      const reply = f.replies.at(-1);
      assert.equal(reply.embeds.length, 1);
      const confirmation = reply.embeds[0].toJSON();
      assert.equal(confirmation.title, '✅ Renewal Logged');
      assert.equal(confirmation.color, EMBED_COLORS.CONFIRMED);
      assert.equal(confirmation.footer.text, 'SoTeen Studio • Purchases');
      assert.ok(confirmation.timestamp);
      assert.match(confirmation.description, /\*\*Buyer\*\*/);
      assert.match(confirmation.description, /awaiting staff approval in the log channel/);
      assert.equal(Object.hasOwn(reply, 'content'), false);
    } else assert.equal(f.requests.length, 0);
  });
}

for (const staff of ['administrator', 'founder', 'deputy']) {
  test(`${staff} may approve renewals`, async t => {
    const f = fixture(t);
    if (staff !== 'administrator') {
      const role = staff === 'founder' ? Roles.FOUNDER : Roles.DEPUTY;
      const original = role.id;
      role.id = 'staff';
      t.after(() => { role.id = original; });
      f.approval.member.permissions.has = () => false;
      f.approval.member.roles.cache.set('staff', {});
    }
    await RenewApproveHandler.prototype.run(f.approval);
    assert.ok(f.events.includes('save'));
    assertApprovalButton(f.replies.at(-1).components, f.approval.customId, true);
    assert.match(f.replies.at(-1).embeds[0].data.fields.find(field => field.name === 'Status').value, /Approved by Admin/);
  });
}

for (const scenario of ['changed tier', 'invalid payload', 'wrong channel', 'overflow']) {
  test(`approval rejects ${scenario}`, async t => {
    const f = fixture(t);
    if (scenario === 'changed tier') f.setRecord({ ...f.current(), roleId: 'other' });
    if (scenario === 'invalid payload') f.approval.customId += '_extra';
    if (scenario === 'wrong channel') f.approval.channelId = 'other';
    if (scenario === 'overflow') f.setRecord({ ...f.current(), expiresAt: Number.MAX_SAFE_INTEGER });
    await RenewApproveHandler.prototype.run(f.approval);
    assert.ok(!f.events.includes('save'));
    assert.ok(!f.events.includes('add'));
    assert.match(f.replies.at(-1).content, /❌/);
    assert.ok(!f.events.includes('staff'));
    assertApprovalButton(f.approval.message.components, `renew_approve_${buyerId}_${tierId}_1`, false);
  });
}

test('approval uses latest state and approval time', async t => {
  const f = fixture(t);
  await SubscriptionCommand.prototype.chatInputRenew(f.interaction);
  const later = now + 5 * month;
  t.mock.method(Date, 'now', () => later);
  f.setRecord({ ...f.current(), expiresAt: later + month });
  await RenewApproveHandler.prototype.run(f.approval);
  assert.equal(f.current().expiresAt, later + 2 * month);
});

test('separate simultaneous requests are additive', async t => {
  const f = fixture(t);
  const second = { ...f.approval, customId: `renew_approve_${buyerId}_${tierId}_6`, message: { ...f.approval.message, id: '555555555555555555', components: approvalComponents(`renew_approve_${buyerId}_${tierId}_6`) } };
  f.member.send = async () => {};
  await Promise.all([RenewApproveHandler.prototype.run(f.approval), RenewApproveHandler.prototype.run(second)]);
  assert.equal(f.current().expiresAt, now + 8 * month);
});

test('retry after log failure repairs without duplicate extension or DM', async t => {
  const f = fixture(t);
  const editReply = f.approval.editReply;
  f.approval.editReply = async (reply) => {
    assertApprovalButton(reply.components, f.approval.customId, true);
    assert.equal(f.events.filter(event => event === 'save').length, 1);
    throw new Error('log failure');
  };
  await RenewApproveHandler.prototype.run(f.approval);
  assert.match(f.replies.at(-1).content, /renewal was saved.*log/);
  assertApprovalButton(f.approval.message.components, f.approval.customId, false);
  f.approval.editReply = editReply;
  await RenewApproveHandler.prototype.run(f.approval);
  assert.equal(f.current().expiresAt, now + 2 * month);
  assert.equal(f.events.filter(event => event === 'save').length, 1);
  assert.equal(f.events.filter(event => event === 'dm').length, 1);
  assertApprovalButton(f.replies.at(-1).components, f.approval.customId, true);
});

for (const retry of [false, true]) {
  test(`older request without emoji is repaired on ${retry ? 'saved-receipt retry' : 'approval'}`, async t => {
    const f = fixture(t);
    f.approval.message.components = approvalComponents(f.approval.customId, false);
    assert.equal(f.approval.message.components[0].components[0].emoji, undefined);
    const editReply = f.approval.editReply;
    if (retry) {
      f.approval.editReply = async () => { throw new Error('log failure'); };
      await RenewApproveHandler.prototype.run(f.approval);
      assert.equal(f.approval.message.components[0].components[0].disabled, false);
      assert.equal(f.approval.message.components[0].components[0].emoji, undefined);
      f.approval.editReply = editReply;
    }
    await RenewApproveHandler.prototype.run(f.approval);
    assertApprovalButton(f.approval.message.components, f.approval.customId, true);
    assert.equal(f.current().expiresAt, now + 2 * month);
    assert.equal(f.events.filter(event => event === 'save').length, 1);
    assert.equal(f.events.filter(event => event === 'dm').length, 1);
  });
}

test('save failure without restoration explicitly reports unchanged expiration', async t => {
  const f = fixture(t, 'save failure');
  f.member.roles.cache.set(tierId, {});
  await RenewApproveHandler.prototype.run(f.approval);
  assert.match(f.replies.at(-1).content, /expiration was not extended/);
  assert.ok(!f.events.includes('dm'));
  assert.ok(!f.events.includes('staff'));
  assertApprovalButton(f.approval.message.components, f.approval.customId, false);
});

for (const [duration, expiry] of [['2', now], ['1junk', now], ['1', NaN], ['1', Infinity], ['1', -1]]) {
  test(`submission rejects duration ${duration} or expiry ${expiry}`, async t => {
    const f = fixture(t, 'success', duration, expiry);
    await SubscriptionCommand.prototype.chatInputRenew(f.interaction);
    assert.equal(f.requests.length, 0);
    assert.ok(!f.events.includes('fetch'));
  });
}

for (const [tier, prices] of Object.entries({ DONATUR: [10000, 60000, 120000], BILLION: [25000, 150000, 300000], RICHMAN: [50000, 300000, 600000] })) {
  for (const [index, duration] of [1, 6, 12].entries()) {
    test('SubscriptionCommand payment estimate ' + tier + ' ' + duration, async t => {
      const f = fixture(t, 'success', String(duration));
      const originalRole = Roles[tier].id;
      Roles[tier].id = `role-${tier}`;
      t.after(() => { Roles[tier].id = originalRole; });
      f.setRecord({ ...f.current(), roleId: Roles[tier].id, subscriptionId: '11111111-1111-4111-8111-111111111111' });
      const text = expectedMoney(prices[index]);
      assert.deepEqual(getPaymentAmount(Roles[tier].id, duration), { amount: prices[index], text });
      await SubscriptionCommand.prototype.chatInputRenew(f.interaction);
      assert.equal(f.requests.length, 1);
      const log = f.requests[0].embeds[0].toJSON();
      assert.deepEqual(log.fields.find(field => field.name === 'Amount to Pay'), { name: 'Amount to Pay', value: text, inline: true });
      const confirmation = f.replies.at(-1).embeds[0].toJSON();
      for (const embed of [log, confirmation]) {
        assert.match(embed.description, /estimate/);
        assert.match(embed.description, /manual payment/);
        assert.match(embed.description, /bot does not take payment/);
        assert.match(embed.description, /dummy test prices/i);
      }
      assert.ok(confirmation.description.includes(text));
      const button = f.requests[0].components[0].toJSON().components[0];
      assert.equal(button.custom_id, `renew_approve_${buyerId}_${Roles[tier].id}_${duration}_${f.current().subscriptionId}`);
      assert.ok(!button.custom_id.includes(String(prices[index])));
      assert.equal(button.emoji.name, '✅');
      assert.equal(button.style, ButtonStyle.Success);
    });
  }
}

for (const invalid of ['missing price', 'missing currency', 'invalid currency', 'invalid price', 'unsupported tier']) {
  test('SubscriptionCommand rejects ' + invalid + ' without posting a log', async t => {
    const f = fixture(t);
    const originalPrice = subscriptionPrices.prices.DONATUR[1];
    const originalCurrency = subscriptionPrices.currency;
    t.after(() => { subscriptionPrices.prices.DONATUR[1] = originalPrice; subscriptionPrices.currency = originalCurrency; });
    if (invalid === 'missing price') subscriptionPrices.prices.DONATUR[1] = undefined;
    if (invalid === 'invalid price') subscriptionPrices.prices.DONATUR[1] = -1;
    if (invalid === 'missing currency') subscriptionPrices.currency = undefined;
    if (invalid === 'invalid currency') subscriptionPrices.currency = { code: 'bad', minorUnitDigits: 0 };
    if (invalid === 'unsupported tier') {
      f.setRecord({ ...f.current(), roleId: 'unknown-role' });
    }
    await SubscriptionCommand.prototype.chatInputRenew(f.interaction);
    assert.equal(f.requests.length, 0);
    assert.match(f.replies.at(-1).content, /Unable to determine amount to pay/);
    assert.match(f.replies.at(-1).content, /No log was posted/);
    assert.ok(!f.events.includes('save'));
  });
}

for (const [tier, prices] of Object.entries({ DONATUR: [10000, 60000, 120000], BILLION: [25000, 150000, 300000], RICHMAN: [50000, 300000, 600000] })) {
  for (const [index, duration] of [1, 6, 12].entries()) {
    test(`renewal DM saved amount ${tier} ${duration}`, async t => {
      const f = fixture(t, 'success', String(duration), now + month, tier);
      const originalPrice = subscriptionPrices.prices[tier][duration];
      t.after(() => { subscriptionPrices.prices[tier][duration] = originalPrice; });
      const save = subscriptionStore.saveRenewalApproval;
      t.mock.method(subscriptionStore, 'saveRenewalApproval', async (...args) => {
        await save(...args);
        subscriptionPrices.prices[tier][duration] = 999999;
      });
      await RenewApproveHandler.prototype.run(f.approval);
      assert.equal(f.current().paidPeriods.at(-1).price, prices[index]);
      assert.equal(f.logged.mock.callCount(), 0);
      assert.deepEqual(f.events, ['defer', 'get', 'fetch', 'role', 'add', 'save', 'dm', 'staff']);
      await RenewApproveHandler.prototype.run(f.approval);
      assert.equal(f.events.filter(event => event === 'dm').length, 1);
    });
  }
}

test('renewal DM formatting failure omits amount and logs once without blocking approval', async t => {
  const f = fixture(t, 'format failure');
  await RenewApproveHandler.prototype.run(f.approval);
  assert.deepEqual(f.events, ['defer', 'get', 'fetch', 'role', 'add', 'save', 'dm', 'staff']);
  assert.equal(f.logged.mock.callCount(), 1);
  assert.match(f.logged.mock.calls[0].arguments[0], /Failed to format renewal DM amount/);
  await RenewApproveHandler.prototype.run(f.approval);
  assert.equal(f.events.filter(event => event === 'dm').length, 1);
  assert.equal(f.logged.mock.callCount(), 1);
});

for (const scenario of ['success', 'save failure']) test('renew announcement: ' + scenario, async t => {
  const f = fixture(t, scenario);
  await SubscriptionCommand.prototype.chatInputRenew(f.interaction);
  assert.ok(!f.requests[0].components[0].toJSON().components[0].custom_id.includes('command-channel'));
  await RenewApproveHandler.prototype.run(f.approval);
  await RenewApproveHandler.prototype.run(f.approval);
  assert.equal(f.announcements.length, scenario === 'success' ? 1 : 0);
  if (scenario === 'success') {
    assert.deepEqual(f.announcements[0].allowedMentions, { parse: [] });
    assert.equal(f.announcements[0].embeds[0].toJSON().description, '<@staff> has approved this process (Renew)');
  }
});

test('origin write failure keeps the posted renewal valid', async t => {
  const f = fixture(t);
  t.mock.method(subscriptionStore, 'saveApprovalOrigin', async () => { throw new Error('offline'); });
  await SubscriptionCommand.prototype.chatInputRenew(f.interaction);
  assert.equal(f.requests.length, 1);
  assert.equal(f.replies.at(-1).embeds[0].data.title, '✅ Renewal Logged');
});
