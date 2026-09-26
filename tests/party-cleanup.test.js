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
import { beforeEach, test } from 'node:test';
import {
  ChannelType,
  Collection,
  OverwriteType,
  PermissionsBitField,
} from 'discord.js';
import { Roles } from '../dist/config.js';
import { PartyCommand } from '../dist/commands/party.js';
import { PartyReady } from '../dist/listeners/PartyReady.js';
import {
  activeParties,
  Games,
  getMarkedParty,
  getPartyChannelName,
} from '../dist/lib/party-data.js';

const hostId = '123456789012345678';
const roleId = '234567890123456789';
const richmanRoleId = '567890123456789012';
const guildId = '345678901234567890';
const party = { hostId, gameKey: 'minecraft' };
const access = [
  PermissionsBitField.Flags.ViewChannel,
  PermissionsBitField.Flags.Connect,
];

beforeEach(() => {
  activeParties.clear();
  Games.minecraft.roleId = roleId;
  Roles.RICHMAN.id = richmanRoleId;
});

function voiceChannel(id = '456789012345678901', humans = 0) {
  const overwrites = [
    [
      guildId,
      {
        type: OverwriteType.Role,
        deny: new PermissionsBitField(PermissionsBitField.Flags.ViewChannel),
      },
    ],
    [
      roleId,
      { type: OverwriteType.Role, allow: new PermissionsBitField(access) },
    ],
    [
      hostId,
      { type: OverwriteType.Member, allow: new PermissionsBitField(access) },
    ],
  ];
  return {
    id,
    name: getPartyChannelName('minecraft', hostId),
    type: ChannelType.GuildVoice,
    guild: { id: guildId },
    permissionOverwrites: { cache: new Collection(overwrites) },
    members: new Collection([
      ['bot', { user: { bot: true } }],
      ...Array.from({ length: humans }, (_, i) => [
        `human${i}`,
        { user: { bot: false } },
      ]),
    ]),
    isVoiceBased() {
      return this.type === ChannelType.GuildVoice;
    },
    deletes: 0,
    async delete() {
      assert.ok(
        activeParties.has(this.id),
        'tracking must remain until deletion succeeds',
      );
      this.deletes++;
    },
    toString() {
      return `<#${id}>`;
    },
  };
}

async function createParty(maxPlayersOption = null) {
  const channel = voiceChannel();
  let reply;
  const guild = {
    id: guildId,
    channels: {
      async create(options) {
        assert.equal(options.name, channel.name);
        assert.equal(options.type, ChannelType.GuildVoice);
        assert.equal(options.userLimit, maxPlayersOption ?? Games.minecraft.maxPlayers);
        return channel;
      },
    },
  };
  await PartyCommand.prototype.create.call(
    {},
    {
      options: {
        getString: () => 'minecraft',
        getInteger: () => maxPlayersOption,
      },
      guild,
      member: { roles: [richmanRoleId] },
      user: { id: hostId, username: 'host' },
      async deferReply() {},
      async editReply(value) {
        reply = value;
      },
    },
  );
  assert.deepEqual(activeParties.get(channel.id), party);
  assert.equal(channel.deletes, 0);
  return { channel, reply };
}

test('party rejects a player limit override from a lower role', async () => {
  let reply;
  await PartyCommand.prototype.create.call({}, {
    options: {
      getString: () => 'minecraft',
      getInteger: () => 4,
    },
    member: { roles: [roleId] },
    reply(value) {
      reply = value;
    },
  });
  assert.match(reply.content, /Richman.*max_players/);
  assert.equal(reply.ephemeral, true);
});

test('party close reports when the host has no active party', async () => {
  let reply;
  await PartyCommand.prototype.close.call({}, {
    user: { id: hostId },
    reply(value) {
      reply = value;
    },
  });
  assert.match(reply.content, /do not have an active party/);
  assert.equal(reply.ephemeral, true);
});

test('party close deletes the hosted voice channel', async (t) => {
  const channel = voiceChannel();
  activeParties.set(channel.id, party);
  const deletion = t.mock.method(channel, 'delete');
  let reply;
  await PartyCommand.prototype.close.call({}, {
    user: { id: hostId },
    guild: {
      channels: {
        async fetch(id) {
          assert.equal(id, channel.id);
          return channel;
        },
      },
    },
    reply(value) {
      reply = value;
    },
  });
  assert.equal(deletion.mock.callCount(), 1);
  assert.equal(activeParties.has(channel.id), false);
  assert.match(reply.content, /has been closed/);
});

test('party list shows the game, host, and voice channel', async () => {
  const channel = voiceChannel();
  activeParties.set(channel.id, party);
  let reply;
  await PartyCommand.prototype.list.call({}, {
    reply(value) {
      reply = value;
    },
  });
  const description = reply.embeds[0].data.description;
  assert.match(description, /Minecraft/);
  assert.ok(description.includes(`<@${hostId}>`));
  assert.ok(description.includes(`<#${channel.id}>`));
});

test('party create rejects a second active party from the same host', async (t) => {
  const channel = voiceChannel();
  const create = t.mock.fn(async () => channel);
  const replies = [];
  const interaction = {
    options: {
      getString: () => 'minecraft',
      getInteger: () => null,
    },
    guild: { id: guildId, channels: { create } },
    member: { roles: [richmanRoleId] },
    user: { id: hostId },
    async deferReply() {},
    async editReply(value) {
      replies.push(value);
    },
    async reply(value) {
      replies.push(value);
    },
  };

  await PartyCommand.prototype.create.call({}, interaction);
  await PartyCommand.prototype.create.call({}, interaction);

  assert.equal(create.mock.callCount(), 1);
  assert.match(replies[1].content, /already have an active party/);
  assert.equal(replies[1].ephemeral, true);
});

for (const [maxPlayersOption, label] of [
  [null, '8'],
  [1, '1'],
  [10, '10'],
]) {
  test(`party uses ${maxPlayersOption ?? 'default'} player limit`, async () => {
    const { reply } = await createParty(maxPlayersOption);
    const playerLimit = reply.embeds[0].data.fields.find(
      (field) => field.name === 'Player limit',
    );
    assert.equal(playerLimit.value, label);
  });
}

test('ready recovery tracks marked party channels without deleting any of them', async () => {
  const occupied = voiceChannel('occupied', 1);
  const empty = voiceChannel('empty');
  const legacy = voiceChannel('legacy');
  legacy.name = 'Minecraft-host';
  const wrongPermissions = voiceChannel('wrong-permissions');
  wrongPermissions.permissionOverwrites.cache.delete(hostId);
  const text = voiceChannel('text');
  text.type = ChannelType.GuildText;
  const channels = [occupied, empty, legacy, wrongPermissions, text];
  await PartyReady.prototype.run({
    guilds: {
      cache: new Collection([
        [
          guildId,
          {
            channels: {
              fetch: async () =>
                new Collection(
                  channels.map((channel) => [channel.id, channel]),
                ),
            },
          },
        ],
      ]),
    },
  });
  assert.deepEqual(
    [...activeParties.entries()].sort(),
    [['empty', party], ['occupied', party]].sort(),
  );
  assert.deepEqual(
    channels.map((channel) => channel.deletes),
    [0, 0, 0, 0, 0],
  );
});

test('ready recovery continues after a guild fetch error and tracks the reachable guild', async (t) => {
  t.mock.method(console, 'error', () => {});
  const empty = voiceChannel('empty');
  const tracked = voiceChannel('tracked');
  activeParties.set(tracked.id, party);
  await PartyReady.prototype.run({
    guilds: {
      cache: new Collection([
        [
          'inaccessible',
          {
            channels: {
              fetch: async () => {
                throw { code: 50001 };
              },
            },
          },
        ],
        [
          'accessible',
          {
            channels: {
              fetch: async () =>
                new Collection(
                  [empty, tracked].map((channel) => [
                    channel.id,
                    channel,
                  ]),
                ),
            },
          },
        ],
      ]),
    },
  });
  assert.ok(activeParties.has(empty.id));
  assert.equal(empty.deletes, 0);
  assert.equal(tracked.deletes, 0);
});

test('marker recognition rejects unknown games, invalid hosts, and mismatched overwrites', () => {
  const channel = voiceChannel();
  assert.deepEqual(getMarkedParty(channel), party);
  for (const name of [
    'sbot-party-unknown-' + hostId,
    'sbot-party-minecraft-host',
    'sbot-party-constructor-' + hostId,
  ]) {
    channel.name = name;
    assert.equal(getMarkedParty(channel), undefined);
  }
  channel.name = getPartyChannelName('minecraft', hostId);
  channel.permissionOverwrites.cache.get(hostId).type = OverwriteType.Role;
  assert.equal(getMarkedParty(channel), undefined);
  channel.permissionOverwrites.cache.get(hostId).type = OverwriteType.Member;
  Games.minecraft.roleId = undefined;
  assert.equal(getMarkedParty(channel), undefined);
});

function creationInteraction(channel) {
  return {
    options: {
      getString: () => 'minecraft',
      getInteger: () => null,
    },
    guild: { id: guildId, channels: { create: async () => channel } },
    user: { id: hostId },
    async deferReply() {},
    async editReply() {},
    async reply(value) {
      return value;
    },
  };
}

for (const stage of ['deferReply', 'create']) {
  test(`party create rejects overlapping requests while awaiting ${stage}`, async (t) => {
    const channel = voiceChannel();
    const interaction = creationInteraction(channel);
    const started = Promise.withResolvers();
    const finish = Promise.withResolvers();
    const target = stage === 'create' ? interaction.guild.channels : interaction;
    const pendingStage = t.mock.method(target, stage, () => {
      started.resolve();
      return finish.promise;
    });
    const first = PartyCommand.prototype.create.call({}, interaction);
    await started.promise;
    try {
      const reply = await PartyCommand.prototype.create.call({}, interaction);
      assert.match(reply.content, /already have an active party/);
      assert.equal(reply.ephemeral, true);
      assert.equal(pendingStage.mock.callCount(), 1);
    } finally {
      finish.resolve(channel);
      await first;
    }
    assert.deepEqual(activeParties.get(channel.id), party);
    activeParties.clear();
    pendingStage.mock.restore();
    await PartyCommand.prototype.create.call({}, interaction);
    assert.deepEqual(activeParties.get(channel.id), party);
  });
}

for (const stage of ['deferReply', 'create', 'editReply']) {
  test(`party create releases the host reservation after ${stage} fails`, async (t) => {
    t.mock.method(console, 'error', () => {});
    const channel = voiceChannel();
    const interaction = creationInteraction(channel);
    const target = stage === 'create' ? interaction.guild.channels : interaction;
    const failure = new Error(`${stage} failed`);
    const failedStage = t.mock.method(target, stage, async () => {
      throw failure;
    });
    const request = PartyCommand.prototype.create.call({}, interaction);
    if (stage === 'create') {
      await request;
    } else {
      await assert.rejects(request, failure);
    }
    assert.equal(activeParties.has(channel.id), stage === 'editReply');
    activeParties.clear();
    failedStage.mock.restore();
    await PartyCommand.prototype.create.call({}, interaction);
    assert.deepEqual(activeParties.get(channel.id), party);
  });
}

for (const stage of ['fetch', 'delete']) {
  for (const code of [10003, 50013, 'ECONNRESET']) {
    test(`party close handles ${stage} error ${code} without losing retryable parties`, async (t) => {
      t.mock.method(console, 'error', () => {});
      const channel = voiceChannel();
      activeParties.set(channel.id, party);
      const channels = { fetch: async () => channel };
      const failedStage = t.mock.method(
        stage === 'fetch' ? channels : channel,
        stage,
        async () => {
          throw { code };
        },
      );
      const interaction = {
        user: { id: hostId },
        guild: { channels },
        reply: async (value) => value,
      };
      const reply = await PartyCommand.prototype.close.call({}, interaction);
      assert.equal(activeParties.has(channel.id), code !== 10003);
      assert.match(
        reply.content,
        code === 10003 ? /has been closed/ : /Could not close/,
      );
      assert.equal(reply.ephemeral, true);
      if (code !== 10003) {
        failedStage.mock.restore();
        await PartyCommand.prototype.close.call({}, interaction);
        assert.equal(channel.deletes, 1);
        assert.equal(activeParties.has(channel.id), false);
      }
    });
  }
}

for (const missing of ['channel', 'guild']) {
  test(`party close handles a missing ${missing}`, async (t) => {
    t.mock.method(console, 'error', () => {});
    const channel = voiceChannel();
    activeParties.set(channel.id, party);
    const reply = await PartyCommand.prototype.close.call({}, {
      user: { id: hostId },
      guild: missing === 'guild' ? null : { channels: { fetch: async () => null } },
      reply: async (value) => value,
    });
    assert.equal(activeParties.has(channel.id), missing === 'guild');
    assert.match(
      reply.content,
      missing === 'guild' ? /Could not close/ : /has been closed/,
    );
  });
}
