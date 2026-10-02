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
import { BuyCommand } from '../dist/commands/BuyCommand.js';
import { BuyVerifyHandler } from '../dist/interaction-handlers/BuyVerifyHandler.js';
import { RenewCommand } from '../dist/commands/RenewCommand.js';
import { subscriptionStore } from '../dist/lib/subscriptionStore.js';
import { setupSubscriptionExpiryChecker } from '../dist/lib/subscriptionExpiryChecker.js';
import { EMBED_COLORS, EMBED_FOOTER } from '../dist/engine/SEmbed.js';

const now = 1800000000000;
const month = 30 * 24 * 60 * 60 * 1000;

function fixture(t, scenario = 'success', duration = '1', expiry = now + month) {
  const events = [];
  let record = { guildId: 'guild', userId: 'buyer', roleId: 'tier', durationMonths: 6, expiresAt: expiry };
  const replies = [];
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
    roles: { cache: new Map([['tier', { name: 'Donatur' }]]), fetch: async () => {
      events.push('role');
      return scenario === 'missing role' ? null : { id: 'tier' };
    } },
    members: { fetch: async () => {
      events.push('fetch');
      if (scenario === 'missing member') throw new Error('fetch');
      return member;
    } },
  };
  const member = {
    id: 'buyer', guild,
    roles: {
      cache: new Map(scenario === 'already has role' ? [['tier', {}]] : []),
      add: async (roleId) => {
        assert.equal(roleId, 'tier'); events.push('add');
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
    member: { permissions: { has: () => scenario !== 'unauthorized' } },
    user: { tag: 'Admin' },
    options: { getUser: () => ({ id: 'buyer', tag: 'Buyer' }), getString: () => duration },
    reply: async (reply) => { events.push('reply'); replies.push(reply); },
    deferReply: async ({ flags }) => { assert.equal(flags, MessageFlags.Ephemeral); events.push('defer'); },
    editReply: async (reply) => { events.push('staff'); replies.push(reply); },
  };
  return { events, replies, logged, guild, interaction, current: () => record };
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
      await RenewCommand.prototype.chatInputRun(f.interaction);
      assert.deepEqual(f.current(), {
        guildId: 'guild', userId: 'buyer', roleId: 'tier', durationMonths: Number(duration),
        expiresAt: now + (Number(duration) + (state === 'active' ? 1 : 0)) * month,
      });
      assert.deepEqual(f.events, ['defer', 'get', 'fetch', 'role', 'add', 'save', 'dm', 'staff']);
      assert.ok(f.replies.at(-1).embeds);
    });
  }
}

for (const scenario of ['DM', 'unauthorized', 'missing subscription', 'missing member', 'missing role', 'role failure', 'read failure', 'save failure', 'blocked DM', 'already has role']) {
  test(`renew handles ${scenario}`, async (t) => {
    const f = fixture(t, scenario);
    await RenewCommand.prototype.chatInputRun(f.interaction);
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
    await RenewCommand.prototype.chatInputRun(f.interaction);
    assert.ok(!f.events.includes('fetch'));
    assert.ok(!f.events.includes('save'));
    assert.ok(!f.replies.at(-1).embeds);
  });
}

test('simultaneous renewals preserve both added durations', async (t) => {
  const f = fixture(t);
  await Promise.all([RenewCommand.prototype.chatInputRun(f.interaction), RenewCommand.prototype.chatInputRun(f.interaction)]);
  assert.equal(f.current().expiresAt, now + 3 * month);
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
  await RenewCommand.prototype.chatInputRun(f.interaction);
  allowSnapshot();
  await cleanup;
  assert.ok(!f.events.includes('remove'));
  assert.equal(f.current().expiresAt, now + month);
});

for (const [name, grant] of [
  ['command', BuyCommand.handleButtonVerify],
  ['handler', (interaction) => BuyVerifyHandler.prototype.run(interaction)],
]) {
  test(`renewal racing with purchase ${name} retains both durations`, async (t) => {
    const f = fixture(t);
    const purchase = {
      ...f.interaction,
      customId: 'buy_verify_buyer_tier_1',
      message: { embeds: [{ title: 'Purchase' }], components: [] },
      deferUpdate: async () => {},
      update: async () => {},
    };
    // Inspect each saved duration rather than reusing renewal-only DM assertions.
    const member = await f.guild.members.fetch('buyer');
    member.send = async () => {};
    await Promise.all([
      RenewCommand.prototype.chatInputRun(f.interaction),
      grant(purchase),
    ]);
    assert.equal(f.current().expiresAt, now + 3 * month);
  });
}
