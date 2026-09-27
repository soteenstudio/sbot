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
import { join } from 'node:path';
import { SapphireClient } from '@sapphire/framework';
import { ChannelType, GatewayIntentBits } from 'discord.js';
import { HoneypotListener } from '../dist/listeners/honeypot.js';
import { HoneypotAppealHandler } from '../dist/interaction-handlers/honeypotAppeal.js';

const runAppeal = (interaction) =>
  HoneypotAppealHandler.prototype.run(interaction);
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
  t.mock.method(console, 'log', () => {});
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args));
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
  return { interaction, events, channel, errors };
}

test('Sapphire loads and routes a DM appeal button to the handler', async (t) => {
  const client = new SapphireClient({
    intents: [GatewayIntentBits.Guilds],
    baseUserDirectory: join(process.cwd(), 'dist'),
  });
  t.after(() => client.destroy());
  client.stores.registerPath(client.options.baseUserDirectory);
  await client.stores.get('interaction-handlers').loadAll();
  await client.stores.get('listeners').loadAll();

  const handlers = client.stores.get('interaction-handlers');
  assert.equal(
    handlers.get('honeypotAppeal')?.location.full,
    join(process.cwd(), 'dist', 'interaction-handlers', 'honeypotAppeal.js'),
  );
  const coreListener = client.stores.get('listeners').get('CoreInteractionCreate');
  assert.ok(coreListener);

  const { interaction, events } = appeal(t);
  Object.assign(interaction, {
    isChatInputCommand: () => false,
    isContextMenuCommand: () => false,
    isAutocomplete: () => false,
    isMessageComponent: () => true,
    isModalSubmit: () => false,
  });
  await coreListener.run(interaction);
  assert.ok(events.includes('deferUpdate'));
  assert.ok(events.includes('send'));
});

test('appeal parse accepts its button and ignores other buttons', () => {
  const parse = HoneypotAppealHandler.prototype.parse;
  const handler = { some: () => 'matched', none: () => 'ignored' };
  assert.equal(parse.call(handler, { customId: 'honeypot_appeal_user_guild' }), 'matched');
  assert.equal(parse.call(handler, { customId: 'report_done_user' }), 'ignored');
});

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

test('failed error response is logged and leaves the appeal available for retry', async (t) => {
  const { interaction, events, channel, errors } = appeal(t);
  const send = channel.send;
  channel.send = async () => {
    throw new Error('Send failed');
  };
  interaction.followUp = async () => {
    throw new Error('Response failed');
  };
  await runAppeal(interaction);
  assert.equal(errors.length, 2);
  assert.match(errors[0][0], /staff-channel delivery/);
  assert.match(errors[1][0], /Failed to respond/);
  assert.deepEqual(interaction.message.components, ['appeal button']);
  channel.send = send;
  await runAppeal({ ...interaction, deferred: false });
  assert.equal(events.filter((event) => event === 'send').length, 1);
});

test('failed acknowledgment and failed fallback reply are both logged', async (t) => {
  const { interaction, events, errors } = appeal(t);
  interaction.deferUpdate = async () => {
    throw new Error('Acknowledgment failed');
  };
  interaction.reply = async () => {
    throw new Error('Reply failed');
  };
  await runAppeal(interaction);
  assert.match(errors[0][0], /acknowledgment/);
  assert.match(errors[1][0], /Failed to respond/);
  assert.deepEqual(interaction.message.components, ['appeal button']);
  assert.equal(events.includes('send'), false);
});

for (const failure of ['configuration', 'send', 'acknowledgment']) {
  test(`appeal ${failure} failure responds appropriately and releases the guard`, async (t) => {
    const { interaction, events, channel, errors } = appeal(t);
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
    if (failure === 'acknowledgment' || failure === 'send') {
      assert.match(
        errors[0][0],
        failure === 'acknowledgment' ? /acknowledgment/ : /staff-channel delivery/,
      );
    }
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
