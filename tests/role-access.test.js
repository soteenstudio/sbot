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
import { Collection } from 'discord.js';
import { Roles } from '../dist/config.js';
import { LFGCommand } from '../dist/commands/lfg-pro.js';
import { activeLFG } from '../dist/lib/lfg-data.js';
import { getLFGSession, restoreLFGSessions } from '../dist/lib/lfgSession.js';
import { meetsRoleLevel } from '../dist/lib/role-utils.js';

const billionRoleId = '123456789012345678';
const richmanRoleId = '234567890123456789';
const hostId = '345678901234567890';

const storageDirectory = await mkdtemp(join(tmpdir(), 'lfg-create-test-'));
process.env.LFG_DATA_FILE = join(storageDirectory, 'sessions.json');
after(() => rm(storageDirectory, { recursive: true, force: true }));

beforeEach(async () => {
  activeLFG.clear();
  await rm(process.env.LFG_DATA_FILE, { force: true });
  Roles.BILLION.id = billionRoleId;
  Roles.RICHMAN.id = richmanRoleId;
});

test('role level accepts API role IDs and cached guild roles', () => {
  assert.equal(meetsRoleLevel({ roles: [billionRoleId] }, 'RICHMAN'), false);
  assert.equal(meetsRoleLevel({ roles: [richmanRoleId] }, 'RICHMAN'), true);
  assert.equal(
    meetsRoleLevel({ roles: { cache: new Collection([[richmanRoleId, {}]]) } }, 'RICHMAN'),
    true,
  );
  assert.equal(meetsRoleLevel(null, 'RICHMAN'), false);
});

function interaction(maxPlayers, roles) {
  let reply;
  return {
    member: { roles },
    options: {
      getString(name) {
        return name === 'game' ? 'mobilelegends' : 'Gold';
      },
      getInteger() {
        return maxPlayers;
      },
    },
    user: { id: hostId, tag: 'host#0001', toString: () => '<@host>' },
    channelId: '456789012345678901',
    async reply(value) {
      reply = value;
      return { id: '567890123456789012' };
    },
    get lastReply() {
      return reply;
    },
  };
}

test('lfg-pro rejects player limit override from a Billion member', async () => {
  const request = interaction(4, [billionRoleId]);
  await LFGCommand.prototype.create(request);
  assert.match(request.lastReply.content, /Richman.*max_players/);
  assert.equal(request.lastReply.ephemeral, true);
  assert.equal(activeLFG.size, 0);
});

test('lfg-pro stores the game label and allows the default player limit', async () => {
  const request = interaction(null, [billionRoleId]);
  await LFGCommand.prototype.create(request);
  assert.equal(activeLFG.get(hostId).game, 'Mobile Legends');
  assert.equal(activeLFG.get(hostId).maxPlayers, 2);
  assert.match(request.lastReply.embeds[0].data.description, /Mobile Legends/);
  assert.equal((await getLFGSession(hostId)).messageId, '567890123456789012');
  activeLFG.clear();
  await restoreLFGSessions();
  assert.equal(activeLFG.get(hostId).rank, 'Gold');
  assert.equal(activeLFG.get(hostId).channelId, '456789012345678901');
});

test('lfg-pro lets Richman set the player limit', async () => {
  const request = interaction(4, [richmanRoleId]);
  await LFGCommand.prototype.create(request);
  assert.equal(activeLFG.get(hostId).maxPlayers, 4);
});

test('lfg-pro list reads persisted sessions after memory is cleared', async () => {
  await LFGCommand.prototype.create(interaction(null, [billionRoleId]));
  activeLFG.clear();
  const reply = await LFGCommand.prototype.list({
    async reply(value) { return value; },
  });
  assert.match(reply.embeds[0].data.description, /Mobile Legends/);
  assert.match(reply.embeds[0].data.description, /host#0001/);
});
