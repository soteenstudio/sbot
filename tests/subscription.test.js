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
import { BuyVerifyHandler } from '../dist/interaction-handlers/BuyVerifyHandler.js';
import { setupSubscriptionExpiryChecker } from '../dist/lib/subscriptionExpiryChecker.js';
import { subscriptionStore } from '../dist/lib/subscriptionStore.js';

const month = 30 * 24 * 60 * 60 * 1000;
const now = 1800000000000;
const record = { guildId: 'guild', userId: 'buyer', roleId: 'role', durationMonths: 2, expiresAt: now - 1 };

for (const scenario of ['new', 'active', 'expired', 'other tier']) {
  test(`purchase ${scenario} uses the correct expiry and acknowledges before work`, async (t) => {
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
      assert.deepEqual(saved, { ...record, expiresAt: now + (scenario === 'active' ? 3 : 2) * month });
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
        return { roles: { add: async () => { events.push('add'); } } };
      } } },
      editReply: async ({ embeds }) => {
        events.push('edit');
        assert.match(embeds[0].data.fields[0].value, /Verified and granted/);
      },
    };
    await BuyVerifyHandler.prototype.run(interaction);
    assert.equal(events[0], 'defer');
    assert.ok(events.indexOf('get') < events.indexOf('set'));
    assert.equal(events.at(-1), 'edit');
  });
}

for (const failure of ['fetch', 'add']) {
  test(`purchase ${failure} failure uses an ephemeral follow-up after deferral`, async (t) => {
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
        return { roles: { add: async () => { throw new Error('add failed'); } } };
      } } },
      followUp: async ({ ephemeral }) => { assert.equal(ephemeral, true); events.push('follow-up'); },
    });
    assert.deepEqual(events, ['defer', 'follow-up']);
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
