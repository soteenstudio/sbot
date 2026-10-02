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
import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { RefundCommand } from '../dist/commands/RefundCommand.js';
import { subscriptionPrices, getSubscriptionPrice, calculateRefundDeduction, formatSubscriptionMoney } from '../dist/lib/subscriptionPrices.js';
import { notifyBuyerOfRefund } from '../dist/lib/refundNotification.js';

const currency = { code: 'USD', minorUnitDigits: 2 };

test('catalogue configures testing-only IDR prices for every tier and duration', () => {
  assert.deepEqual(subscriptionPrices.currency, { code: 'IDR', minorUnitDigits: 0 });
  const prices = {
    DONATUR: { 1: 10_000, 6: 60_000, 12: 120_000 },
    BILLION: { 1: 25_000, 6: 150_000, 12: 300_000 },
    RICHMAN: { 1: 50_000, 6: 300_000, 12: 600_000 },
  };
  assert.deepEqual(subscriptionPrices.prices, prices);
  for (const [tier, durations] of Object.entries(prices)) {
    for (const [duration, amount] of Object.entries(durations)) {
      assert.equal(getSubscriptionPrice(tier, Number(duration)), amount);
    }
  }
});

test('catalogue rejects unsupported and unconfigured prices without defaults', t => {
  const originalCurrency = subscriptionPrices.currency;
  const originalPrice = subscriptionPrices.prices.DONATUR[1];
  t.after(() => {
    subscriptionPrices.currency = originalCurrency;
    subscriptionPrices.prices.DONATUR[1] = originalPrice;
  });
  assert.throws(() => getSubscriptionPrice('OTHER', 1), /Unsupported/);
  assert.throws(() => getSubscriptionPrice('DONATUR', 2), /Unsupported/);
  subscriptionPrices.currency = undefined;
  assert.throws(() => getSubscriptionPrice('DONATUR', 1), /currency is unconfigured/);
  subscriptionPrices.currency = originalCurrency;
  subscriptionPrices.prices.DONATUR[1] = undefined;
  assert.throws(() => getSubscriptionPrice('DONATUR', 1), /price is unconfigured/);
  for (const invalid of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    subscriptionPrices.prices.DONATUR[1] = invalid;
    assert.throws(() => getSubscriptionPrice('DONATUR', 1), /positive safe integer/);
  }
  subscriptionPrices.prices.DONATUR[1] = 123;
  assert.equal(getSubscriptionPrice('DONATUR', 1), 123);
});

test('whole-rupiah refund deducts 500 from a gross amount of 10_000', () => {
  const amounts = calculateRefundDeduction(10_000);
  assert.deepEqual(amounts, { gross: 10_000, tax: 500, net: 9_500 });
  assert.equal(formatSubscriptionMoney(amounts.gross, subscriptionPrices.currency), 'IDR 10000');
  assert.equal(formatSubscriptionMoney(amounts.tax, subscriptionPrices.currency), 'IDR 500');
  assert.equal(formatSubscriptionMoney(amounts.net, subscriptionPrices.currency), 'IDR 9500');
  assert.equal(formatSubscriptionMoney(0, subscriptionPrices.currency), 'IDR 0');
});

test('5% deduction rounds half up using exact integer arithmetic', () => {
  for (const [gross, tax] of [[1, 0], [9, 0], [10, 1], [11, 1], [29, 1], [30, 2], [100, 5], [Number.MAX_SAFE_INTEGER, 450359962737050]]) {
    assert.deepEqual(calculateRefundDeduction(gross), { gross, tax, net: gross - tax });
  }
  for (const invalid of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => calculateRefundDeduction(invalid), /positive safe integer/);
});

test('currency formatting preserves minor units and validates configuration', () => {
  assert.equal(formatSubscriptionMoney(123, currency), 'USD 1.23');
  assert.equal(formatSubscriptionMoney(0, currency), 'USD 0.00');
  assert.equal(formatSubscriptionMoney(123, { code: 'JPY', minorUnitDigits: 0 }), 'JPY 123');
  assert.equal(formatSubscriptionMoney(Number.MAX_SAFE_INTEGER, currency), 'USD 90071992547409.91');
  for (const invalid of [{ code: '', minorUnitDigits: 2 }, { code: 'USD', minorUnitDigits: -1 }, { code: 'USD', minorUnitDigits: 1.5 }])
    assert.throws(() => formatSubscriptionMoney(123, invalid), /Invalid currency/);
  assert.throws(() => formatSubscriptionMoney(-1, currency), /nonnegative/);
});

test('refund registration requires administrator permission and a guild', () => {
  let data;
  RefundCommand.prototype.registerApplicationCommands.call({ name: 'refund', description: 'Refund' }, {
    registerChatInputCommand(callback) { data = callback(new SlashCommandBuilder()).toJSON(); },
  });
  assert.equal(data.dm_permission, false);
  assert.equal(data.default_member_permissions, String(PermissionFlagsBits.Administrator));
  assert.equal(data.options[0].name, 'buyer');
  assert.equal(data.options[0].required, true);
});

for (const scenario of ['DM', 'unauthorized', 'unconfigured']) {
  test(`refund rejects ${scenario} with ephemeral acknowledgement`, async () => {
    const events = [];
    const interaction = {
      inCachedGuild: () => scenario !== 'DM',
      member: { permissions: { has(permission) { assert.equal(permission, PermissionFlagsBits.Administrator); return scenario !== 'unauthorized'; } } },
      reply: async reply => { assert.equal(reply.flags, MessageFlags.Ephemeral); events.push('reply'); },
      deferReply: async reply => { assert.equal(reply.flags, MessageFlags.Ephemeral); events.push('defer'); },
      editReply: async reply => { assert.match(reply.content, /No refund was recorded or subscription changed/); events.push('edit'); },
    };
    await RefundCommand.prototype.chatInputRun(interaction);
    assert.deepEqual(events, scenario === 'unconfigured' ? ['defer', 'edit'] : ['reply']);
    if (scenario === 'unconfigured') {
      await Promise.all([RefundCommand.prototype.chatInputRun(interaction), RefundCommand.prototype.chatInputRun(interaction)]);
      assert.equal(events.filter(event => event === 'edit').length, 3);
    }
  });
}

for (const blocked of [false, true]) {
  test(`refund notification breakdown${blocked ? ' with blocked DM' : ''}`, async t => {
    const logged = t.mock.method(console, 'error', () => {});
    let sent = 0;
    const member = {
      id: 'buyer', guild: { name: 'Test Server', roles: { cache: new Map([['tier', { name: 'Donatur' }]]) } },
      send: async ({ embeds }) => {
        sent++;
        const embed = embeds[0].toJSON();
        assert.match(embed.description, /The 5% deduction does not include inter-bank transfer fees\./);
        assert.deepEqual(Object.fromEntries(embed.fields.map(field => [field.name, field.value])), {
          Server: 'Test Server', 'Subscription Tier': 'Donatur', 'Gross Refund': 'USD 1.00', '5% Deduction': 'USD 0.05', 'Net Refund': 'USD 0.95',
        });
        if (blocked) throw new Error('DM blocked');
      },
    };
    await notifyBuyerOfRefund(member, { roleId: 'tier', gross: 100, currency });
    assert.equal(sent, 1);
    assert.equal(logged.mock.callCount(), blocked ? 1 : 0);
    await assert.rejects(notifyBuyerOfRefund(member, { roleId: 'tier', gross: 0, currency }), /positive/);
    assert.equal(sent, 1);
  });
}
