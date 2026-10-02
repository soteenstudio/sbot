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
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { BuyCommand } from '../dist/commands/BuyCommand.js';
import { Roles } from '../dist/config.js';
import { MessageFlags, ButtonStyle, ActionRowBuilder, ButtonBuilder } from 'discord.js';
import { BuyVerifyHandler } from '../dist/interaction-handlers/BuyVerifyHandler.js';
import { setupSubscriptionExpiryChecker } from '../dist/lib/subscriptionExpiryChecker.js';
import { subscriptionStore } from '../dist/lib/subscriptionStore.js';

const month = 30 * 24 * 60 * 60 * 1000;
const now = 1800000000000;
const record = { guildId: 'guild', userId: 'buyer', roleId: 'role', durationMonths: 2, expiresAt: now - 1 };

for (const scenario of ['new', 'active', 'expired', 'other tier']) {
  test(`purchase ${scenario} checks the subscription before granting access`, async (t) => {
    const events = [];
    const existing = scenario === 'new' ? undefined : {
      ...record,
      roleId: scenario === 'other tier' ? 'other' : 'role',
      expiresAt: scenario === 'expired' ? now - month : now + month,
    };
    t.mock.method(Date, 'now', () => now);
    t.mock.method(subscriptionStore, 'get', async (guildId, userId) => {
      events.push('get');
      assert.deepEqual([guildId, userId], ['guild', 'buyer']);
      return existing;
    });
    t.mock.method(subscriptionStore, 'set', async (saved) => {
      events.push('set');
      assert.deepEqual(saved, { ...record, expiresAt: now + 2 * month });
    });
    const interaction = {
      inCachedGuild: () => true,
      member: { permissions: { has: () => true } },
      customId: 'buy_verify_buyer_role_2',
      user: { tag: 'Verifier' },
      message: { embeds: [{ title: 'Purchase' }], components: [] },
      deferUpdate: async () => { events.push('defer'); },
      guild: { id: 'guild', members: { fetch: async () => {
        events.push('fetch');
        return {
          guild: { name: 'Server', roles: { cache: new Map([['role', { name: 'Donatur' }]]) } },
          send: async ({ embeds }) => {
            events.push('dm');
            assert.equal(embeds[0].data.fields.find((field) => field.name === 'Expires').value,
              `<t:${Math.floor((now + 2 * month) / 1000)}:F>`);
          },
          roles: { cache: new Map(), add: async () => { events.push('add'); } },
        };
      } } },
      followUp: async ({ content, ephemeral }) => {
        assert.equal(ephemeral, true);
        assert.match(content, /Use \/renew/);
        events.push('rejected');
      },
      editReply: async ({ embeds }) => {
        events.push('edit');
        assert.match(embeds[0].data.fields[0].value, /Verified and granted/);
      },
    };
    await BuyVerifyHandler.prototype.run(interaction);
    if (['active', 'expired'].includes(scenario)) {
      assert.deepEqual(events, ['defer', 'get', 'rejected']);
      return;
    }
    assert.deepEqual(events, ['defer', 'get', 'fetch', 'add', 'set', 'dm', 'edit']);
    assert.ok(events.indexOf('get') < events.indexOf('set'));
    assert.ok(events.indexOf('set') < events.indexOf('dm'));
    assert.equal(events.filter((event) => event === 'dm').length, 1);
    assert.equal(events.at(-1), 'edit');
  });
}

for (const failure of ['fetch', 'add']) {
  test(`purchase ${failure} failure uses an ephemeral follow-up after deferral`, async (t) => {
    t.mock.method(subscriptionStore, 'get', async () => undefined);
    t.mock.method(subscriptionStore, 'set', () => assert.fail('must not persist'));
    const events = [];
    await BuyVerifyHandler.prototype.run({
      inCachedGuild: () => true,
      member: { permissions: { has: () => true } },
      customId: 'buy_verify_buyer_role_2',
      user: { tag: 'Verifier' },
      deferUpdate: async () => { events.push('defer'); },
      guild: { members: { fetch: async () => {
        if (failure === 'fetch') throw new Error('fetch failed');
        return { roles: { cache: new Map(), add: async () => { throw new Error('add failed'); } } };
      } } },
      followUp: async ({ ephemeral }) => { assert.equal(ephemeral, true); events.push('follow-up'); },
    });
    assert.deepEqual(events, ['defer', 'follow-up']);
  });
}

function purchaseFixture(t, existing, readFailure = false) {
  const events = [];
  const requests = [];
  const replies = [];
  let current = existing;
  const originalRoleId = Roles.DONATUR.id;
  const originalLogId = process.env.BUY_LOG_CHANNEL;
  Roles.DONATUR.id = 'role';
  process.env.BUY_LOG_CHANNEL = 'log';
  t.after(() => {
    Roles.DONATUR.id = originalRoleId;
    if (originalLogId === undefined) delete process.env.BUY_LOG_CHANNEL;
    else process.env.BUY_LOG_CHANNEL = originalLogId;
  });
  t.mock.method(Date, 'now', () => now);
  const logged = t.mock.method(console, 'error', () => {});
  t.mock.method(subscriptionStore, 'get', async (guildId, userId) => {
    events.push('get');
    assert.deepEqual([guildId, userId], ['guild', 'buyer']);
    if (readFailure) throw new Error('storage unavailable');
    return current;
  });
  t.mock.method(subscriptionStore, 'set', async saved => { events.push('save'); current = saved; });
  t.mock.method(subscriptionStore, 'delete', () => assert.fail('must not delete'));
  t.mock.method(subscriptionStore, 'saveRenewalApproval', () => assert.fail('must not renew'));
  const guild = {
    id: 'guild', name: 'Server',
    channels: { cache: new Map([['log', { type: 0, send: async request => { events.push('log'); requests.push(request); } }]]) },
    roles: { cache: new Map([['role', { name: 'Donatur' }]]) },
    members: { fetch: async () => { events.push('fetch'); return member; } },
  };
  const member = {
    id: 'buyer', guild,
    roles: { cache: new Map(), add: async () => { events.push('add'); } },
    send: async () => { events.push('dm'); },
  };
  const interaction = {
    guild, guildId: guild.id, user: { tag: 'Staff' },
    options: { getUser: () => ({ id: 'buyer', tag: 'Buyer' }), getString: name => name === 'role' ? 'DONATUR' : '1' },
    reply: async () => assert.fail('must not acknowledge twice'),
    deferReply: async ({ flags }) => { assert.equal(flags, MessageFlags.Ephemeral); events.push('defer'); },
    editReply: async reply => { events.push('edit'); replies.push(reply); },
  };
  const customId = 'buy_verify_buyer_role_1';
  const approval = {
    ...interaction, inCachedGuild: () => true,
    member: { permissions: { has: () => true } }, customId,
    message: { embeds: [{ title: 'Purchase' }], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(customId).setLabel('Verify & Grant').setEmoji('✅').setStyle(ButtonStyle.Success)).toJSON()] },
    deferUpdate: async () => { events.push('defer'); },
    followUp: async reply => { assert.equal(reply.ephemeral, true); events.push('rejected'); replies.push(reply); },
  };
  return { interaction, approval, events, requests, replies, logged, current: () => current };
}

for (const state of ['active', 'expired', 'new', 'other tier', 'read failure']) {
  test(`buy submission: ${state}`, async t => {
    const existing = state === 'new' ? undefined : { ...record, roleId: state === 'other tier' ? 'other' : 'role', expiresAt: state === 'expired' ? now - month : now + month };
    const f = purchaseFixture(t, existing, state === 'read failure');
    await BuyCommand.prototype.chatInputRun(f.interaction);
    assert.deepEqual(f.current(), existing);
    const allowed = ['new', 'other tier'].includes(state);
    assert.deepEqual(f.events, allowed ? ['defer', 'get', 'log', 'edit'] : ['defer', 'get', 'edit']);
    assert.equal(f.requests.length, allowed ? 1 : 0);
    if (allowed) {
      const confirmation = f.replies[0].embeds[0].toJSON();
      assert.equal(confirmation.title, '✅ Purchase Logged');
      assert.equal(confirmation.footer.text, 'SoTeen Studio • Purchases');
      assert.match(confirmation.description, /\*\*Buyer\*\*/);
      assert.ok(confirmation.timestamp);
    } else if (state === 'read failure') {
      assert.match(f.replies[0].content, /Failed to load/);
      assert.equal(f.logged.mock.callCount(), 1);
    } else {
      assert.equal(f.replies[0].content, '❌ This buyer already has a subscription for this role. Use /renew to extend it.');
    }
  });
}

for (const concurrent of [true, false]) {
  test(concurrent ? 'concurrent same-role approvals grant, save and notify once' : 'older pending purchase cannot extend a subscription granted after submission', async t => {
    const f = purchaseFixture(t, undefined);
    // Both requests were submitted before either subscription was granted.
    await BuyCommand.prototype.chatInputRun(f.interaction);
    await BuyCommand.prototype.chatInputRun(f.interaction);
    assert.equal(f.requests.length, 2);
    f.events.length = 0;
    if (concurrent) {
      await Promise.all([BuyVerifyHandler.prototype.run(f.approval), BuyVerifyHandler.prototype.run({ ...f.approval })]);
    } else {
      await BuyVerifyHandler.prototype.run(f.approval);
      await BuyVerifyHandler.prototype.run({ ...f.approval });
    }
    for (const event of ['add', 'save', 'dm', 'edit', 'rejected']) assert.equal(f.events.filter(value => value === event).length, 1);
    assert.equal(f.current().expiresAt, now + month);
    assert.match(f.replies.at(-1).content, /Use \/renew/);
    const button = f.replies.at(-2).components[0].toJSON().components[0];
    assert.equal(button.disabled, true);
    assert.equal(button.style, ButtonStyle.Success);
    assert.equal(button.emoji.name, '✅');
  });
}

for (const scenario of ['missing guild', 'unavailable guild', 'fetch failure', 'remove failure', 'fetch unknown member', 'remove unknown member', 'success', 'not expired']) {
  test(`expiry ${scenario} only deletes after removal or confirmed departure`, async (t) => {
    let tick;
    let deleted = false;
    let removed = false;
    t.mock.method(globalThis, 'setInterval', (callback) => { tick = callback; });
    t.mock.method(Date, 'now', () => now);
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'error', () => {});
    t.mock.method(subscriptionStore, 'getAll', async () => [{ ...record, expiresAt: scenario === 'not expired' ? now + month : now - 1 }]);
    t.mock.method(subscriptionStore, 'get', async () => ({ ...record, expiresAt: scenario === 'not expired' ? now + month : now - 1 }));
    t.mock.method(subscriptionStore, 'delete', async (guildId, userId) => {
      assert.deepEqual([guildId, userId], ['guild', 'buyer']);
      if (scenario === 'success') assert.equal(removed, true);
      deleted = true;
    });
    let failOnce = true;
    const guild = {
      available: scenario !== 'unavailable guild',
      members: { fetch: async () => {
        if (failOnce && scenario.startsWith('fetch')) throw Object.assign(new Error('fetch failed'), { code: scenario.endsWith('unknown member') ? 10007 : 50001 });
        return { roles: { remove: async () => {
          if (failOnce && scenario.startsWith('remove')) throw Object.assign(new Error('remove failed'), { code: scenario.endsWith('unknown member') ? 10007 : 50013 });
          removed = true;
        } } };
      } },
    };
    let cachedGuild = scenario === 'missing guild' ? undefined : guild;
    // Supply a mutable cache to model recovery on the next interval.
    const cache = { get: () => cachedGuild };
    setupSubscriptionExpiryChecker({ guilds: { cache } });
    await tick();
    assert.equal(deleted, scenario === 'success' || scenario.endsWith('unknown member'));
    if (['missing guild', 'unavailable guild', 'fetch failure', 'remove failure'].includes(scenario)) {
      cachedGuild = guild;
      guild.available = true;
      failOnce = false;
      await tick();
      assert.equal(removed, true);
      assert.equal(deleted, true);
    }
  });
}

test('corrupt storage rejects reads and mutations without changing bytes, then recovers', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sbot-subscription-'));
  const originalCwd = process.cwd();
  t.after(async () => { process.chdir(originalCwd); await rm(directory, { recursive: true, force: true }); });
  process.chdir(directory);
  const { subscriptionStore: store } = await import(`../dist/lib/subscriptionStore.js?isolated=${Date.now()}`);
  await store.set(record);
  const file = join(directory, 'data/subscriptions.json');
  const corrupt = '{ "guild": incomplete';
  await writeFile(file, corrupt);
  for (const operation of [() => store.get('guild', 'buyer'), () => store.getAll(), () => store.set(record), () => store.delete('guild', 'buyer')]) {
    await assert.rejects(operation(), SyntaxError);
    assert.equal(await readFile(file, 'utf8'), corrupt);
  }
  await writeFile(file, '{}');
  await store.set(record);
  assert.deepEqual(await store.get('guild', 'buyer'), record);
  await store.delete('guild', 'buyer');
  assert.deepEqual(await store.getAll(), []);
});
