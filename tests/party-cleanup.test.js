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
import { PartyVoiceCleanup } from '../dist/listeners/PartyVoiceCleanup.js';
import {
  activeParties,
  deleteEmptyParty,
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

async function createParty(t, fetch, maxPlayersOption = null) {
  const channel = voiceChannel();
  let cleanup;
  let reply;
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    assert.equal(delay, 300000);
    cleanup = callback;
    return { unref() {} };
  });
  const guild = {
    id: guildId,
    channels: {
      async create(options) {
        assert.equal(options.name, channel.name);
        assert.equal(options.type, ChannelType.GuildVoice);
        assert.equal(options.userLimit, maxPlayersOption ?? Games.minecraft.maxPlayers);
        return channel;
      },
      fetch,
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
  return { channel, cleanup, reply };
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
  t.mock.method(globalThis, 'setTimeout', () => ({ unref() {} }));
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
  test(`party uses ${maxPlayersOption ?? 'default'} player limit`, async (t) => {
    const { reply } = await createParty(t, async () => null, maxPlayersOption);
    const playerLimit = reply.embeds[0].data.fields.find(
      (field) => field.name === 'Player limit',
    );
    assert.equal(playerLimit.value, label);
  });
}

for (const humanCount of [0, 1]) {
  test(`delayed cleanup force-fetches and checks fresh members (${humanCount} humans)`, async (t) => {
    const fresh = voiceChannel(undefined, humanCount);
    const { channel, cleanup } = await createParty(t, async (id, options) => {
      assert.equal(id, fresh.id);
      assert.deepEqual(options, { force: true });
      return fresh;
    });
    await cleanup();
    assert.equal(channel.deletes, 0);
    assert.equal(fresh.deletes, humanCount ? 0 : 1);
    assert.equal(activeParties.has(fresh.id), Boolean(humanCount));
  });
}

for (const code of [10003, 50013, 'ECONNRESET']) {
  test(`delayed fetch error ${code} retains tracking unless channel is unknown`, async (t) => {
    const log = t.mock.method(console, 'error', () => {});
    const { channel, cleanup } = await createParty(t, async () => {
      throw { code };
    });
    await cleanup();
    assert.equal(activeParties.has(channel.id), code !== 10003);
    assert.equal(log.mock.callCount(), 1);
  });
}

for (const result of ['null', 'text', 'untracked']) {
  test(`delayed cleanup preserves ${result} channels`, async (t) => {
    const fresh = voiceChannel();
    fresh.type = ChannelType.GuildText;
    const { channel, cleanup } = await createParty(t, async () =>
      result === 'null' ? null : fresh,
    );
    if (result === 'untracked') activeParties.delete(channel.id);
    await cleanup();
    assert.equal(fresh.deletes, 0);
    assert.equal(activeParties.has(channel.id), result !== 'untracked');
  });
}

for (const code of [10003, 50013]) {
  test(`voice cleanup handles deletion error ${code} and releases its lock`, async (t) => {
    const channel = voiceChannel();
    activeParties.set(channel.id, party);
    t.mock.method(console, 'error', () => {});
    const failure = t.mock.method(channel, 'delete', async () => {
      throw { code };
    });
    await PartyVoiceCleanup.prototype.run({ channel });
    assert.equal(activeParties.has(channel.id), code !== 10003);
    failure.mock.restore();
    activeParties.set(channel.id, party);
    await PartyVoiceCleanup.prototype.run({ channel });
    assert.equal(channel.deletes, 1);
    assert.equal(activeParties.has(channel.id), false);
  });
}

test('overlapping cleanup paths delete once and keep tracking until deletion completes', async () => {
  const channel = voiceChannel();
  activeParties.set(channel.id, party);
  let finish;
  let calls = 0;
  channel.delete = () => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const pending = deleteEmptyParty(channel);
  await PartyVoiceCleanup.prototype.run({ channel });
  assert.equal(calls, 1);
  assert.ok(activeParties.has(channel.id));
  finish();
  await pending;
  assert.equal(activeParties.has(channel.id), false);
});

test('voice cleanup preserves humans and untracked channels', async () => {
  const occupied = voiceChannel('occupied', 1);
  const untracked = voiceChannel('untracked');
  activeParties.set(occupied.id, party);
  await PartyVoiceCleanup.prototype.run({ channel: occupied });
  await PartyVoiceCleanup.prototype.run({ channel: untracked });
  await PartyVoiceCleanup.prototype.run({ channel: null });
  assert.equal(occupied.deletes + untracked.deletes, 0);
  assert.ok(activeParties.has(occupied.id));
});

test('ready recovery tracks occupied parties, removes empty parties, and preserves unconfirmed channels', async () => {
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
  assert.deepEqual([...activeParties.entries()], [['occupied', party]]);
  assert.deepEqual(
    channels.map((channel) => channel.deletes),
    [0, 1, 0, 0, 0],
  );
  occupied.members.delete('human0');
  await PartyVoiceCleanup.prototype.run({ channel: occupied });
  assert.equal(occupied.deletes, 1);
  assert.equal(activeParties.size, 0);
});

test('ready recovery continues after guild fetch and channel deletion errors', async (t) => {
  t.mock.method(console, 'error', () => {});
  const failed = voiceChannel('failed');
  failed.delete = async () => {
    throw { code: 50013 };
  };
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
                  [failed, empty, tracked].map((channel) => [
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
  assert.ok(activeParties.has(failed.id));
  assert.equal(empty.deletes, 1);
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
