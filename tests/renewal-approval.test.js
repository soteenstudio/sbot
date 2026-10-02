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
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RenewApproveHandler } from '../dist/interaction-handlers/RenewApproveHandler.js';
import { BuyVerifyHandler } from '../dist/interaction-handlers/BuyVerifyHandler.js';

test('renewal buttons have a distinct Sapphire handler prefix', () => {
  const context = { some: () => true, none: () => false };
  for (const [id, renewal, purchase] of [
    ['renew_approve_111111111111111111_222222222222222222_1', true, false],
    ['buy_verify_111111111111111111_222222222222222222_1', false, true],
    ['other', false, false],
  ]) {
    assert.equal(RenewApproveHandler.prototype.parse.call(context, { customId: id }), renewal);
    assert.equal(BuyVerifyHandler.prototype.parse.call(context, { customId: id }), purchase);
  }
});

test('renewal receipt is atomic, survives reload, purchase replacement and deletion', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'renewal-approval-'));
  const original = process.cwd();
  t.after(async () => { process.chdir(original); await rm(directory, { recursive: true, force: true }); });
  process.chdir(directory);
  await mkdir('data');
  const record = { guildId: 'guild', userId: 'buyer', roleId: 'tier', durationMonths: 1, expiresAt: 1800000000000 };
  // Existing unversioned files remain readable and migrate on the next write.
  await writeFile('data/subscriptions.json', JSON.stringify({ guild: { buyer: record } }));
  const { subscriptionStore: store } = await import('../dist/lib/subscriptionStore.js?approval-storage');
  assert.deepEqual(await store.get('guild', 'buyer'), record);
  const approval = { ...record, requestId: 'request', approvedAt: 1700000000000, approvedBy: 'Admin' };
  await store.saveRenewalApproval(record, approval);
  const saved = JSON.parse(await readFile('data/subscriptions.json', 'utf8'));
  assert.deepEqual(saved.subscriptions.guild.buyer, record);
  assert.deepEqual(saved.renewalApprovals.request, approval);
  const { subscriptionStore: reloaded } = await import('../dist/lib/subscriptionStore.js?approval-reload');
  assert.deepEqual(await reloaded.getRenewalApproval('request'), approval);
  await assert.rejects(reloaded.saveRenewalApproval({ ...record, expiresAt: record.expiresAt + 1 }, approval), /already approved/);
  assert.deepEqual(await reloaded.get('guild', 'buyer'), record);
  await reloaded.set({ ...record, roleId: 'new tier' });
  await reloaded.delete('guild', 'buyer');
  assert.deepEqual(await reloaded.getAll(), []);
  assert.deepEqual(await reloaded.getRenewalApproval('request'), approval);
  await writeFile('data/subscriptions.json', '{broken');
  await assert.rejects(reloaded.saveRenewalApproval(record, { ...approval, requestId: 'new' }), SyntaxError);
  assert.equal(await readFile('data/subscriptions.json', 'utf8'), '{broken');
});
