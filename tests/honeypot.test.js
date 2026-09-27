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
import { after, test } from 'node:test';
import { ChannelType } from 'discord.js';
import { HoneypotListener } from '../dist/listeners/honeypot.js';
import { HoneypotAppealListener } from '../dist/listeners/honeypotAppeal.js';

const runAppeal = (interaction) =>
  HoneypotAppealListener.prototype.run(interaction);
let nextMessageId = 0;
const originalEnvironment = {
  REPORT_CHANNEL: process.env.REPORT_CHANNEL,
  HONEYPOT_CHANNEL: process.env.HONEYPOT_CHANNEL,
};
process.env.REPORT_CHANNEL = 'reports';
process.env.HONEYPOT_CHANNEL = 'trap';
after(() => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function appeal(t) {
  t.mock.method(console, 'error', () => {});
  const events = [];
  const channel = {
    type: ChannelType.GuildText,
    async send() {
      events.push('send');
    },
  };
  const guild = {
    channels: {
      async fetch() {
        events.push('channel');
        return channel;
      },
    },
  };
  const interaction = {
    isButton: () => true,
    customId: 'honeypot_appeal_user_guild',
    user: { id: 'user' },
    message: { id: String(++nextMessageId), components: ['appeal button'] },
    deferred: false,
    replied: false,
    client: {
      guilds: {
        async fetch() {
          events.push('guild');
          return guild;
        },
      },
      users: {
        async fetch() {
          events.push('user');
          return { tag: 'User' };
        },
      },
    },
    async deferUpdate() {
      assert.equal(this.deferred, false);
      this.deferred = true;
      events.push('deferUpdate');
    },
    async reply(value) {
      assert.equal(this.replied, false);
      this.replied = true;
      events.push(['reply', value]);
    },
    async editReply(value) {
      assert.equal(this.deferred, true);
      events.push(['editReply', value]);
      if (value.components) this.message.components = value.components;
    },
    async followUp(value) {
      assert.equal(this.deferred, true);
      events.push(['followUp', value]);
    },
  };
  return { interaction, events, channel };
}

for (const member of [null, { bannable: false }, { bannable: true }]) {
  test(`honeypot actions require a bannable member: ${JSON.stringify(member)}`, async (t) => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'error', () => {});
    for (const deleteFails of [false, true]) {
      for (const dmFails of [false, true]) {
        const events = [];
        const message = {
          member,
          channelId: 'trap',
          author: {
            id: 'user',
            bot: false,
            tag: 'User',
            async send() {
              events.push('dm');
              if (dmFails) throw new Error('DM closed');
            },
          },
          guild: {
            id: 'guild',
            name: 'Guild',
            members: {
              async ban(id) {
                assert.equal(id, 'user');
                events.push('ban');
              },
            },
          },
          async delete() {
            events.push('delete');
            if (deleteFails) throw new Error('Delete failed');
          },
        };
        await HoneypotListener.prototype.run(message);
        assert.deepEqual(
          events,
          member?.bannable ? ['delete', 'dm', 'ban'] : [],
        );
      }
    }
  });
}

test('DM appeal keeps the button until staff delivery succeeds', async (t) => {
  const { interaction, events } = appeal(t);
  await runAppeal(interaction);
  assert.deepEqual(
    events.map((event) => (Array.isArray(event) ? event[0] : event)),
    ['deferUpdate', 'guild', 'channel', 'user', 'send', 'editReply'],
  );
  assert.deepEqual(interaction.message.components, []);
  assert.deepEqual(events.at(-1)[1].components, []);
});

test('only the user named in the DM button can submit an appeal', async (t) => {
  const { interaction, events } = appeal(t);
  await runAppeal({ ...interaction, user: { id: 'someone_else' } });
  assert.deepEqual(events.map((event) => event[0]), ['reply']);
  assert.equal(events[0][1].ephemeral, true);
  assert.match(events[0][1].content, /Only the banned user/);

  await runAppeal(interaction);
  assert.equal(events.includes('send'), true);
});

test('concurrent and later clicks on the same message send only one appeal', async (t) => {
  const { interaction, events } = appeal(t);
  const duplicate = { ...interaction };
  const { promise, resolve } = Promise.withResolvers();
  const deferUpdate = interaction.deferUpdate;
  interaction.deferUpdate = async function () {
    await deferUpdate.call(this);
    await promise;
  };
  const pending = runAppeal(interaction);
  await runAppeal(duplicate);
  assert.equal(events.includes('guild'), false);
  resolve();
  await pending;
  await runAppeal({ ...interaction, deferred: false, replied: false });
  assert.equal(events.filter((event) => event === 'send').length, 1);
  assert.equal(events.filter((event) => event[0] === 'reply').length, 2);

  const other = appeal(t);
  await runAppeal(other.interaction);
  assert.equal(other.events.includes('send'), true);
});

test('confirmation failure retains the guard and reports successful delivery', async (t) => {
  const { interaction, events } = appeal(t);
  interaction.editReply = async () => {
    throw new Error('Edit failed');
  };
  await runAppeal(interaction);
  assert.equal(events.at(-1)[0], 'followUp');
  assert.match(events.at(-1)[1].content, /appeal was submitted/);
  await runAppeal({ ...interaction, deferred: false, replied: false });
  assert.equal(events.filter((event) => event === 'send').length, 1);
});

for (const failure of ['configuration', 'send', 'acknowledgment']) {
  test(`appeal ${failure} failure responds appropriately and releases the guard`, async (t) => {
    const { interaction, events, channel } = appeal(t);
    const deferUpdate = interaction.deferUpdate;
    const send = channel.send;
    if (failure === 'configuration') channel.type = ChannelType.GuildVoice;
    if (failure === 'send')
      channel.send = async () => {
        throw new Error('Send failed');
      };
    if (failure === 'acknowledgment')
      interaction.deferUpdate = async () => {
        throw new Error('Acknowledgment failed');
      };
    await runAppeal(interaction);
    assert.equal(events.includes('send'), false);
    assert.equal(
      events.at(-1)[0],
      failure === 'acknowledgment' ? 'reply' : 'followUp',
    );
    assert.equal(events.at(-1)[1].ephemeral, true);
    assert.deepEqual(interaction.message.components, ['appeal button']);
    channel.type = ChannelType.GuildText;
    channel.send = send;
    await runAppeal({ ...interaction, deferUpdate, deferred: false, replied: false });
    assert.equal(events.filter((event) => event === 'send').length, 1);
    assert.deepEqual(interaction.message.components, []);
  });
}

test('missing REPORT_CHANNEL keeps the DM button available for retry', async (t) => {
  const { interaction, events } = appeal(t);
  const reportChannel = process.env.REPORT_CHANNEL;
  delete process.env.REPORT_CHANNEL;
  try {
    await runAppeal(interaction);
  } finally {
    process.env.REPORT_CHANNEL = reportChannel;
  }
  assert.deepEqual(
    events.map((event) => (Array.isArray(event) ? event[0] : event)),
    ['deferUpdate', 'guild', 'followUp'],
  );
  assert.deepEqual(interaction.message.components, ['appeal button']);
  await runAppeal({ ...interaction, deferred: false });
  assert.equal(events.filter((event) => event === 'send').length, 1);
  assert.deepEqual(interaction.message.components, []);
});
