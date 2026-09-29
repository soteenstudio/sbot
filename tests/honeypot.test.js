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
import { afterEach, beforeEach, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SapphireClient } from '@sapphire/framework';
import { ChannelType, MessageFlags } from 'discord.js';
import { GatewayIntentBits } from 'discord.js';
import { HoneypotListener, pendingHoneypotBans, restoreHoneypotBans, scheduleHoneypotBan } from '../dist/listeners/HoneypotListener.js';
import { HoneypotSetupListener } from '../dist/listeners/HoneypotSetupListener.js';
import { HoneypotAppealHandler } from '../dist/interaction-handlers/HoneypotAppealHandler.js';
import { HoneypotAppealButtonHandler } from '../dist/interaction-handlers/HoneypotAppealButtonHandler.js';
import { getAllHoneypotRecords, getHoneypotRecord, updateHoneypotRecord } from '../dist/lib/honeypotStore.js';
import { HONEYPOT_APPEAL_TITLE, LEGACY_HONEYPOT_APPEAL_TITLE } from '../dist/lib/honeypotAppeal.js';
import { Roles } from '../dist/config.js';

let directory;
const original = { HONEYPOT_DATA_FILE: process.env.HONEYPOT_DATA_FILE, HONEYPOT_CHANNEL: process.env.HONEYPOT_CHANNEL, REPORT_CHANNEL: process.env.REPORT_CHANNEL };
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sbot-honeypot-'));
  process.env.HONEYPOT_DATA_FILE = join(directory, 'honeypot.json');
  process.env.HONEYPOT_CHANNEL = 'trap';
  process.env.REPORT_CHANNEL = 'reports';
});
afterEach(async () => {
  for (const timer of pendingHoneypotBans.values()) clearTimeout(timer);
  pendingHoneypotBans.clear();
  await rm(directory, { recursive: true, force: true });
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

function record(overrides = {}) {
  return { guildId: 'guild', userId: 'user', deadline: Date.now() + 60_000, token: randomUUID(), status: 'pending', challenge: null, ...overrides };
}
async function save(value = record()) {
  await updateHoneypotRecord(value.guildId, value.userId, () => [value, undefined]);
  return value;
}
function client(ban) {
  return { guilds: { async fetch() { return { members: { ban }, channels: { async fetch() { return { type: ChannelType.GuildText, send: async () => {} }; } } }; } }, users: { async fetch() { return { tag: 'User', send: async () => {} }; } } };
}
function trap(botClient = client(async () => {})) {
  return { channelId: 'trap', guild: { id: 'guild', name: 'Guild' }, client: botClient,
    member: { bannable: true, roles: { cache: new Map() }, async timeout() {} },
    author: { id: 'user', tag: 'User', bot: false, async send() {} }, async delete() {} };
}
function modal(botClient = client(async () => {})) {
  const events = [];
  const interaction = { customId: 'honeypot_modal_submit_user_guild', user: { id: 'user' },
    fields: { getTextInputValue: (id) => id === 'captcha_math' ? '2' : 'ABC123' },
    client: botClient, deferred: false, replied: false,
    message: { async edit(payload) { events.push(['dm.edit', payload]); } },
    async deferReply(payload) { this.deferred = true; events.push(['defer', payload]); },
    async editReply(payload) { events.push(['edit', payload]); },
    async reply(payload) { this.replied = true; events.push(['reply', payload]); },
    async followUp(payload) { events.push(['followUp', payload]); } };
  return { interaction, events };
}
async function challenged(overrides = {}) {
  return save(record({ challenge: { answer: 2, stringCode: 'ABC123', openedAt: Date.now() - 4_000, expiresAt: Date.now() + 60_000 }, ...overrides }));
}

test('store validates guild/user keys and record fields', async () => {
  await save();
  await save(record({ guildId: 'other' }));
  assert.equal((await getAllHoneypotRecords()).length, 2);
  assert.equal((await getHoneypotRecord('other', 'user')).guildId, 'other');
  assert.equal((await getHoneypotRecord('guild', 'user')).guildId, 'guild');
  const raw = JSON.parse(await readFile(process.env.HONEYPOT_DATA_FILE, 'utf8'));
  raw.guild.user.deadline = 'tomorrow';
  await writeFile(process.env.HONEYPOT_DATA_FILE, JSON.stringify(raw));
  await assert.rejects(getAllHoneypotRecords(), /Invalid honeypot storage/);
});

test('restart restores an overdue deadline and records a successful ban', async () => {
  await save(record({ deadline: Date.now() - 1000 }));
  let bans = 0;
  await restoreHoneypotBans(client(async () => { bans++; }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(bans, 1);
  assert.equal((await getHoneypotRecord('guild', 'user')).status, 'banned');
  assert.equal((await getHoneypotRecord('guild', 'user')).deadline, null);
});

test('failed overdue ban retains the deadline for restart recovery', async (t) => {
  t.mock.method(console, 'error', () => {});
  const old = await save(record({ deadline: Date.now() - 1000 }));
  await restoreHoneypotBans(client(async () => { throw new Error('Ban failed'); }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(await getHoneypotRecord('guild', 'user'), old);
  let bans = 0;
  await restoreHoneypotBans(client(async () => { bans++; }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(bans, 1);
});

test('replaced deadline makes an old timer inert, even after restart', async () => {
  const old = await save(record({ deadline: Date.now() - 1000 }));
  let bans = 0;
  const botClient = client(async () => { bans++; });
  const newer = record({ deadline: Date.now() + 60_000 });
  await save(newer);
  scheduleHoneypotBan(botClient, old);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(bans, 0);
  assert.deepEqual(await getHoneypotRecord('guild', 'user'), newer);
  await restoreHoneypotBans(botClient);
  assert.equal(pendingHoneypotBans.has('guild:user'), true);
});

test('trap messages replace a pending deadline and do not reopen completed appeals', async (t) => {
  t.mock.method(console, 'log', () => {});
  const message = trap();
  await HoneypotListener.prototype.run(message);
  const first = await getHoneypotRecord('guild', 'user');
  await HoneypotListener.prototype.run(message);
  const second = await getHoneypotRecord('guild', 'user');
  assert.notEqual(first.token, second.token);
  await save(record({ status: 'approved', deadline: null }));
  await HoneypotListener.prototype.run(message);
  assert.equal((await getHoneypotRecord('guild', 'user')).status, 'approved');
});

test('honeypot ignores members that cannot be banned', async () => {
  const message = trap();
  message.member.bannable = false;
  message.delete = async () => assert.fail('The message should not be deleted');
  await HoneypotListener.prototype.run(message);
  assert.equal(await getHoneypotRecord('guild', 'user'), null);
});

test('closed DMs do not prevent a durable ban deadline', async (t) => {
  t.mock.method(console, 'log', () => {});
  const message = trap();
  message.author.send = async () => { throw new Error('DM closed'); };
  await HoneypotListener.prototype.run(message);
  assert.equal((await getHoneypotRecord('guild', 'user')).status, 'pending');
  assert.equal(pendingHoneypotBans.has('guild:user'), true);
});

test('honeypot setup does not post a duplicate warning when lookup fails', async (t) => {
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args));
  await HoneypotSetupListener.prototype.run({
    user: { id: 'bot' }, channels: { async fetch() { return {
      type: ChannelType.GuildText,
      messages: { async fetch() { throw new Error('lookup failed'); } },
      async send() { assert.fail('The warning should not be posted'); },
    }; } },
  });
  assert.match(errors[0][0], /Could not check or post/);
});

test('expired challenge is rejected and removed from durable storage', async () => {
  await challenged({ challenge: { answer: 2, stringCode: 'ABC123', openedAt: Date.now() - 20_000, expiresAt: Date.now() - 10_000 } });
  const { interaction, events } = modal();
  await HoneypotAppealHandler.prototype.run(interaction);
  assert.match(events.at(-1)[1].content, /expired/);
  assert.equal((await getHoneypotRecord('guild', 'user')).challenge, null);
  assert.equal((await getHoneypotRecord('guild', 'user')).status, 'pending');
});

test('button creates a durable challenge and only the affected user can open it', async () => {
  await save();
  const shown = [];
  const interaction = { customId: 'honeypot_appeal_user_guild', user: { id: 'user' }, async showModal(value) { shown.push(value.toJSON()); } };
  await HoneypotAppealButtonHandler.prototype.run(interaction);
  assert.equal(shown.length, 1);
  assert.ok((await getHoneypotRecord('guild', 'user')).challenge);
  const denied = [];
  await HoneypotAppealButtonHandler.prototype.run({ ...interaction, user: { id: 'other' }, async reply(value) { denied.push(value); } });
  assert.equal(denied[0].flags, MessageFlags.Ephemeral);
});

test('successful delivery cancels the stored ban and duplicate submissions after restart', async () => {
  const old = await challenged();
  const calls = [];
  const botClient = client(async () => {});
  botClient.guilds.fetch = async () => ({ channels: { async fetch() { return { type: ChannelType.GuildText, async send() { calls.push('send'); } }; } } });
  scheduleHoneypotBan(botClient, old);
  const first = modal(botClient);
  await HoneypotAppealHandler.prototype.run(first.interaction);
  assert.deepEqual(calls, ['send']);
  assert.equal((await getHoneypotRecord('guild', 'user')).status, 'submitted');
  assert.equal((await getHoneypotRecord('guild', 'user')).deadline, null);
  assert.equal(pendingHoneypotBans.has('guild:user'), false);
  const second = modal(botClient);
  await HoneypotAppealHandler.prototype.run(second.interaction);
  assert.deepEqual(calls, ['send']);
  assert.match(second.events.at(-1)[1].content, /already been submitted/);
});

test('failed delivery keeps the challenge and deadline available for retry', async (t) => {
  t.mock.method(console, 'error', () => {});
  await challenged();
  let fail = true;
  let sends = 0;
  const botClient = client(async () => {});
  botClient.guilds.fetch = async () => ({ channels: { async fetch() { return { type: ChannelType.GuildText, async send() { sends++; if (fail) throw new Error('send failed'); } }; } } });
  await HoneypotAppealHandler.prototype.run(modal(botClient).interaction);
  const pending = await getHoneypotRecord('guild', 'user');
  assert.equal(pending.status, 'pending');
  assert.ok(pending.deadline);
  assert.ok(pending.challenge);
  fail = false;
  await HoneypotAppealHandler.prototype.run(modal(botClient).interaction);
  assert.equal(sends, 2);
  assert.equal((await getHoneypotRecord('guild', 'user')).status, 'submitted');
});

test('concurrent submissions deliver once through the storage lock', async () => {
  await challenged();
  let sends = 0;
  let release;
  const pause = new Promise((resolve) => { release = resolve; });
  const botClient = client(async () => {});
  botClient.guilds.fetch = async () => ({ channels: { async fetch() { return { type: ChannelType.GuildText, async send() { sends++; await pause; } }; } } });
  const first = HoneypotAppealHandler.prototype.run(modal(botClient).interaction);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = HoneypotAppealHandler.prototype.run(modal(botClient).interaction);
  release();
  await Promise.all([first, second]);
  assert.equal(sends, 1);
});

test('completed staff review remains completed after restart and duplicate clicks', async () => {
  await save(record({ status: 'submitted', deadline: null }));
  const deputyId = Roles.DEPUTY.id;
  Roles.DEPUTY.id = 'deputy';
  try {
    let approvals = 0;
    const edits = [];
    const followUps = [];
    const botClient = client(async () => {});
    botClient.guilds.fetch = async () => ({ members: { async fetch() { return { async timeout() { approvals++; }, roles: { async add() {} } }; } } });
    const interaction = { customId: 'report_done_user', guildId: 'guild', member: { roles: ['deputy'] }, user: { id: 'staff', tag: 'Staff' }, client: botClient,
      message: { embeds: [{ title: HONEYPOT_APPEAL_TITLE }], async edit(value) { edits.push(value); } }, async deferUpdate() {},
      async followUp(value) { followUps.push(value); } };
    await HoneypotAppealButtonHandler.prototype.run(interaction);
    assert.equal(approvals, 1);
    assert.equal((await getHoneypotRecord('guild', 'user')).status, 'approved');
    assert.equal(edits.length, 1);
    await HoneypotAppealButtonHandler.prototype.run(interaction);
    assert.equal(approvals, 1);
    assert.equal(edits.length, 1);
    assert.match(followUps[0].content, /already been reviewed/);
    assert.equal(followUps[0].flags, MessageFlags.Ephemeral);
  } finally { Roles.DEPUTY.id = deputyId; }
});

test('legacy appeal titles still route to staff handler', () => {
  const handler = { some: () => true, none: () => false };
  for (const title of [HONEYPOT_APPEAL_TITLE, LEGACY_HONEYPOT_APPEAL_TITLE]) {
    assert.equal(HoneypotAppealButtonHandler.prototype.parse.call(handler, { customId: 'report_done_user', message: { embeds: [{ title }] } }), true);
  }
});

test('Sapphire loads both appeal interaction handlers', async (t) => {
  const sapphire = new SapphireClient({
    intents: [GatewayIntentBits.Guilds],
    baseUserDirectory: join(process.cwd(), 'dist'),
  });
  t.after(() => sapphire.destroy());
  sapphire.stores.registerPath(sapphire.options.baseUserDirectory);
  await sapphire.stores.get('interaction-handlers').loadAll();
  const handlers = sapphire.stores.get('interaction-handlers');
  assert.ok(handlers.get('HoneypotAppealHandler'));
  assert.ok(handlers.get('HoneypotAppealButtonHandler'));
});

test('unauthorized staff cannot review an appeal', async () => {
  await save(record({ status: 'submitted', deadline: null }));
  const replies = [];
  await HoneypotAppealButtonHandler.prototype.run({
    customId: 'report_ban_user', member: null,
    async reply(value) { replies.push(value); },
    async deferUpdate() { assert.fail('Unauthorized review was acknowledged as staff'); },
  });
  assert.equal(replies[0].flags, MessageFlags.Ephemeral);
  assert.equal((await getHoneypotRecord('guild', 'user')).status, 'submitted');
});

test('rejected staff review persists and cannot ban twice', async () => {
  await save(record({ status: 'submitted', deadline: null }));
  const deputyId = Roles.DEPUTY.id;
  Roles.DEPUTY.id = 'deputy';
  try {
    let bans = 0;
    const interaction = {
      customId: 'report_ban_user', guildId: 'guild', member: { roles: ['deputy'] },
      user: { id: 'staff', tag: 'Staff' },
      client: client(async () => { bans++; }),
      message: { embeds: [{ title: HONEYPOT_APPEAL_TITLE }], async edit() {} },
      async deferUpdate() {},
      async followUp() {},
    };
    await HoneypotAppealButtonHandler.prototype.run(interaction);
    await HoneypotAppealButtonHandler.prototype.run(interaction);
    assert.equal(bans, 1);
    assert.equal((await getHoneypotRecord('guild', 'user')).status, 'rejected');
  } finally { Roles.DEPUTY.id = deputyId; }
});
