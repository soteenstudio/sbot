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
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { ButtonStyle, ChannelType, ComponentType, EmbedBuilder, PermissionOverwrites, PermissionsBitField } from 'discord.js';
import { PartyCommand } from '../dist/commands/PartyCommand.js';
import { LFGCommand } from '../dist/commands/LFGProCommand.js';
import { LFGProRequestHandler as RequestHandler } from '../dist/interaction-handlers/LFGProRequestHandler.js';
import { LFGProEndSessionHandler as EndSessionHandler } from '../dist/interaction-handlers/LFGProEndSession.js';
import { LFGProJoinButtonHandler as JoinButtonHandler } from '../dist/interaction-handlers/LFGProJoinButtonHandler.js';
import { activeParties } from '../dist/lib/partyData.js';
import { activeLFG, declineCooldownRemaining, formatLFGCooldown, pendingLFGInitialSaves, pendingRequestCooldownRemaining } from '../dist/lib/lfgData.js';
import {
  getLFGSession,
  restoreLFGSessions,
  saveLFGSession,
} from '../dist/lib/lfgSession.js';

const hostId = '123456789012345678';
const participantId = '234567890123456789';
const outsiderId = '345678901234567890';
const guildId = '456789012345678901';
const voiceId = '567890123456789012';
const originId = '678901234567890123';

const storageDirectory = await mkdtemp(join(tmpdir(), 'lfg-session-test-'));
process.env.LFG_DATA_FILE = join(storageDirectory, 'sessions.json');
after(() => rm(storageDirectory, { recursive: true, force: true }));

beforeEach(async () => {
  activeParties.clear();
  activeLFG.clear();
  await rm(process.env.LFG_DATA_FILE, { force: true });
});

function voiceChannel(connected = true) {
  const edits = [];
  const sends = [];
  let disconnects = 0;
  let deletes = 0;
  const member = {
    id: participantId,
    user: { bot: false, async send() {} },
    voice: {
      channelId: connected ? voiceId : null,
      async disconnect() {
        disconnects++;
        this.channelId = null;
      },
    },
  };
  return {
    id: voiceId,
    type: ChannelType.GuildVoice,
    guild: { id: guildId },
    members: new Map([[participantId, member]]),
    member,
    edits,
    sends,
    get disconnects() {
      return disconnects;
    },
    get deletes() {
      return deletes;
    },
    permissionOverwrites: {
      cache: new Map(),
      deleted: [],
      async edit(id, permissions) {
        edits.push([id, permissions]);
        const resolved = PermissionOverwrites.resolveOverwriteOptions(permissions, this.cache.get(id));
        this.cache.set(id, {
          allow: new PermissionsBitField(resolved.allow),
          deny: new PermissionsBitField(resolved.deny),
        });
      },
      async delete(id) {
        this.deleted.push(id);
        this.cache.delete(id);
      },
    },
    async delete() {
      deletes++;
    },
    async send(value) { sends.push(value); },
    toString() {
      return `<#${voiceId}>`;
    },
  };
}

let requestNumber = 0;
function requestMessage(session, joinerId = participantId) {
  const accept = `lfg_pro_accept_${joinerId}_${session.channelId}_${session.messageId}_${hostId}`;
  const decline = `lfg_pro_decline_${joinerId}_${session.channelId}_${session.messageId}_${hostId}`;
  const message = {
    id: `request-${++requestNumber}`,
    components: [{ type: ComponentType.ActionRow, components: [
      { type: ComponentType.Button, custom_id: accept, label: 'Accept Request', style: ButtonStyle.Success, disabled: false },
      { type: ComponentType.Button, custom_id: decline, label: 'Decline Request', style: ButtonStyle.Danger, disabled: false },
    ] }],
    edits: [],
    async edit(value) { this.edits.push(value); this.components = value.components.map((row) => row.toJSON()); },
  };
  return message;
}

function decisionInteraction(session, action, message, client, joinerId = participantId) {
  return {
    customId: `lfg_pro_${action}_${joinerId}_${session.channelId}_${session.messageId}_${hostId}`,
    user: { id: hostId }, message, client,
    async update(value) { message.components = value.components.map((row) => row.toJSON()); return value; },
    async followUp(value) { return value; },
    async reply(value) { return value; },
  };
}

function joinInteraction(session, client, joinerId = participantId) {
  return {
    customId: `lfg_pro_join_${hostId}`,
    user: { id: joinerId, toString: () => `<@${joinerId}>`, displayAvatarURL: () => 'https://example.com/avatar.png' },
    message: { id: session.messageId }, client,
    async deferUpdate() {}, async followUp(value) { return value; },
  };
}

function kickInteraction(userId, targetId, guild) {
  return {
    user: { id: userId },
    guild,
    options: { getUser: () => ({ id: targetId, bot: false, async send() {} }) },
    async reply(value) {
      return value;
    },
    async deferReply(value) {
      assert.equal(value.ephemeral, true);
    },
    async editReply(value) {
      return { ...value, ephemeral: true };
    },
  };
}

test('party host kicks a current participant and denies access to this channel', async () => {
  const channel = voiceChannel();
  activeParties.set(voiceId, { hostId, gameKey: 'minecraft' });
  const guild = { id: guildId, channels: { fetch: async () => channel } };
  const reply = await PartyCommand.prototype.kick.call(
    {},
    kickInteraction(hostId, participantId, guild),
  );
  assert.match(reply.content, /has been removed/);
  assert.equal(reply.ephemeral, true);
  assert.deepEqual(channel.edits, [
    [participantId, { ViewChannel: false, Connect: false }],
  ]);
  assert.equal(channel.disconnects, 1);
  assert.ok(activeParties.has(voiceId));
});

test('party rejects non-hosts, outsiders, and self-kicks', async () => {
  const channel = voiceChannel();
  activeParties.set(voiceId, { hostId, gameKey: 'minecraft' });
  const guild = { id: guildId, channels: { fetch: async () => channel } };
  for (const [userId, targetId] of [
    [outsiderId, participantId],
    [hostId, outsiderId],
    [hostId, hostId],
  ]) {
    const reply = await PartyCommand.prototype.kick.call(
      {},
      kickInteraction(userId, targetId, guild),
    );
    assert.equal(reply.ephemeral, true);
    assert.match(reply.content, /❌/);
  }
  assert.equal(channel.edits.length, 0);
  assert.equal(channel.disconnects, 0);
});

test('party retains its kick overwrite only until the channel is closed', async () => {
  const channel = voiceChannel();
  activeParties.set(voiceId, { hostId, gameKey: 'minecraft' });
  const guild = { id: guildId, channels: { fetch: async () => channel } };
  await PartyCommand.prototype.kick.call(
    {},
    kickInteraction(hostId, participantId, guild),
  );
  await PartyCommand.prototype.close.call({}, kickInteraction(hostId, participantId, guild));
  assert.equal(channel.deletes, 1);
  assert.equal(activeParties.has(voiceId), false);
});

function lfgSession(participants = [participantId]) {
  return {
    game: 'Minecraft',
    rank: 'Gold',
    maxPlayers: 4,
    author: 'host',
    authorId: hostId,
    channelId: originId,
    messageId: '789012345678901234',
    vcId: voiceId,
    participantIds: new Set(participants),
    kickedIds: new Set(),
  };
}

test('LFG host kicks an accepted participant, including when disconnected', async () => {
  const session = lfgSession();
  activeLFG.set(hostId, session);
  const channel = voiceChannel(false);
  const guild = {
    id: guildId,
    channels: { fetch: async () => channel },
    members: { fetch: async () => channel.member },
  };
  const interaction = kickInteraction(hostId, participantId, guild);
  interaction.client = { channels: { fetch: async () => null } };
  const reply = await LFGCommand.prototype.kick.call(
    {},
    interaction,
  );
  assert.match(reply.content, /has been removed/);
  assert.deepEqual(channel.edits, [
    [participantId, { ViewChannel: false, Connect: false }],
  ]);
  assert.equal(channel.disconnects, 0);
  assert.equal(session.participantIds.has(participantId), false);
  assert.equal(session.kickedIds.has(participantId), true);
  assert.deepEqual((await getLFGSession(hostId)).participantIds, []);
  assert.deepEqual((await getLFGSession(hostId)).kickedIds, [participantId]);
});

test('LFG host kicks an accepted participant before a voice channel exists', async () => {
  const session = lfgSession();
  session.vcId = '';
  activeLFG.set(hostId, session);
  const interaction = kickInteraction(hostId, participantId, null);
  interaction.client = { channels: { fetch: async () => null } };
  const reply = await LFGCommand.prototype.kick(interaction);
  assert.match(reply.content, /has been removed/);
  assert.equal(session.participantIds.has(participantId), false);
  assert.equal(session.kickedIds.has(participantId), true);
  assert.deepEqual((await getLFGSession(hostId)).kickedIds, [participantId]);
});

test('LFG kick sends removal DM only after the session change is saved', async () => {
  const session = lfgSession();
  session.vcId = '';
  activeLFG.set(hostId, session);
  const interaction = kickInteraction(hostId, participantId, null);
  interaction.client = { channels: { fetch: async () => null } };
  let dm;
  interaction.options.getUser = () => ({
    id: participantId, bot: false,
    async send(content) {
      assert.deepEqual((await getLFGSession(hostId)).kickedIds, [participantId]);
      dm = content;
    },
  });
  const reply = await LFGCommand.prototype.kick(interaction);
  assert.match(reply.content, /has been removed/);
  assert.match(dm, /removed from.*Minecraft.*Gold/);
});

test('LFG kick remains saved when the removal DM is disabled', async () => {
  const session = lfgSession();
  session.vcId = '';
  activeLFG.set(hostId, session);
  const interaction = kickInteraction(hostId, participantId, null);
  interaction.client = { channels: { fetch: async () => null } };
  interaction.options.getUser = () => ({ id: participantId, bot: false, async send() { throw new Error('DM disabled'); } });
  const reply = await LFGCommand.prototype.kick(interaction);
  assert.match(reply.content, /removed.*could not be notified by DM/);
  assert.deepEqual((await getLFGSession(hostId)).kickedIds, [participantId]);
});

test('LFG connected participant is disconnected, and unauthorized targets are rejected', async () => {
  const session = lfgSession();
  activeLFG.set(hostId, session);
  const channel = voiceChannel();
  const guild = {
    id: guildId,
    channels: { fetch: async () => channel },
    members: { fetch: async () => channel.member },
  };
  for (const [userId, targetId] of [
    [outsiderId, participantId],
    [hostId, outsiderId],
    [hostId, hostId],
  ]) {
    const reply = await LFGCommand.prototype.kick.call(
      {},
      kickInteraction(userId, targetId, guild),
    );
    assert.match(reply.content, /❌/);
  }
  assert.equal(channel.edits.length, 0);
  const interaction = kickInteraction(hostId, participantId, guild);
  interaction.client = { channels: { fetch: async () => null } };
  await LFGCommand.prototype.kick.call({}, interaction);
  assert.equal(channel.disconnects, 1);
});

test('LFG kick updates the player count and reopens a full session', async () => {
  const session = lfgSession();
  session.maxPlayers = 2;
  activeLFG.set(hostId, session);
  const channel = voiceChannel();
  let edit;
  const message = {
    embeds: [new EmbedBuilder().setDescription('**Game:** 3/4 Quest\n**Required rank:** 1/2 Gold\n**Players:** 2/2')],
    async edit(value) {
      edit = value;
    },
  };
  const interaction = kickInteraction(hostId, participantId, {
    id: guildId,
    channels: { fetch: async () => channel },
    members: { fetch: async () => channel.member },
  });
  interaction.client = {
    channels: {
      fetch: async () => ({
        isTextBased: () => true,
        messages: { fetch: async () => message },
      }),
    },
  };
  await LFGCommand.prototype.kick.call({}, interaction);
  assert.equal(edit.embeds[0].data.description, '**Game:** 3/4 Quest\n**Required rank:** 1/2 Gold\n**Players:** 1/2');
  assert.equal(edit.components[0].components[0].data.custom_id, `lfg_pro_join_${hostId}`);
});

test('LFG failed permission edit leaves participant eligible for retry', async (t) => {
  t.mock.method(console, 'error', () => {});
  const session = lfgSession();
  activeLFG.set(hostId, session);
  const channel = voiceChannel();
  channel.permissionOverwrites.edit = async () => {
    throw new Error('Missing permissions');
  };
  const guild = {
    id: guildId,
    channels: { fetch: async () => channel },
    members: { fetch: async () => channel.member },
  };
  const reply = await LFGCommand.prototype.kick.call(
    {},
    kickInteraction(hostId, participantId, guild),
  );
  assert.match(reply.content, /Could not remove/);
  assert.equal(channel.disconnects, 0);
  assert.equal(session.participantIds.has(participantId), true);
  assert.equal(session.kickedIds.size, 0);
});

test('LFG acceptance tracks participants and rejects a kicked member in this session', async () => {
  const session = lfgSession([]);
  session.vcId = '';
  activeLFG.set(hostId, session);
  await saveLFGSession(session);
  const channel = voiceChannel(false);
  let joinerDM;
  channel.member.user.send = async (content) => { joinerDM = content; };
  let announcementEdit;
  const announcement = {
    embeds: [new EmbedBuilder().setDescription('**Game:** 3/4 Quest\n**Required rank:** 1/2 Gold\n**Players:** 1/4')],
    async edit(value) { announcementEdit = value; },
  };
  const guild = {
    id: guildId,
    members: { fetch: async () => channel.member },
    channels: { create: async () => channel },
  };
  let publicMessages = 0;
  const client = {
    channels: {
      fetch: async () => ({
        guild,
        isTextBased: () => true,
        messages: { fetch: async () => announcement },
        async send() { publicMessages++; },
      }),
    },
    users: { fetch: async () => ({ id: hostId, username: 'host' }) },
  };
  const interaction = {
    customId: `lfg_pro_accept_${participantId}_${originId}_${session.messageId}_${hostId}`,
    user: { id: hostId },
    message: requestMessage(session),
    client,
    async update(value) { this.message.components = value.components.map((row) => row.toJSON()); },
    async followUp(value) {
      return value;
    },
    async reply(value) {
      return value;
    },
  };
  const reply = await RequestHandler.prototype.run(interaction);
  assert.match(reply.content, /Join request accepted/);
  assert.equal(reply.ephemeral, true);
  assert.equal(publicMessages, 0);
  assert.equal(session.vcId, voiceId);
  assert.equal(session.participantIds.has(participantId), true);
  assert.deepEqual((await getLFGSession(hostId)).participantIds, [participantId]);
  assert.equal((await getLFGSession(hostId)).vcId, voiceId);
  assert.match(joinerDM, /Minecraft.*Gold.*<#567890123456789012>/);
  assert.equal(announcementEdit.embeds[0].data.description, '**Game:** 3/4 Quest\n**Required rank:** 1/2 Gold\n**Players:** 2/4');
  assert.equal(channel.sends.length, 1);
  assert.equal(channel.sends[0].components, undefined);

  session.participantIds.delete(participantId);
  session.kickedIds.add(participantId);
  const refused = await RequestHandler.prototype.run(interaction);
  assert.match(refused.content, /already been handled/);
  assert.equal(activeLFG.get(hostId), session);

  const next = lfgSession([]);
  next.messageId = '890123456789012345';
  next.vcId = '';
  activeLFG.set(hostId, next);
  const stale = await RequestHandler.prototype.run(interaction);
  assert.match(stale.content, /no longer active/);
  assert.equal(next.kickedIds.size, 0);
});

test('a host request disables both buttons and ignores concurrent and repeated clicks', async () => {
  const session = lfgSession([]);
  activeLFG.set(hostId, session);
  const message = requestMessage(session);
  let releaseNotification;
  const notification = new Promise((resolve) => { releaseNotification = resolve; });
  let declineDM;
  const client = { users: { fetch: async () => ({ send: async (content) => { declineDM = content; return notification; } }) } };
  const decline = decisionInteraction(session, 'decline', message, client);
  let updates = 0;
  const update = decline.update;
  decline.update = async (value) => { updates++; return update(value); };
  decline.followUp = async () => { assert.fail('Decline must not send a host follow-up'); };
  const first = RequestHandler.prototype.run(decline);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(message.components[0].components.map((button) => button.disabled), [true, true]);
  const duplicate = await RequestHandler.prototype.run(decisionInteraction(session, 'accept', message, client));
  assert.match(duplicate.content, /already been handled/);
  releaseNotification();
  assert.equal((await first).components.length, 1);
  assert.equal(updates, 1);
  assert.match(declineDM, /declined.*3 minutes/);
  assert.match((await RequestHandler.prototype.run(decisionInteraction(session, 'decline', message, client))).content, /already been handled/);
});

test('LFG cooldowns display rounded hours, minutes, and seconds', () => {
  assert.equal(formatLFGCooldown(3_600_000), '1 hour');
  assert.equal(formatLFGCooldown(7_200_001), '2 hours 1 second');
  assert.equal(formatLFGCooldown(3_661_000), '1 hour 1 minute 1 second');
  assert.equal(formatLFGCooldown(157_000), '2 minutes 37 seconds');
  assert.equal(formatLFGCooldown(60_000), '1 minute');
  assert.equal(formatLFGCooldown(61_000), '1 minute 1 second');
  assert.equal(formatLFGCooldown(45_000), '45 seconds');
  assert.equal(formatLFGCooldown(1), '1 second');
  assert.equal(formatLFGCooldown(60_001), '1 minute 1 second');
});

test('decline cooldown expires after 3 minutes and is scoped to the session', async (t) => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const session = lfgSession([]);
  activeLFG.set(hostId, session);
  const messages = [];
  const host = { async send(value) { messages.push(value); } };
  const client = { users: { fetch: async (id) => id === hostId ? host : { async send() {} } } };
  const decline = decisionInteraction(session, 'decline', requestMessage(session), client);
  assert.equal((await RequestHandler.prototype.run(decline)).components.length, 1);
  const join = () => JoinButtonHandler.prototype.run({
    customId: `lfg_pro_join_${hostId}`,
    user: { id: participantId, toString: () => `<@${participantId}>`, displayAvatarURL: () => 'https://example.com/avatar.png' },
    message: { id: session.messageId }, client,
    async deferUpdate() {}, async followUp(value) { return value; },
  });
  assert.match((await join()).content, /wait 3 minutes/);
  const replacement = lfgSession([]);
  replacement.messageId = 'replacement-message';
  activeLFG.set(hostId, replacement);
  assert.match((await JoinButtonHandler.prototype.run({
    customId: `lfg_pro_join_${hostId}`,
    user: { id: participantId, toString: () => `<@${participantId}>`, displayAvatarURL: () => 'https://example.com/avatar.png' },
    message: { id: replacement.messageId }, client,
    async deferUpdate() {}, async followUp(value) { return value; },
  })).content, /sent to the host/);
  activeLFG.set(hostId, session);
  now += 179_000;
  assert.match((await join()).content, /wait 1 second/);
  assert.equal(messages.length, 1);
  now += 1_000;
  assert.match((await join()).content, /sent to the host/);
  assert.equal(messages.length, 2);
});

test('pending request cooldown starts after host DM, expires, and stays with its session', async (t) => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const session = lfgSession([]);
  activeLFG.set(hostId, session);
  let releaseDM;
  const sending = new Promise((resolve) => { releaseDM = resolve; });
  const messages = [];
  const client = { users: { fetch: async () => ({ async send(value) { messages.push(value); if (messages.length === 1) await sending; } }) } };
  const first = JoinButtonHandler.prototype.run(joinInteraction(session, client));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pendingRequestCooldownRemaining(session, participantId), 0);
  assert.match((await JoinButtonHandler.prototype.run(joinInteraction(session, client))).content, /already being sent/);
  releaseDM();
  assert.match((await first).content, /sent to the host/);
  assert.equal(pendingRequestCooldownRemaining(session, participantId), 60_000);
  assert.match((await JoinButtonHandler.prototype.run(joinInteraction(session, client))).content, /wait 1 minute/);
  const replacement = lfgSession([]);
  replacement.messageId = 'replacement-message';
  activeLFG.set(hostId, replacement);
  assert.match((await JoinButtonHandler.prototype.run(joinInteraction(replacement, client))).content, /sent to the host/);
  activeLFG.set(hostId, session);
  now += 59_000;
  assert.match((await JoinButtonHandler.prototype.run(joinInteraction(session, client))).content, /wait 1 second/);
  now += 1_000;
  assert.match((await JoinButtonHandler.prototype.run(joinInteraction(session, client))).content, /sent to the host/);
  assert.equal(messages.length, 3);
});

test('failed host DM leaves no pending cooldown and allows an immediate retry', async () => {
  const session = lfgSession([]);
  activeLFG.set(hostId, session);
  let attempts = 0;
  const client = { users: { fetch: async () => ({ async send() { if (++attempts === 1) throw new Error('DM disabled'); } }) } };
  assert.match((await JoinButtonHandler.prototype.run(joinInteraction(session, client))).content, /could not receive/);
  assert.equal(pendingRequestCooldownRemaining(session, participantId), 0);
  assert.match((await JoinButtonHandler.prototype.run(joinInteraction(session, client))).content, /sent to the host/);
  assert.equal(attempts, 2);
});

test('a pending cooldown created during host fetch prevents another host DM', async () => {
  const session = lfgSession([]);
  activeLFG.set(hostId, session);
  let releaseFetch;
  const fetched = new Promise((resolve) => { releaseFetch = resolve; });
  let hostDMs = 0;
  const host = { async send() { hostDMs++; } };
  const delayed = JoinButtonHandler.prototype.run(joinInteraction(session, {
    users: { fetch: async () => fetched },
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.match((await JoinButtonHandler.prototype.run(joinInteraction(session, {
    users: { fetch: async () => host },
  }))).content, /sent to the host/);
  releaseFetch(host);
  assert.match((await delayed).content, /wait 1 minute/);
  assert.equal(hostDMs, 1);
});

test('decline clears pending request and starts the longer decline cooldown', async () => {
  const session = lfgSession([]);
  activeLFG.set(hostId, session);
  const client = { users: { fetch: async (id) => id === hostId ? { async send() {} } : { async send() {} } } };
  await JoinButtonHandler.prototype.run(joinInteraction(session, client));
  assert.ok(pendingRequestCooldownRemaining(session, participantId) > 0);
  await RequestHandler.prototype.run(decisionInteraction(session, 'decline', requestMessage(session), client));
  assert.equal(pendingRequestCooldownRemaining(session, participantId), 0);
  assert.ok(declineCooldownRemaining(session, participantId) > 0);
  assert.match((await JoinButtonHandler.prototype.run(joinInteraction(session, client))).content, /wait 3 minutes/);
});

test('a decline while the joiner fetches the host blocks the pending request DM', async () => {
  const session = lfgSession([]);
  activeLFG.set(hostId, session);
  let releaseHost;
  const hostFetched = new Promise((resolve) => { releaseHost = resolve; });
  let hostDMs = 0;
  const host = { async send() { hostDMs++; } };
  const joining = JoinButtonHandler.prototype.run({
    customId: `lfg_pro_join_${hostId}`,
    user: { id: participantId, toString: () => `<@${participantId}>`, displayAvatarURL: () => 'https://example.com/avatar.png' },
    message: { id: session.messageId },
    client: { users: { fetch: async () => hostFetched } },
    async deferUpdate() {}, async followUp(value) { return value; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  const decline = decisionInteraction(session, 'decline', requestMessage(session), {
    users: { fetch: async () => ({ async send() {} }) },
  });
  await RequestHandler.prototype.run(decline);
  releaseHost(host);
  assert.match((await joining).content, /Please wait/);
  assert.equal(hostDMs, 0);
});

test('closed and replaced sessions reject requests without changing the replacement', async () => {
  const session = lfgSession([]);
  activeLFG.set(hostId, session);
  await saveLFGSession(session);
  const message = requestMessage(session);
  const client = { channels: { fetch: async () => null } };
  activeLFG.delete(hostId);
  assert.match((await RequestHandler.prototype.run(decisionInteraction(session, 'accept', message, client))).content, /no longer active/);
  activeLFG.set(hostId, session);
  let releaseFetch;
  const fetched = new Promise((resolve) => { releaseFetch = resolve; });
  const inFlight = RequestHandler.prototype.run(decisionInteraction(session, 'accept', message, {
    channels: { fetch: async () => fetched },
  }));
  await new Promise((resolve) => setImmediate(resolve));
  const replacement = lfgSession([]);
  replacement.messageId = 'replacement-message';
  activeLFG.set(hostId, replacement);
  await saveLFGSession(replacement);
  releaseFetch({ guild: { members: { fetch: async () => ({ user: { bot: false } }) } } });
  assert.match((await inFlight).content, /no longer valid/);
  assert.equal(replacement.participantIds.size, 0);
  assert.equal((await getLFGSession(hostId)).messageId, replacement.messageId);
});

test('failed acceptance restores buttons and a later click can retry', async (t) => {
  t.mock.method(console, 'error', () => {});
  const session = lfgSession([]);
  session.vcId = '';
  activeLFG.set(hostId, session);
  await saveLFGSession(session);
  const message = requestMessage(session);
  let attempts = 0;
  const client = {
    channels: { fetch: async () => ({ guild: {
      id: guildId,
      members: { fetch: async () => ({ user: { bot: false, async send() {} } }) },
      channels: { create: async () => {
        if (++attempts === 1) throw new Error('temporary failure');
        return voiceChannel(false);
      } },
    }, isTextBased: () => false }) },
    users: { fetch: async () => ({ id: hostId, username: 'host', async send() {} }) },
  };
  await JoinButtonHandler.prototype.run(joinInteraction(session, client));
  assert.ok(pendingRequestCooldownRemaining(session, participantId) > 0);
  assert.match((await RequestHandler.prototype.run(decisionInteraction(session, 'accept', message, client))).content, /Could not add/);
  assert.ok(pendingRequestCooldownRemaining(session, participantId) > 0);
  assert.deepEqual(message.components[0].components.map((button) => button.disabled), [false, false]);
  assert.match((await RequestHandler.prototype.run(decisionInteraction(session, 'accept', message, client))).content, /Join request accepted/);
  assert.deepEqual(message.components[0].components.map((button) => button.disabled), [true, true]);
  assert.equal(session.participantIds.has(participantId), true);
  assert.equal(pendingRequestCooldownRemaining(session, participantId), 0);
});

test('a disabled joiner DM does not undo a host decision', async () => {
  const session = lfgSession([]);
  session.vcId = '';
  activeLFG.set(hostId, session);
  await saveLFGSession(session);
  const joiner = { bot: false, async send() { throw new Error('DM disabled'); } };
  const channel = voiceChannel(false);
  const client = {
    channels: { fetch: async () => ({ guild: {
      id: guildId,
      members: { fetch: async () => ({ user: joiner }) },
      channels: { create: async () => channel },
    }, isTextBased: () => false }) },
    users: { fetch: async (id) => id === hostId
      ? { id: hostId, username: 'host' }
      : { async send() { throw new Error('DM disabled'); } } },
  };
  const accepted = await RequestHandler.prototype.run(decisionInteraction(session, 'accept', requestMessage(session), client));
  assert.match(accepted.content, /accepted.*could not be notified/);
  assert.equal(session.participantIds.has(participantId), true);
  const declineMessage = requestMessage(session, outsiderId);
  const decline = decisionInteraction(session, 'decline', declineMessage, client, outsiderId);
  decline.followUp = async () => { assert.fail('Decline must not send a host follow-up'); };
  const declined = await RequestHandler.prototype.run(decline);
  assert.equal(declined.components.length, 1);
  assert.deepEqual(declineMessage.components[0].components.map((button) => button.disabled), [true, true]);
  assert.equal(session.participantIds.has(participantId), true);
});

test('an old LFG join button cannot request access to a later session', async () => {
  const oldSession = lfgSession([]);
  await saveLFGSession(oldSession);
  const session = lfgSession([]);
  session.messageId = '890123456789012345';
  await saveLFGSession(session);
  await restoreLFGSessions();
  const reply = await JoinButtonHandler.prototype.run({
    customId: `lfg_pro_join_${hostId}`,
    user: { id: participantId },
    message: { id: oldSession.messageId },
    async deferUpdate() {},
    async followUp(value) {
      return value;
    },
  });
  assert.match(reply.content, /no longer active/);
  assert.equal(session.participantIds.size, 0);
  assert.equal(activeLFG.get(hostId).messageId, session.messageId);
});

test('LFG join acknowledges once before fetching the host', async (t) => {
  const logs = [];
  t.mock.method(console, 'debug', (...args) => { logs.push(args); });
  const session = lfgSession([]);
  activeLFG.set(hostId, session);
  let acknowledged = false;
  let acknowledgementCount = 0;
  let hostDMs = 0;
  const reply = await JoinButtonHandler.prototype.run({
    id: 'join-interaction',
    createdTimestamp: Date.now() - 100,
    customId: `lfg_pro_join_${hostId}`,
    user: {
      id: participantId,
      toString: () => `<@${participantId}>`,
      displayAvatarURL: () => 'https://example.com/avatar.png',
    },
    message: { id: session.messageId },
    client: { users: { fetch: async () => {
      assert.equal(acknowledged, true);
      return { async send() { hostDMs++; } };
    } } },
    async deferUpdate() { acknowledgementCount++; acknowledged = true; },
    async followUp(value) { return value; },
    async reply() { assert.fail('Join must use the deferred update'); },
  });
  assert.match(reply.content, /sent to the host/);
  assert.equal(reply.ephemeral, true);
  assert.equal(acknowledgementCount, 1);
  assert.equal(hostDMs, 1);
  assert.equal(logs.length, 1);
  assert.ok(logs[0][1].ageMs >= 100);
});

for (const state of ['deferred', 'replied']) {
  test(`LFG join stops when the interaction is already ${state}`, async (t) => {
    const warnings = [];
    t.mock.method(console, 'warn', (...args) => { warnings.push(args); });
    const session = lfgSession([]);
    activeLFG.set(hostId, session);
    let acknowledgementCount = 0;
    let hostFetches = 0;
    let hostDMs = 0;
    let followUps = 0;
    const interaction = joinInteraction(session, {
      users: { fetch: async () => {
        hostFetches++;
        return { async send() { hostDMs++; } };
      } },
    });
    interaction.id = `${state}-join-interaction`;
    interaction[state] = true;
    interaction.deferUpdate = async () => { acknowledgementCount++; };
    interaction.followUp = async () => { followUps++; };

    const result = await JoinButtonHandler.prototype.run(interaction);
    assert.equal(result, undefined);
    assert.equal(acknowledgementCount, 0);
    assert.equal(hostFetches, 0);
    assert.equal(hostDMs, 0);
    assert.equal(followUps, 0);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0][1].interactionId, interaction.id);
  });
}

for (const code of [10062, 40060]) {
  test(`LFG join stops when its first acknowledgement fails with ${code}`, async (t) => {
    const errors = [];
    t.mock.method(console, 'error', (...args) => { errors.push(args); });
    const session = lfgSession([]);
    activeLFG.set(hostId, session);
    let acknowledgementCount = 0;
    let hostFetches = 0;
    let hostDMs = 0;
    let followUps = 0;
    const failure = { code };
    const result = await JoinButtonHandler.prototype.run({
      id: 'expired-join-interaction',
      createdTimestamp: Date.now() - 3_000,
      customId: `lfg_pro_join_${hostId}`,
      user: { id: participantId },
      message: { id: session.messageId },
      client: { users: { fetch: async () => {
        hostFetches++;
        return { async send() { hostDMs++; } };
      } } },
      async deferUpdate() { acknowledgementCount++; throw failure; },
      async followUp() { followUps++; },
    });
    assert.equal(result, undefined);
    assert.equal(acknowledgementCount, 1);
    assert.equal(hostFetches, 0);
    assert.equal(hostDMs, 0);
    assert.equal(followUps, 0);
    assert.equal(errors.length, 1);
    assert.equal(errors[0][1].interactionId, 'expired-join-interaction');
    assert.ok(errors[0][1].ageMs >= 3_000);
    assert.equal(errors[0][1].error, failure);
  });
}

test('LFG close deletes the channel and discards session-specific access state', async () => {
  const session = lfgSession([]);
  session.kickedIds.add(participantId);
  activeLFG.set(hostId, session);
  await saveLFGSession(session);
  const channel = voiceChannel();
  const reply = await LFGCommand.prototype.close.call({}, {
    user: { id: hostId },
    guild: { channels: { fetch: async () => channel } },
    client: { channels: { fetch: async () => null } },
    async deferReply(value) {
      assert.equal(value.ephemeral, true);
    },
    async editReply(value) {
      return value;
    },
  });
  assert.match(reply.content, /has been closed/);
  assert.equal(channel.deletes, 1);
  assert.equal(activeLFG.has(hostId), false);
  assert.equal(await getLFGSession(hostId), null);
  assert.equal(lfgSession([]).kickedIds.size, 0);
});

test('LFG close acknowledges before a slow voice channel deletion', async () => {
  const session = lfgSession();
  activeLFG.set(hostId, session);
  await saveLFGSession(session);
  let releaseDeletion;
  const deletion = new Promise((resolve) => { releaseDeletion = resolve; });
  let deleting = false;
  let acknowledged = false;
  let edited = false;
  const closing = LFGCommand.prototype.close({
    user: { id: hostId },
    guild: { channels: { fetch: async () => ({ async delete() {
      deleting = true;
      await deletion;
    } }) } },
    client: { channels: { fetch: async () => null } },
    async deferReply(value) {
      assert.equal(value.ephemeral, true);
      assert.equal(deleting, false);
      acknowledged = true;
    },
    async editReply(value) { edited = true; return value; },
    async reply() { assert.fail('Close must use the deferred response'); },
  });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(acknowledged, true);
    assert.equal(deleting, true);
    assert.equal(edited, false);
    assert.equal(activeLFG.get(hostId), session);
    assert.ok(await getLFGSession(hostId));
  } finally {
    releaseDeletion();
  }
  assert.match((await closing).content, /has been closed/);
  assert.equal(activeLFG.has(hostId), false);
  assert.equal(await getLFGSession(hostId), null);
});

test('LFG close retains the session when channel deletion fails for a retry', async (t) => {
  t.mock.method(console, 'error', () => {});
  const session = lfgSession();
  activeLFG.set(hostId, session);
  await saveLFGSession(session);
  const channel = voiceChannel();
  channel.delete = async () => {
    throw { code: 50013 };
  };
  let acknowledged = false;
  const reply = await LFGCommand.prototype.close.call({}, {
    user: { id: hostId },
    guild: { channels: { fetch: async () => channel } },
    async deferReply(value) {
      assert.equal(value.ephemeral, true);
      acknowledged = true;
    },
    async editReply(value) {
      return value;
    },
    async reply() { assert.fail('Close must use the deferred response'); },
  });
  assert.equal(acknowledged, true);
  assert.match(reply.content, /Could not close/);
  assert.equal(activeLFG.get(hostId), session);
  assert.equal((await getLFGSession(hostId)).messageId, session.messageId);
});

test('LFG close retains stored and in-memory state if JSON deletion fails', async (t) => {
  t.mock.method(console, 'error', () => {});
  const session = lfgSession();
  activeLFG.set(hostId, session);
  await saveLFGSession(session);
  let announcementEdits = 0;
  const voice = voiceChannel();
  const interaction = {
    user: { id: hostId },
    guild: { channels: { fetch: async () => voice } },
    client: { channels: { fetch: async () => ({
      isTextBased: () => true,
      messages: { fetch: async () => ({ async edit() { announcementEdits++; } }) },
    }) } },
    async deferReply(value) { assert.equal(value.ephemeral, true); },
    async editReply(value) { return value; },
  };
  const originalPath = process.env.LFG_DATA_FILE;
  try {
    process.env.LFG_DATA_FILE = storageDirectory;
    const reply = await LFGCommand.prototype.close(interaction);
    assert.match(reply.content, /Could not close the session/);
    assert.equal(activeLFG.get(hostId), session);
    assert.equal(voice.deletes, 1);
    assert.equal(announcementEdits, 0);
  } finally {
    process.env.LFG_DATA_FILE = originalPath;
  }
  assert.equal((await getLFGSession(hostId)).messageId, session.messageId);
});

test('legacy LFG end buttons direct everyone to the close command without changing the session', async () => {
  const session = lfgSession();
  session.kickedIds.add(outsiderId);
  activeLFG.set(hostId, session);
  await saveLFGSession(session);
  const channel = voiceChannel();
  const guild = { channels: { fetch: async () => channel } };
  const client = { channels: { fetch: async () => null } };
  const interaction = (userId) => ({
    customId: `lfg_pro_end_${voiceId}`,
    user: { id: userId },
    guild,
    client,
    async reply(value) {
      return value;
    },
  });
  const refused = await EndSessionHandler.prototype.run(interaction(outsiderId));
  assert.match(refused.content, /\/lfg-pro close/);
  assert.equal(refused.ephemeral, true);
  assert.equal(channel.deletes, 0);
  const directed = await EndSessionHandler.prototype.run(interaction(hostId));
  assert.match(directed.content, /\/lfg-pro close/);
  assert.equal(directed.ephemeral, true);
  assert.equal(channel.deletes, 0);
  assert.equal(activeLFG.get(hostId), session);
  assert.ok(await getLFGSession(hostId));
});

test('legacy LFG end button acknowledges without fetching a voice channel', async () => {
  const session = lfgSession();
  activeLFG.set(hostId, session);
  await saveLFGSession(session);
  const channel = voiceChannel();
  const reply = await EndSessionHandler.prototype.run({
    customId: `lfg_pro_end_${voiceId}`,
    user: { id: hostId },
    guild: { channels: { fetch: async () => { assert.fail('old button must not fetch channel'); } } },
    async reply(value) { return value; },
  });
  assert.match(reply.content, /\/lfg-pro close/);
  assert.equal(channel.deletes, 0);
  assert.ok(await getLFGSession(hostId));
  activeLFG.clear();
  await restoreLFGSessions();
  assert.equal(activeLFG.get(hostId).vcId, voiceId);
});

test('restart restores kicked participants and rejects their old join requests', async () => {
  const session = lfgSession([]);
  session.kickedIds.add(participantId);
  activeLFG.set(hostId, session);
  await saveLFGSession(session);
  activeLFG.clear();
  await restoreLFGSessions();

  assert.equal(activeLFG.get(hostId).kickedIds.has(participantId), true);
  assert.ok(activeLFG.get(hostId).participantIds instanceof Set);
  assert.equal(activeLFG.get(hostId).participantIds.has(participantId), false);
  const reply = await JoinButtonHandler.prototype.run({
    customId: `lfg_pro_join_${hostId}`,
    user: { id: participantId },
    message: { id: session.messageId },
    async deferUpdate() {},
    async followUp(value) { return value; },
  });
  assert.match(reply.content, /removed from this session/);
});

test('restart restores both participant and kicked lookup methods', async () => {
  const session = lfgSession();
  session.kickedIds.add(outsiderId);
  await saveLFGSession(session);
  await restoreLFGSessions();
  const restored = activeLFG.get(hostId);
  assert.equal(restored.participantIds.has(participantId), true);
  assert.equal(restored.kickedIds.has(outsiderId), true);
});

test('creation registers before saving and blocks joins until persistence completes', async () => {
  const lockPath = `${process.env.LFG_DATA_FILE}.lock`;
  await mkdir(lockPath);
  await writeFile(join(lockPath, 'held'), '');
  const interaction = {
    user: { id: hostId, tag: 'host' }, channelId: originId,
    options: { getString: () => 'game', getInteger: () => null },
    channel: { isSendable: () => true, send: async () => ({ id: 'pending-message', channelId: originId }) },
    deferReply: async () => {}, editReply: async (value) => value,
    reply: async (value) => value,
  };
  const creation = LFGCommand.prototype.create(interaction);
  try {
    for (let attempt = 0; attempt < 100 && !activeLFG.has(hostId); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 1));
    const session = activeLFG.get(hostId);
    assert.ok(session);
    assert.equal(pendingLFGInitialSaves.has(session), true);
    const duplicate = await LFGCommand.prototype.create({ ...interaction, reply: async (value) => value });
    assert.match(duplicate.content, /already have an active session/);
    const join = await JoinButtonHandler.prototype.run({
      customId: `lfg_pro_join_${hostId}`, user: { id: participantId },
      message: { id: session.messageId }, async deferUpdate() {},
      async followUp(value) { return value; },
    });
    assert.match(join.content, /still being created/);
    const accept = await RequestHandler.prototype.run({
      customId: `lfg_pro_accept_${participantId}_${originId}_${session.messageId}_${hostId}`,
      user: { id: hostId }, async reply(value) { return value; },
    });
    assert.match(accept.content, /still being created/);
    assert.equal(await getLFGSession(hostId), null);
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
  await creation;
  assert.equal(pendingLFGInitialSaves.has(activeLFG.get(hostId)), false);
  assert.ok(await getLFGSession(hostId));
});

test('failed initial save removes only its own cached session and deletes its announcement', async (t) => {
  t.mock.method(console, 'error', () => {});
  const dataPath = process.env.LFG_DATA_FILE;
  const lockPath = `${dataPath}.lock`;
  await mkdir(lockPath);
  await writeFile(join(lockPath, 'held'), '');
  let edited;
  let deleted = false;
  const creation = LFGCommand.prototype.create({
    user: { id: hostId, tag: 'host' }, channelId: originId,
    options: { getString: () => 'game', getInteger: () => null },
    channel: { isSendable: () => true, send: async () => ({ id: 'failed-message', channelId: originId, delete: async () => { deleted = true; } }) },
    deferReply: async () => {},
    editReply: async (value) => { edited = value; },
  });
  try {
    for (let attempt = 0; attempt < 100 && !activeLFG.has(hostId); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 1));
    const pending = activeLFG.get(hostId);
    assert.ok(pendingLFGInitialSaves.has(pending));
    const newer = lfgSession([]);
    newer.messageId = 'newer-message';
    activeLFG.set(hostId, newer);
    await mkdir(dataPath);
    await rm(lockPath, { recursive: true, force: true });
    await creation;
    assert.equal(activeLFG.get(hostId), newer);
    assert.equal(pendingLFGInitialSaves.has(pending), false);
    assert.match(edited.content, /Could not create/);
    assert.equal(deleted, true);
    assert.equal(edited.components, undefined);
    assert.equal(edited.embeds, undefined);
  } finally {
    await rm(lockPath, { recursive: true, force: true });
    await rm(dataPath, { recursive: true, force: true });
  }
});

test('LFG creation deletes failed announcements and registers saved sessions', async (t) => {
  t.mock.method(console, 'error', () => {});
  const path = process.env.LFG_DATA_FILE;
  let edited;
  let deleted = false;
  const interaction = {
    user: { id: hostId, tag: 'host' }, channelId: originId,
    options: { getString: () => 'game', getInteger: () => null },
    channel: { isSendable: () => true, send: async () => ({ id: 'message', channelId: originId, delete: async () => { deleted = true; } }) },
    deferReply: async () => {},
    editReply: async (value) => { edited = value; },
  };
  try {
    process.env.LFG_DATA_FILE = storageDirectory;
    await LFGCommand.prototype.create(interaction);
    assert.match(edited.content, /Could not create/);
    assert.equal(deleted, true);
    assert.equal(edited.components, undefined);
    assert.equal(edited.embeds, undefined);
    assert.equal(activeLFG.has(hostId), false);
  } finally { process.env.LFG_DATA_FILE = path; }
  await LFGCommand.prototype.create(interaction);
  assert.equal(activeLFG.get(hostId).messageId, 'message');
  assert.equal((await getLFGSession(hostId)).messageId, 'message');
});

test('LFG failed kick save preserves in-memory and stored participants', async (t) => {
  t.mock.method(console, 'error', () => {});
  const session = lfgSession();
  activeLFG.set(hostId, session);
  await saveLFGSession(session);
  const stored = await getLFGSession(hostId);
  const channel = voiceChannel();
  let dms = 0;
  const path = process.env.LFG_DATA_FILE;
  try {
    process.env.LFG_DATA_FILE = storageDirectory;
    const interaction = kickInteraction(hostId, participantId, {
      id: guildId,
      channels: { fetch: async () => channel },
      members: { fetch: async () => channel.member },
    });
    interaction.options.getUser = () => ({ id: participantId, bot: false, async send() { dms++; } });
    const reply = await LFGCommand.prototype.kick(interaction);
    assert.match(reply.content, /Could not remove/);
    assert.equal(dms, 0);
    assert.deepEqual([...session.participantIds], stored.participantIds);
    assert.deepEqual([...session.kickedIds], stored.kickedIds);
  } finally { process.env.LFG_DATA_FILE = path; }
  assert.deepEqual(await getLFGSession(hostId), stored);
});

test('LFG failed accept save preserves participants and voice channel id', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const vcId of ['', voiceId]) {
    const session = lfgSession([]);
    session.vcId = vcId;
    activeLFG.set(hostId, session);
    await saveLFGSession(session);
    const stored = await getLFGSession(hostId);
    const channel = voiceChannel(false);
    const guild = {
      id: guildId,
      members: { fetch: async () => channel.member },
      channels: { create: async () => channel, fetch: async () => channel },
    };
    const path = process.env.LFG_DATA_FILE;
    try {
      process.env.LFG_DATA_FILE = storageDirectory;
      const reply = await RequestHandler.prototype.run({
        customId: `lfg_pro_accept_${participantId}_${originId}_${session.messageId}_${hostId}`,
        user: { id: hostId },
        message: requestMessage(session),
        client: {
          channels: { fetch: async () => ({ guild, isTextBased: () => false }) },
          users: { fetch: async () => ({ id: hostId, username: 'host' }) },
        },
        async update(value) { this.message.components = value.components.map((row) => row.toJSON()); },
        async followUp(value) { return value; },
      });
      assert.match(reply.content, /Could not add/);
      assert.equal(session.vcId, vcId);
      assert.equal(session.participantIds.size, 0);
    } finally { process.env.LFG_DATA_FILE = path; }
    assert.deepEqual(await getLFGSession(hostId), stored);
  }
});

for (const outcome of ['saved', 'rejected', 'ended', 'throws', 'ended and throws']) {
  for (const prior of ['new channel', 'no overwrite', 'allow', 'deny', 'inherit']) {
    test(`LFG acceptance cleanup: ${outcome}, ${prior}`, async (t) => {
      t.mock.method(console, 'error', () => {});
      const session = lfgSession([]);
      const created = prior === 'new channel';
      if (created) session.vcId = '';
      activeLFG.set(hostId, session);
      await saveLFGSession(outcome === 'rejected' ? { ...session, messageId: 'replacement' } : session);
      const stored = await getLFGSession(hostId);
      const channel = voiceChannel(false);
      const overwrites = channel.permissionOverwrites;
      const flags = PermissionsBitField.Flags;
      const previous = ['allow', 'deny', 'inherit'].includes(prior) ? {
        allow: new PermissionsBitField([flags.Speak, ...(prior === 'allow' ? [flags.ViewChannel] : prior === 'deny' ? [flags.Connect] : [])]),
        deny: new PermissionsBitField([flags.SendMessages, ...(prior === 'deny' ? [flags.ViewChannel] : prior === 'allow' ? [flags.Connect] : [])]),
      } : undefined;
      if (previous) overwrites.cache.set(participantId, previous);
      const afterGrant = () => {
        if (outcome.startsWith('ended')) activeLFG.delete(hostId);
      };
      const edit = overwrites.edit.bind(overwrites);
      overwrites.edit = async (...args) => { await edit(...args); afterGrant(); };
      const guild = {
        id: guildId,
        members: { fetch: async () => channel.member },
        channels: {
          create: async () => { afterGrant(); return channel; },
          fetch: async () => channel,
        },
      };
      const client = {
        channels: { fetch: async () => ({ guild, isTextBased: () => false }) },
        users: { fetch: async () => ({ id: hostId, username: 'host' }) },
      };
      const path = process.env.LFG_DATA_FILE;
      let reply;
      try {
        if (outcome.includes('throws')) process.env.LFG_DATA_FILE = storageDirectory;
        reply = await RequestHandler.prototype.run(decisionInteraction(session, 'accept', requestMessage(session), client));
      } finally { process.env.LFG_DATA_FILE = path; }
      if (outcome === 'saved') {
        assert.match(reply.content, /Join request accepted/);
        assert.equal(channel.deletes, 0);
        assert.deepEqual(overwrites.deleted, []);
        assert.equal(channel.edits.length, created ? 0 : 1);
        assert.equal(session.participantIds.has(participantId), true);
        assert.deepEqual((await getLFGSession(hostId)).participantIds, [participantId]);
      } else {
        assert.match(reply.content, outcome.includes('throws') ? /Could not add/ : /no longer valid/);
        assert.equal(channel.deletes, created ? 1 : 0);
        assert.equal(session.vcId, created ? '' : voiceId);
        assert.equal(session.participantIds.size, 0);
        assert.deepEqual(await getLFGSession(hostId), stored);
        if (!created) {
          assert.deepEqual(overwrites.cache.get(participantId), previous);
          assert.deepEqual(overwrites.deleted, previous ? [] : [participantId]);
          assert.equal(channel.edits.length, previous ? 2 : 1);
          if (previous) assert.deepEqual(Object.keys(channel.edits[1][1]).sort(), ['Connect', 'ViewChannel']);
        }
      }
    });
  }
}

test('LFG storage rejects invalid roots and member collections without overwriting them', async () => {
  const { writeFile, readFile } = await import('node:fs/promises');
  const valid = { ...lfgSession(), participantIds: [participantId], kickedIds: [] };
  for (const value of [null, [], 1, 'sessions', { host: null }, { host: {} }, { host: { participantIds: 'id', kickedIds: [] } }, { host: { participantIds: [], kickedIds: {} } }, { [hostId]: { ...valid, maxPlayers: '4' } }, { [hostId]: { ...valid, participantIds: [1] } }, { [hostId]: { ...valid, kickedIds: [null] } }, { [hostId]: { ...valid, authorId: outsiderId } }]) {
    const raw = JSON.stringify(value);
    await writeFile(process.env.LFG_DATA_FILE, raw);
    await assert.rejects(restoreLFGSessions(), /Invalid LFG storage/);
    await assert.rejects(saveLFGSession(lfgSession()), /Invalid LFG storage/);
    assert.equal(await readFile(process.env.LFG_DATA_FILE, 'utf8'), raw);
  }
});
