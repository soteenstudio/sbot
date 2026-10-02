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
import { BuyVerifyHandler } from '../dist/interaction-handlers/BuyVerifyHandler.js';
import { EMBED_COLORS, EMBED_FOOTER } from '../dist/engine/SEmbed.js';
import { subscriptionStore } from '../dist/lib/subscriptionStore.js';

import { subscriptionPrices } from '../dist/lib/subscriptionPrices.js';
import { Roles } from '../dist/config.js';

const now = 1800000000123;
const month = 30 * 24 * 60 * 60 * 1000;

for (const [name, grant] of [
  ['handler', (interaction) => BuyVerifyHandler.prototype.run(interaction)],
]) {
  const prices = { DONATUR: [10000, 60000, 120000], BILLION: [25000, 150000, 300000], RICHMAN: [50000, 300000, 600000] };
  const cases = Object.entries(prices).flatMap(([tier, amounts]) =>
    [1, 6, 12].map((duration, index) => ['success', tier, duration, amounts[index]]));
  for (const scenario of ['format failure', 'blocked DM', 'fetch failure', 'role failure', 'save failure', 'save failure with existing role', 'save failure with rollback failure', 'read failure']) cases.push([scenario, 'DONATUR', 1, 10000]);
  for (const [scenario, tier, duration, amount] of cases) {
    test(`${name}: ${tier} ${duration} purchase notification on ${scenario}`, async (t) => {
      const originalRole = Roles[tier].id; Roles[tier].id = 'role';
      const originalPrice = subscriptionPrices.prices[tier][duration];
      t.after(() => { Roles[tier].id = originalRole; subscriptionPrices.prices[tier][duration] = originalPrice; });
      const events = [];
      let saved;
      let followUp;
      const saveFailure = scenario.startsWith('save failure');
      const hadRole = scenario === 'save failure with existing role';
      const rollbackFailure = scenario === 'save failure with rollback failure';
      const roleCache = new Map(hadRole ? [['role', {}]] : []);
      const error = new Error(scenario);
      t.mock.method(Date, 'now', () => now);
      const logged = t.mock.method(console, 'error', () => {});
      t.mock.method(subscriptionStore, 'get', async () => {
        events.push('get');
        if (scenario === 'read failure') throw error;
        return undefined;
      });
      t.mock.method(subscriptionStore, 'set', async (record) => {
        events.push('save');
        if (saveFailure) throw error;
        saved = record;
        subscriptionPrices.prices[tier][duration] = 999999;
        if (scenario === 'format failure') record.paidPeriods[0].currency = { code: 'bad', minorUnitDigits: 0 };
      });
      const guild = {
        id: 'guild', name: 'Test Server',
        roles: { cache: new Map([['role', { name: tier }]]) },
        members: { fetch: async () => {
          events.push('fetch');
          if (scenario === 'fetch failure') throw error;
          return member;
        } },
      };
      const member = {
        id: 'buyer', guild,
        roles: { cache: roleCache, add: async (roleId) => {
          assert.equal(roleId, 'role');
          events.push('add');
          if (scenario === 'role failure') throw error;
          roleCache.set(roleId, {});
        }, remove: async (roleId) => {
          assert.equal(roleId, 'role');
          events.push('remove');
          if (rollbackFailure) throw error;
          roleCache.delete(roleId);
        } },
        send: async ({ embeds }) => {
          events.push('dm');
          assert.ok(saved);
          const embed = embeds[0].toJSON();
          assert.equal(embed.title, '✅ Your Purchase Has Been Granted');
          assert.equal(embed.color, EMBED_COLORS.CONFIRMED);
          assert.equal(embed.footer.text, `${EMBED_FOOTER} • Purchases`);
          assert.ok(embed.timestamp);
          assert.ok(embed.description.includes('Recorded for manual payment; the bot does not take payment.'));
          if (scenario !== 'format failure') assert.equal(embed.fields[3].name, 'Amount to Pay');
          assert.deepEqual(Object.fromEntries(embed.fields.map(({ name, value }) => [name, value])), {
            Server: 'Test Server', 'Subscription Tier': tier,
            'Purchased Duration': `${duration} Month${duration > 1 ? 's' : ''}`,
            ...(scenario === 'format failure' ? {} : { 'Amount to Pay': `IDR ${amount}` }), Expires: `<t:${Math.floor(saved.expiresAt / 1000)}:F>`,
          });
          if (scenario === 'blocked DM') throw error;
        },
      };
      const interaction = {
        inCachedGuild: () => true,
        member: { permissions: { has: () => true } },
        customId: `buy_verify_buyer_role_${duration}`,
        user: { tag: 'Verifier' }, guild,
        message: { embeds: [{ title: 'Purchase', fields: [{ name: 'Amount to Pay', value: 'IDR 10000', inline: true }] }], components: [] },
        deferUpdate: async () => {},
        reply: async () => { events.push('failure reply'); },
        followUp: async (reply) => { assert.equal(reply.ephemeral, true); followUp = reply.content; events.push('failure reply'); },
        update: async () => { events.push('staff'); },
        editReply: async ({ embeds }) => {
          assert.deepEqual(embeds[0].toJSON().fields.find(field => field.name === 'Amount to Pay'), { name: 'Amount to Pay', value: 'IDR 10000', inline: true });
          events.push('staff');
        },
      };
      await grant(interaction);
      if (['success', 'blocked DM', 'format failure'].includes(scenario)) {
        assert.deepEqual(events, ['get', 'fetch', 'add', 'save', 'dm', 'staff']);
        assert.equal(saved.expiresAt, now + duration * month);
      } else {
        assert.ok(!events.includes('dm'));
        assert.ok(!events.includes('staff'));
      }
      if (scenario === 'read failure') assert.deepEqual(events, ['get', 'failure reply']);
      if (saveFailure) {
        assert.deepEqual(events, ['get', 'fetch', 'add', 'save', ...(hadRole ? [] : ['remove']), 'failure reply']);
        assert.equal(saved, undefined);
        assert.equal(roleCache.has('role'), hadRole || rollbackFailure);
        assert.match(followUp, /Failed to save the subscription/);
        if (hadRole) {
          assert.match(followUp, /already had this role.*left unchanged/);
          assert.doesNotMatch(followUp, /revoked/);
        } else if (rollbackFailure) {
          assert.match(followUp, /Failed to remove.*remove it manually/);
          assert.doesNotMatch(followUp, /revoked/);
        } else {
          assert.match(followUp, /newly granted role was revoked/);
        }
        assert.equal(logged.mock.calls[0].arguments[1], error);
        if (rollbackFailure) assert.equal(logged.mock.calls[1].arguments[1], error);
      }
      assert.equal(logged.mock.callCount(), rollbackFailure ? 2 : saveFailure || ['blocked DM', 'read failure', 'format failure'].includes(scenario) ? 1 : 0);
      if (scenario === 'format failure') assert.match(logged.mock.calls[0].arguments[0], /Failed to format purchase DM amount/);
      if (scenario === 'blocked DM') assert.equal(logged.mock.calls[0].arguments[1], error);
    });
  }
}
