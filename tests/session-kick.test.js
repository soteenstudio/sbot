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
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { ChannelType, EmbedBuilder } from 'discord.js';
import { PartyCommand } from '../dist/commands/party.js';
import { LFGCommand } from '../dist/commands/lfg-pro.js';
import { RequestHandler } from '../dist/interaction-handlers/LFGRequestHandler.js';
import { EndSessionHandler } from '../dist/interaction-handlers/LFGEndSession.js';
import { JoinButtonHandler } from '../dist/interaction-handlers/LFGJoin.js';
import { activeParties } from '../dist/lib/party-data.js';
import { activeLFG } from '../dist/lib/lfg-data.js';
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
  let disconnects = 0;
  let deletes = 0;
  const member = {
    id: participantId,
    user: { bot: false },
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
    get disconnects() {
      return disconnects;
    },
    get deletes() {
      return deletes;
    },
    permissionOverwrites: {
      async edit(id, permissions) {
        edits.push([id, permissions]);
      },
    },
    async delete() {
      deletes++;
    },
    async send() {},
    toString() {
      return `<#${voiceId}>`;
    },
  };
}

function kickInteraction(userId, targetId, guild) {
  return {
    user: { id: userId },
    guild,
    options: { getUser: () => ({ id: targetId, bot: false }) },
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
    embeds: [new EmbedBuilder().setDescription('Players: 2/2')],
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
  assert.match(edit.embeds[0].data.description, /Players: 1\/2/);
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
  const channel = voiceChannel(false);
  const guild = {
    id: guildId,
    members: { fetch: async () => channel.member },
    channels: { create: async () => channel },
  };
  const client = {
    channels: {
      fetch: async () => ({ guild, isTextBased: () => false }),
    },
    users: { fetch: async () => ({ id: hostId, username: 'host' }) },
  };
  const interaction = {
    customId: `lfg_pro_accept_${participantId}_${originId}_${session.messageId}_${hostId}`,
    user: { id: hostId },
    client,
    async deferUpdate() {},
    async followUp(value) {
      return value;
    },
    async reply(value) {
      return value;
    },
  };
  const reply = await RequestHandler.prototype.run(interaction);
  assert.match(reply.content, /Join request accepted/);
  assert.equal(session.vcId, voiceId);
  assert.equal(session.participantIds.has(participantId), true);
  assert.deepEqual((await getLFGSession(hostId)).participantIds, [participantId]);
  assert.equal((await getLFGSession(hostId)).vcId, voiceId);

  session.participantIds.delete(participantId);
  session.kickedIds.add(participantId);
  const refused = await RequestHandler.prototype.run(interaction);
  assert.match(refused.content, /removed from this session/);
  assert.equal(activeLFG.get(hostId), session);

  const next = lfgSession([]);
  next.messageId = '890123456789012345';
  next.vcId = '';
  activeLFG.set(hostId, next);
  const stale = await RequestHandler.prototype.run(interaction);
  assert.match(stale.content, /no longer active/);
  assert.equal(next.kickedIds.size, 0);
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
    async reply(value) {
      return value;
    },
  });
  assert.match(reply.content, /has been closed/);
  assert.equal(channel.deletes, 1);
  assert.equal(activeLFG.has(hostId), false);
  assert.equal(await getLFGSession(hostId), null);
  assert.equal(lfgSession([]).kickedIds.size, 0);
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
  const reply = await LFGCommand.prototype.close.call({}, {
    user: { id: hostId },
    guild: { channels: { fetch: async () => channel } },
    async reply(value) {
      return value;
    },
  });
  assert.match(reply.content, /Could not close/);
  assert.equal(activeLFG.has(hostId), true);
  assert.ok(await getLFGSession(hostId));
});

test('LFG end button requires its host and deletes the session channel', async () => {
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
  assert.match(refused.content, /Only the host/);
  assert.equal(channel.deletes, 0);
  const ended = await EndSessionHandler.prototype.run(interaction(hostId));
  assert.match(ended.content, /has ended/);
  assert.equal(channel.deletes, 1);
  assert.equal(activeLFG.has(hostId), false);
  assert.equal(await getLFGSession(hostId), null);
});

test('LFG end button retains persisted state when channel deletion fails', async (t) => {
  t.mock.method(console, 'error', () => {});
  const session = lfgSession();
  activeLFG.set(hostId, session);
  await saveLFGSession(session);
  const channel = voiceChannel();
  channel.delete = async () => { throw { code: 50013 }; };
  const reply = await EndSessionHandler.prototype.run({
    customId: `lfg_pro_end_${voiceId}`,
    user: { id: hostId },
    guild: { channels: { fetch: async () => channel } },
    async reply(value) { return value; },
  });
  assert.match(reply.content, /Could not end/);
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
  const reply = await JoinButtonHandler.prototype.run({
    customId: `lfg_pro_join_${hostId}`,
    user: { id: participantId },
    message: { id: session.messageId },
    async deferUpdate() {},
    async followUp(value) { return value; },
  });
  assert.match(reply.content, /removed from this session/);
});
