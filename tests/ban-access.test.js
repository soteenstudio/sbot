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
import { PermissionsBitField } from 'discord.js';
import { PartyCommand } from '../dist/commands/party.js';
import { LFGCommand } from '../dist/commands/lfg-pro.js';
import { JoinButtonHandler } from '../dist/interaction-handlers/LFGJoin.js';
import { bannedUsers } from '../dist/lib/ban-data.js';
import { activeLFG } from '../dist/lib/lfg-data.js';
import { activeParties, Games } from '../dist/lib/party-data.js';

const hostId = '123456789012345678';
const targetId = '234567890123456789';
const channelId = '345678901234567890';
const roleId = '456789012345678901';

beforeEach(() => {
  bannedUsers.clear();
  activeParties.clear();
  activeLFG.clear();
  Games.minecraft.roleId = roleId;
});

function banInteraction(target = targetId, guild) {
  return {
    options: { getUser: () => ({ id: target }) },
    guild,
    reply: async (value) => value,
  };
}

test('a ban from lfg-pro blocks both create commands and the join button', async () => {
  await LFGCommand.prototype.ban(banInteraction());
  assert.equal(bannedUsers.has(targetId), true);

  const partyReply = await PartyCommand.prototype.create({
    options: { getString: () => 'minecraft' },
    user: { id: targetId },
    reply: async (value) => value,
  });
  assert.match(partyReply.content, /banned from creating parties/);
  assert.equal(partyReply.ephemeral, true);

  const lfgReply = await LFGCommand.prototype.create({
    options: { getString: () => 'minecraft' },
    user: { id: targetId },
    reply: async (value) => value,
  });
  assert.match(lfgReply.content, /banned from creating premium sessions/);
  assert.equal(lfgReply.ephemeral, true);

  let hostLookups = 0;
  const joinReply = await JoinButtonHandler.prototype.run({
    user: { id: targetId },
    customId: `lfg_pro_join_${hostId}`,
    client: { users: { fetch: async () => hostLookups++ } },
    deferUpdate: async () => {},
    followUp: async (value) => value,
  });
  assert.match(joinReply.content, /banned from joining premium sessions/);
  assert.equal(joinReply.ephemeral, true);
  assert.equal(hostLookups, 0);
});

test('party creation denies banned members even when they have the game role', async (t) => {
  bannedUsers.add(targetId);
  t.mock.method(globalThis, 'setTimeout', () => ({ unref() {} }));
  let created;
  await PartyCommand.prototype.create({
    options: { getString: () => 'minecraft', getInteger: () => null },
    user: { id: hostId },
    guild: {
      id: '567890123456789012',
      channels: {
        create: async (options) => {
          created = options;
          return { id: channelId, toString: () => `<#${channelId}>` };
        },
      },
    },
    deferReply: async () => {},
    editReply: async (value) => value,
  });
  assert.deepEqual(created.permissionOverwrites.at(-1), {
    id: targetId,
    deny: [
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.Connect,
    ],
  });
});

test('party ban and unban update an existing party channel', async () => {
  activeParties.set(channelId, { hostId, gameKey: 'minecraft' });
  const changes = [];
  const channel = {
    isVoiceBased: () => true,
    permissionOverwrites: {
      edit: async (...args) => changes.push(['edit', ...args]),
      delete: async (...args) => changes.push(['delete', ...args]),
    },
  };
  const guild = { channels: { fetch: async () => channel } };

  await PartyCommand.prototype.ban(banInteraction(targetId, guild));
  assert.equal(bannedUsers.has(targetId), true);
  assert.deepEqual(changes[0], [
    'edit',
    targetId,
    { ViewChannel: false, Connect: false },
  ]);

  await PartyCommand.prototype.unban(banInteraction(targetId, guild));
  assert.equal(bannedUsers.has(targetId), false);
  assert.deepEqual(changes[1], ['delete', targetId]);
});

test('banning an lfg-pro host removes their active session', async () => {
  activeLFG.set(targetId, { vcId: channelId });
  let deletions = 0;
  const guild = {
    channels: {
      fetch: async () => ({ delete: async () => deletions++ }),
    },
  };
  await LFGCommand.prototype.ban(banInteraction(targetId, guild));
  assert.equal(deletions, 1);
  assert.equal(activeLFG.has(targetId), false);
});
