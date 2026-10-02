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
import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { BuyVerifyHandler } from '../dist/interaction-handlers/BuyVerifyHandler.js';
import { RenewApproveHandler } from '../dist/interaction-handlers/RenewApproveHandler.js';
import { Roles } from '../dist/config.js';
import { RenewCommand } from '../dist/commands/RenewCommand.js';
import { subscriptionStore } from '../dist/lib/subscriptionStore.js';
import { setupSubscriptionExpiryChecker } from '../dist/lib/subscriptionExpiryChecker.js';
import { EMBED_COLORS, EMBED_FOOTER } from '../dist/engine/SEmbed.js';

const buyerId = '111111111111111111';
const tierId = '222222222222222222';
const logId = '333333333333333333';
const now = 1800000000000;
const month = 30 * 24 * 60 * 60 * 1000;

function fixture(t, scenario = 'success', duration = '1', expiry = now + month) {
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
    channels: { cache: new Map([[logId, { type: 0, send: async request => { events.push('send'); if (scenario === 'send failure') throw new Error('send'); requests.push(request); } }]]) },
    roles: { cache: new Map([[tierId, { name: 'Donatur' }]]), fetch: async () => {
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
      assert.equal(embed.color, EMBED_COLORS.CONFIRMED);
      assert.equal(embed.footer.text, `${EMBED_FOOTER} • Purchases`);
      assert.deepEqual(Object.fromEntries(embed.fields.map(({ name, value }) => [name, value])), {
        Server: 'Test Server', 'Subscription Tier': 'Donatur',
        'Added Duration': `${duration} Month${duration === '1' ? '' : 's'}`,
        Expires: `<t:${Math.floor(record.expiresAt / 1000)}:F>`,
      });
      if (scenario === 'blocked DM') throw new Error('dm');
    },
  };
  const interaction = {
    guild, inCachedGuild: () => scenario !== 'DM',
    member: { permissions: { has: () => scenario !== 'unauthorized' }, roles: { cache: new Map() } },
    user: { tag: 'Admin' },
    options: { getUser: () => ({ id: buyerId, tag: 'Buyer' }), getString: () => duration },
    reply: async (reply) => { events.push('reply'); replies.push(reply); },
    deferReply: async ({ flags }) => { assert.equal(flags, MessageFlags.Ephemeral); events.push('defer'); },
    editReply: async (reply) => { events.push('staff'); replies.push(reply); },
  };
  const approval = {
    ...interaction, channelId: logId,
    customId: `renew_approve_${buyerId}_${tierId}_${duration}`,
    message: { id: '444444444444444444', embeds: [{ title: 'Renewal', fields: [{ name: 'Status', value: 'Pending' }] }] },
    deferUpdate: async () => { events.push('defer'); },
    followUp: async reply => { events.push('failure'); replies.push(reply); },
  };
  return { approval, requests, member, setRecord: value => { record = value; }, events, replies, logged, guild, interaction, current: () => record };
}

test('renew registration is guild-only, admin-only, and requires buyer and supported duration', () => {
  let data;
  RenewCommand.prototype.registerApplicationCommands.call(
    { name: 'renew', description: 'Renew subscription' },
    { registerChatInputCommand: (callback) => { data = callback(new SlashCommandBuilder()).toJSON(); } },
  );
  assert.equal(data.dm_permission, false);
  assert.equal(data.default_member_permissions, String(PermissionFlagsBits.Administrator));
  assert.deepEqual(data.options.map(({ name, required }) => [name, required]), [['buyer', true], ['duration', true]]);
  assert.deepEqual(data.options[1].choices.map(({ value }) => value), ['1', '6', '12']);
});

for (const duration of ['1', '6', '12']) {
  for (const state of ['active', 'expired']) {
    test(`renew ${state} for ${duration} months preserves tier and saves before notifications`, async (t) => {
      const f = fixture(t, 'success', duration, state === 'active' ? now + month : now - month);
      await RenewApproveHandler.prototype.run(f.approval);
      assert.deepEqual(f.current(), {
        guildId: 'guild', userId: buyerId, roleId: tierId, durationMonths: Number(duration),
        expiresAt: now + (Number(duration) + (state === 'active' ? 1 : 0)) * month,
      });
      assert.deepEqual(f.events, ['defer', 'get', 'fetch', 'role', 'add', 'save', 'dm', 'staff']);
      assert.ok(f.replies.at(-1).embeds);
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
    if (scenario === 'missing subscription') assert.match(f.replies.at(-1).content, /\/buy/);
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
  });
}

test('simultaneous duplicate approvals apply once', async (t) => {
  const f = fixture(t);
  await Promise.all([RenewApproveHandler.prototype.run(f.approval), RenewApproveHandler.prototype.run(f.approval)]);
  assert.equal(f.current().expiresAt, now + 2 * month);
  assert.equal(f.events.filter(event => event === 'save').length, 1);
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
  test(`renewal racing with purchase ${name} retains both durations`, async (t) => {
    const f = fixture(t);
    const purchase = {
      ...f.interaction,
      customId: `buy_verify_${buyerId}_${tierId}_1`,
      message: { embeds: [{ title: 'Purchase' }], components: [] },
      deferUpdate: async () => {},
      update: async () => {},
    };
    // Inspect each saved duration rather than reusing renewal-only DM assertions.
    const member = await f.guild.members.fetch(buyerId);
    member.send = async () => {};
    await Promise.all([
      RenewApproveHandler.prototype.run(f.approval),
      grant(purchase),
    ]);
    assert.equal(f.current().expiresAt, now + 3 * month);
  });
}

for (const scenario of ['success', 'missing configuration', 'send failure', 'missing subscription', 'missing member', 'missing role', 'read failure', 'DM', 'unauthorized']) {
  test(`renew submission: ${scenario} never grants or persists`, async t => {
    const f = fixture(t, scenario);
    if (scenario === 'missing configuration') delete process.env.BUY_LOG_CHANNEL;
    const before = { ...f.current() };
    await RenewCommand.prototype.chatInputRun(f.interaction);
    assert.deepEqual(f.current(), before);
    for (const event of ['add', 'save', 'dm']) assert.ok(!f.events.includes(event));
    if (scenario === 'success') {
      assert.equal(f.events[0], 'defer');
      assert.equal(f.requests.length, 1);
      const embed = f.requests[0].embeds[0].toJSON();
      assert.equal(embed.fields.find(field => field.name === 'Status').value, '⏳ Pending approval');
      assert.equal(f.requests[0].components[0].components[0].data.custom_id, f.approval.customId);
      assert.match(f.replies.at(-1).content, /awaiting approval/);
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
    assert.deepEqual(f.replies.at(-1).components, []);
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
  });
}

test('approval uses latest state and approval time', async t => {
  const f = fixture(t);
  await RenewCommand.prototype.chatInputRun(f.interaction);
  const later = now + 5 * month;
  t.mock.method(Date, 'now', () => later);
  f.setRecord({ ...f.current(), expiresAt: later + month });
  await RenewApproveHandler.prototype.run(f.approval);
  assert.equal(f.current().expiresAt, later + 2 * month);
});

test('separate simultaneous requests are additive', async t => {
  const f = fixture(t);
  const second = { ...f.approval, customId: `renew_approve_${buyerId}_${tierId}_6`, message: { ...f.approval.message, id: '555555555555555555' } };
  f.member.send = async () => {};
  await Promise.all([RenewApproveHandler.prototype.run(f.approval), RenewApproveHandler.prototype.run(second)]);
  assert.equal(f.current().expiresAt, now + 8 * month);
});

test('retry after log failure repairs without duplicate extension or DM', async t => {
  const f = fixture(t);
  f.approval.editReply = async () => { throw new Error('log failure'); };
  await RenewApproveHandler.prototype.run(f.approval);
  assert.match(f.replies.at(-1).content, /renewal was saved.*log/);
  f.approval.editReply = f.interaction.editReply;
  await RenewApproveHandler.prototype.run(f.approval);
  assert.equal(f.current().expiresAt, now + 2 * month);
  assert.equal(f.events.filter(event => event === 'save').length, 1);
  assert.equal(f.events.filter(event => event === 'dm').length, 1);
});

test('save failure without restoration explicitly reports unchanged expiration', async t => {
  const f = fixture(t, 'save failure');
  f.member.roles.cache.set(tierId, {});
  await RenewApproveHandler.prototype.run(f.approval);
  assert.match(f.replies.at(-1).content, /expiration was not extended/);
  assert.ok(!f.events.includes('dm'));
});

for (const [duration, expiry] of [['2', now], ['1junk', now], ['1', NaN], ['1', Infinity], ['1', -1]]) {
  test(`submission rejects duration ${duration} or expiry ${expiry}`, async t => {
    const f = fixture(t, 'success', duration, expiry);
    await RenewCommand.prototype.chatInputRun(f.interaction);
    assert.equal(f.requests.length, 0);
    assert.ok(!f.events.includes('fetch'));
  });
}
