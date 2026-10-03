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
import { announceApproval, announceSavedApproval } from '../dist/lib/approvalAnnouncement.js';
import { subscriptionStore } from '../dist/lib/subscriptionStore.js';

for (const kind of ['Buy', 'Renew', 'Refund', 'Upgrade', 'Downgrade']) test(kind + ' exact announcement without pings', async () => {
  const guild = { id: 'guild', channels: { fetch: async id => {
    assert.equal(id, 'origin');
    return { guild, isTextBased: () => true, send: async payload => {
      assert.equal(payload.embeds[0].data.description, `<@staff> has ${kind === 'Renew' ? 'approved' : 'verified'} this process (${kind})`);
      assert.deepEqual(payload.allowedMentions, { parse: [] });
    } };
  } } };
  await announceApproval(guild, 'origin', 'staff', kind);
});

for (const scenario of ['missing', 'fetch', 'null', 'voice', 'other guild', 'send']) test('announcement handles ' + scenario, async t => {
  const error = t.mock.method(console, 'error', () => {});
  const warning = t.mock.method(console, 'warn', () => {});
  let sends = 0, fetches = 0;
  const guild = { id: 'guild', channels: { fetch: async () => {
    fetches++;
    if (scenario === 'fetch') throw new Error('fetch');
    if (scenario === 'null') return null;
    return { guild: scenario === 'other guild' ? { id: 'other' } : guild, isTextBased: () => scenario !== 'voice', send: async () => { sends++; throw new Error('send'); } };
  } } };
  await announceApproval(guild, scenario === 'missing' ? undefined : 'origin', 'staff', 'Buy');
  assert.equal(sends, scenario === 'send' ? 1 : 0);
  assert.equal(fetches, scenario === 'missing' ? 0 : 1);
  assert.equal(warning.mock.callCount(), scenario === 'missing' ? 1 : 0);
  assert.equal(error.mock.callCount(), scenario === 'missing' ? 0 : 1);
});

test('send failure and replay never retry a claimed announcement', async t => {
  let announced = false, sends = 0;
  t.mock.method(console, 'error', () => {});
  t.mock.method(subscriptionStore, 'getApprovalOrigin', async () => ({ commandChannelId: 'origin', announced }));
  t.mock.method(subscriptionStore, 'markAnnounced', async () => { if (announced) return false; announced = true; return true; });
  const guild = { id: 'guild', channels: { fetch: async () => ({ guild, isTextBased: () => true, send: async () => { sends++; throw new Error('offline'); } }) } };
  await announceSavedApproval(guild, 'key', 'staff', 'Renew');
  await announceSavedApproval(guild, 'key', 'staff', 'Renew');
  assert.equal(sends, 1);
});

test('origin migration preserves data and claims atomically across reload', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'announcement-'));
  const original = process.cwd();
  t.after(async () => { process.chdir(original); await rm(directory, { recursive: true, force: true }); });
  process.chdir(directory);
  await mkdir('data');
  const prior = { version: 2, subscriptions: { guild: {} }, renewalApprovals: { renewal: { requestId: 'renewal' } }, refunds: { receipt: { refundId: 'receipt' } }, refundRequests: { refund: { commandChannelId: 'origin' }, legacy: {} } };
  await writeFile('data/subscriptions.json', JSON.stringify(prior));
  const { subscriptionStore: store } = await import('../dist/lib/subscriptionStore.js?announcement-storage');
  assert.equal(await store.markAnnounced('missing'), false);
  assert.equal(await store.markAnnounced('legacy'), false);
  await store.saveApprovalOrigin('guild:log:message', 'origin');
  assert.deepEqual(await Promise.all([store.markAnnounced('guild:log:message'), store.markAnnounced('guild:log:message')]), [true, false]);
  assert.equal(await store.markAnnounced('refund'), true);
  const { subscriptionStore: reload } = await import('../dist/lib/subscriptionStore.js?announcement-reload');
  assert.equal(await reload.markAnnounced('guild:log:message'), false);
  assert.equal(await reload.markAnnounced('refund'), false);
  const saved = JSON.parse(await readFile('data/subscriptions.json', 'utf8'));
  for (const key of ['subscriptions', 'renewalApprovals', 'refunds']) assert.deepEqual(saved[key], prior[key]);
});

test('missing legacy origin skips without claiming', async t => {
  const warning = t.mock.method(console, 'warn', () => {});
  t.mock.method(subscriptionStore, 'getApprovalOrigin', async () => undefined);
  t.mock.method(subscriptionStore, 'markAnnounced', async () => assert.fail('must not claim'));
  await announceSavedApproval({ channels: { fetch: async () => assert.fail('must not fetch') } }, 'legacy', 'staff', 'Buy');
  assert.equal(warning.mock.callCount(), 1);
});

test('claim failure does not propagate after approval', async t => {
  t.mock.method(subscriptionStore, 'getApprovalOrigin', async () => ({ commandChannelId: 'origin' }));
  t.mock.method(subscriptionStore, 'markAnnounced', async () => { throw new Error('offline'); });
  const error = t.mock.method(console, 'error', () => {});
  await announceSavedApproval({ channels: { fetch: async () => assert.fail('must not fetch') } }, 'key', 'staff', 'Buy');
  assert.equal(error.mock.callCount(), 1);
});
