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
import fs from 'node:fs';
import os from 'node:os';
import { test } from 'node:test';
import { Collection, MessageFlags, PermissionsBitField } from 'discord.js';
import { StatsCommand } from '../dist/commands/StatsCommand.js';
import { getCPUUsage } from '../dist/utils/getCPUUsage.js';
import { getHumanFriendlyOS } from '../dist/utils/getHumanFriendlyOS.js';

function statsInteraction(show, canBan, events) {
  const members = {
    cache: new Collection(),
    async fetch() {
      events.push('members');
      this.cache.set('human', { user: { bot: false } });
      this.cache.set('bot', { user: { bot: true } });
      return this.cache;
    },
  };
  return {
    options: { getString: () => show },
    appPermissions: new PermissionsBitField(canBan ? ['BanMembers'] : []),
    client: {
      uptime: 1000,
      guilds: { cache: new Collection() },
      ws: { ping: 10 },
      stores: new Map(['commands', 'listeners', 'interaction-handlers'].map((name) => [name, new Map()])),
    },
    guild: {
      name: 'Test guild',
      memberCount: 2,
      createdTimestamp: 1000,
      channels: { cache: new Collection() },
      members,
      bans: { async fetch() {
        assert.equal(canBan, true);
        events.push('bans');
        return new Collection([['banned', {}]]);
      } },
    },
    async deferReply(payload) {
      assert.deepEqual(payload, { flags: MessageFlags.Ephemeral });
      events.push('defer');
    },
    async editReply(payload) {
      assert.equal(payload.flags, undefined);
      events.push('edit');
      this.response = payload;
    },
  };
}

for (const show of [null, 'server', 'bot', 'vps']) {
  for (const canBan of [true, false]) {
    test(`stats ${show ?? 'all'} with BanMembers=${canBan}`, async (t) => {
      const events = [];
      t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
        assert.equal(delay, 1000);
        events.push('cpu');
        callback();
      });
      t.mock.method(os, 'cpus', () => [{ times: { idle: 100, user: 100 } }]);
      t.mock.method(fs, 'statfsSync', () => ({ blocks: 4, bfree: 3, bsize: 1024 ** 3 }));
      const interaction = statsInteraction(show, canBan, events);
      await StatsCommand.prototype.chatInputRun(interaction);
      const includesServer = show === null || show === 'server';
      const includesVps = show === null || show === 'vps';
      assert.deepEqual(events, [
        'defer',
        ...(includesVps ? ['cpu'] : []),
        ...(includesServer ? ['members'] : []),
        ...(includesServer && canBan ? ['bans'] : []),
        'edit',
      ]);
      const fields = interaction.response.embeds[0].data.fields;
      assert.deepEqual(fields.map((field) => field.name), show === null
        ? ['Server', 'Bot', 'VPS (Hosting)']
        : [show === 'vps' ? 'VPS (Hosting)' : show === 'bot' ? 'Bot' : 'Server']);
      if (includesServer) {
        assert.match(fields[0].value, /\*\*Members:\*\* 1\n\*\*Bots:\*\* 1/);
        assert.ok(fields[0].value.includes(`**Total bans:** ${canBan ? '1' : 'N/A'}`));
      }
      if (includesVps) {
        assert.match(fields.at(-1).value, /\*\*Disk Space:\*\* 1\.00 GB\/4\.00 GB \(25\.0%\)/);
      }
    });
  }
}

test('stats displays Unavailable when the disk probe fails', async (t) => {
  t.mock.method(globalThis, 'setTimeout', (callback) => callback());
  t.mock.method(fs, 'statfsSync', () => { throw new Error('Unsupported'); });
  t.mock.method(console, 'error', () => {});
  const interaction = statsInteraction('vps', false, []);
  await StatsCommand.prototype.chatInputRun(interaction);
  const value = interaction.response.embeds[0].data.fields[0].value;
  assert.match(value, /\*\*Disk Space:\*\* Unavailable/);
  assert.doesNotMatch(value, /undefined/);
});

for (const [endTimes, expected] of [
  [{ idle: 100, user: 100 }, 'N/A'],
  [{ idle: 50, user: 50 }, 'N/A'],
  [{ idle: 125, user: 175 }, '75.0%'],
]) {
  test(`CPU sample ${JSON.stringify(endTimes)} yields ${expected}`, async (t) => {
    let calls = 0;
    t.mock.method(os, 'cpus', () => [{ times: calls++ === 0 ? { idle: 100, user: 100 } : endTimes }]);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const usage = getCPUUsage();
    t.mock.timers.tick(1000);
    assert.equal(await usage, expected);
  });
}

for (const [release, expected] of [
  ['4.0.0', 'macOS 10.0 (4.0.0)'],
  ['19.6.0', 'macOS 10.15 (19.6.0)'],
  ['20.0.0', 'macOS 11 (20.0.0)'],
  ['21.0.0', 'macOS 12 (21.0.0)'],
  ['22.0.0', 'macOS 13 (22.0.0)'],
  ['23.0.0', 'macOS 14 (23.0.0)'],
  ['24.0.0', 'macOS 15 (24.0.0)'],
  ['25.0.0', 'macOS 26 (25.0.0)'],
  ['26.0.0', 'Darwin 26.0.0'],
  ['30.0.0', 'Darwin 30.0.0'],
]) {
  test(`Darwin ${release} renders as ${expected}`, (t) => {
    t.mock.method(os, 'type', () => 'Darwin');
    t.mock.method(os, 'release', () => release);
    assert.equal(getHumanFriendlyOS(), expected);
  });
}
