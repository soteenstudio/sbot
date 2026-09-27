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
import { after, afterEach, test } from 'node:test';
import { join } from 'node:path';
import { SapphireClient } from '@sapphire/framework';
import { ChannelType, GatewayIntentBits, MessageFlags } from 'discord.js';
import { HoneypotListener, pendingHoneypotBans } from '../dist/listeners/honeypot.js';
import { HoneypotSetupListener } from '../dist/listeners/honeypotSetup.js';
import { HoneypotAppealHandler } from '../dist/interaction-handlers/honeypotAppeal.js';

import { HoneypotAppealButtonHandler } from '../dist/interaction-handlers/honeypotAppealButton.js';
import { activeCaptchas, modalOpenTimes, handledAppeals, HONEYPOT_APPEAL_TITLE, LEGACY_HONEYPOT_APPEAL_TITLE } from '../dist/lib/honeypotAppeal.js';

function runAppeal(interaction) {
  activeCaptchas.set('user', { answer: 2, stringCode: 'ABC123' });
  modalOpenTimes.set('user', Date.now() - 4000);
  return HoneypotAppealHandler.prototype.run(interaction);
}

afterEach(() => {
  activeCaptchas.clear();
  modalOpenTimes.clear();
  handledAppeals.clear();
  for (const timer of pendingHoneypotBans.values()) clearTimeout(timer);
  pendingHoneypotBans.clear();
});
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
    isButton: () => false,
    isModalSubmit: () => true,
    customId: 'honeypot_modal_submit_user_guild',
    fields: { getTextInputValue: (id) => id === 'captcha_math' ? '2' : 'ABC123' },
    user: { id: 'user' },
    message: {
      id: String(++nextMessageId),
      components: ['appeal button'],
      async edit(value) {
        events.push(['message.edit', value]);
        this.components = value.components;
      },
    },
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
    async deferReply(value) {
      assert.equal(this.deferred, false);
      this.deferred = true;
      events.push(['deferReply', value]);
    },
    async reply(value) {
      assert.equal(this.replied, false);
      this.replied = true;
      events.push(['reply', value]);
    },
    async editReply(value) {
      assert.equal(this.deferred, true);
      events.push(['editReply', value]);
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
    isButton: () => true,
    customId: 'honeypot_appeal_user_guild',
    async showModal(modal) { events.push(['showModal', modal.toJSON()]); },
  });
  await coreListener.run(interaction);
  assert.equal(events.length, 1);
  assert.equal(events[0][0], 'showModal');
  const modal = events[0][1];
  assert.equal(modal.custom_id, 'honeypot_modal_submit_user_guild');
  assert.equal(modal.title, 'Honeypot Appeal Verification');
  assert.match(modal.components[0].components[0].label, /^What is \d+ \+ \d+\?$/);
  assert.equal(modal.components[0].components[0].placeholder, 'Enter the answer');
  assert.match(modal.components[1].components[0].label, /^Type this code: [A-Z0-9]+$/);
  assert.equal(modal.components[1].components[0].placeholder, 'Enter the code above');
  const captcha = activeCaptchas.get('user');
  assert.ok(captcha);
  assert.ok(modalOpenTimes.has('user'));
  modalOpenTimes.set('user', Date.now() - 4000);
  Object.assign(interaction, {
    customId: modal.custom_id,
    isMessageComponent: () => false,
    isModalSubmit: () => true,
    isButton: () => false,
    fields: { getTextInputValue: (id) => id === 'captcha_math' ? String(captcha.answer) : captcha.stringCode },
  });
  await coreListener.run(interaction);
  assert.ok(events.includes('send'));
  assert.equal(events.at(-1)[0], 'editReply');
  assert.equal(handledAppeals.has('user'), true);

  // Honeypot and ordinary report resolution share a prefix but must route once.
  const staffEvents = [];
  interaction.client.guilds.fetch = async () => ({ members: {
    fetch: async () => ({ timeout: async () => staffEvents.push('timeout'), roles: { add: async () => {} } }),
    ban: async () => staffEvents.push('ban'),
  } });
  for (const [action, title] of [
    ['done', HONEYPOT_APPEAL_TITLE],
    ['ban', HONEYPOT_APPEAL_TITLE],
    ['done', LEGACY_HONEYPOT_APPEAL_TITLE],
    ['ban', LEGACY_HONEYPOT_APPEAL_TITLE],
  ]) {
    handledAppeals.add('user');
    interaction.client.users.fetch = async () => ({
      send: async ({ content }) => {
        assert.match(content, action === 'done' ? /appeal was approved/ : /appeal was rejected/);
        staffEvents.push('dm');
      },
    });
    const staff = {
      ...interaction,
      customId: `report_${action}_user`,
      guildId: 'guild',
      user: { id: 'staff', tag: 'Staff' },
      isMessageComponent: () => true,
      isModalSubmit: () => false,
      isButton: () => true,
      async deferUpdate() { staffEvents.push('deferUpdate'); },
      async deferReply() { assert.fail('General report handler claimed a honeypot report'); },
      message: {
        embeds: [{ title }],
        async edit(value) {
          assert.ok(value.components[0].components.every((button) => button.data.disabled));
          assert.equal(value.embeds[0].data.color, action === 'done' ? 0x00ff00 : 0xff0000);
          assert.match(value.embeds[0].data.fields.at(-1).value, action === 'done' ? /Approved by/ : /Rejected and banned by/);
          assert.match(value.embeds[0].data.footer.text, action === 'done' ? /Approved by Staff/ : /Rejected by Staff/);
          staffEvents.push('edit');
        },
      },
    };
    const start = staffEvents.length;
    await coreListener.run(staff);
    assert.deepEqual(staffEvents.slice(start), action === 'done'
      ? ['deferUpdate', 'timeout', 'dm', 'edit']
      : ['deferUpdate', 'dm', 'ban', 'edit']);
    assert.equal(handledAppeals.has('user'), false);
    const next = appeal(t);
    await runAppeal(next.interaction);
    assert.ok(next.events.includes('send'));
  }

  const ordinary = {
    ...interaction,
    customId: 'report_done_user',
    isMessageComponent: () => true,
    isModalSubmit: () => false,
    isButton: () => true,
    deferred: false,
    message: { embeds: [{ title: 'Ordinary report' }], async edit(value) { assert.deepEqual(value.components, []); } },
  };
  await coreListener.run(ordinary);
  assert.equal(ordinary.deferred, true);
});

test('appeal handlers parse only their own interaction IDs', () => {
  const handler = { some: () => 'matched', none: () => 'ignored' };
  const modalParse = HoneypotAppealHandler.prototype.parse;
  const buttonParse = HoneypotAppealButtonHandler.prototype.parse;
  for (const title of [HONEYPOT_APPEAL_TITLE, LEGACY_HONEYPOT_APPEAL_TITLE, 'Ordinary report']) {
    for (const id of ['honeypot_appeal_user_guild', 'report_done_user', 'report_ban_user', 'honeypot_modal_submit_user_guild', 'unrelated']) {
      const interaction = { customId: id, message: { embeds: [{ title }] } };
      assert.equal(modalParse.call(handler, interaction), id.startsWith('honeypot_modal_submit_') ? 'matched' : 'ignored');
      assert.equal(buttonParse.call(handler, interaction), id === 'honeypot_appeal_user_guild' || (title !== 'Ordinary report' && ['report_done_user', 'report_ban_user'].includes(id)) ? 'matched' : 'ignored');
    }
  }
});

for (const member of [null, { bannable: false }, { bannable: true, roles: { cache: new Map() }, timeout: async () => {} }]) {
  test(`honeypot actions require a bannable member: ${JSON.stringify(member)}`, async (t) => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'error', () => {});
    t.mock.timers.enable({ apis: ['setTimeout'] });
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
            async send(payload) {
              events.push('dm');
              assert.equal(payload.embeds[0].data.title, '⚠️ Honeypot Restriction');
              assert.match(payload.embeds[0].data.description, /banned in 3 hours if you do not submit an appeal/);
              assert.equal(payload.embeds[0].data.color, 0xffa500);
              assert.equal(payload.embeds[0].data.footer.text, 'Submit an appeal within 3 hours.');
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
          member?.bannable ? ['delete', 'dm'] : [],
        );
      }
    }
  });
}

test('DM appeal keeps the button until staff delivery succeeds', async (t) => {
  const { interaction, events, channel } = appeal(t);
  const send = channel.send;
  channel.send = async (...args) => {
    assert.deepEqual(interaction.message.components, ['appeal button']);
    const embed = args[0].embeds[0].data;
    assert.equal(embed.title, HONEYPOT_APPEAL_TITLE);
    assert.match(embed.description, /submitted a honeypot appeal/);
    assert.equal(embed.color, 0xffa500);
    assert.equal(embed.footer.text, 'Review this appeal before taking action.');
    return send(...args);
  };
  await runAppeal(interaction);
  assert.deepEqual(
    events.map((event) => (Array.isArray(event) ? event[0] : event)),
    ['deferReply', 'guild', 'channel', 'user', 'send', 'message.edit', 'editReply'],
  );
  assert.equal(events[0][1].flags, MessageFlags.Ephemeral);
  assert.equal(interaction.message.components[0].components[0].data.disabled, true);
  assert.equal(events.at(-2)[1].components[0].components[0].data.disabled, true);
  assert.match(events.at(-1)[1].content, /submitted to staff/);
  assert.equal(events.at(-1)[1].components, undefined);
});

test('honeypot setup refreshes only bot-owned warning messages', async (t) => {
  t.mock.method(console, 'log', () => {});
  const events = [];
  const unrelated = { author: { id: 'bot' }, embeds: [{ title: 'Another notice' }], async edit() { events.push('unrelated edit'); } };
  const userWarning = { author: { id: 'user' }, embeds: [{ title: '⚠️ Restricted Area / Honeypot' }], async edit() { events.push('user edit'); } };
  const warning = {
    author: { id: 'bot' },
    embeds: [{ title: '⚠️ Restricted Area / Honeypot', description: 'Dilarang keras mengirim pesan apa pun di channel ini!' }],
    async edit(payload) { events.push(['warning edit', payload.embeds[0].data]); this.embeds = [payload.embeds[0].data]; },
  };
  const messages = [unrelated, userWarning, warning];
  const channel = {
    type: ChannelType.GuildText,
    messages: { async fetch() { return messages; } },
    async send(payload) { events.push(['send', payload.embeds[0].data]); },
  };
  const client = { user: { id: 'bot' }, channels: { async fetch() { return channel; } } };
  await HoneypotSetupListener.prototype.run(client);
  assert.deepEqual(events.map((event) => event[0]), ['warning edit']);
  assert.equal(warning.embeds[0].title, '⚠️ Honeypot Channel');
  assert.match(warning.embeds[0].description, /banned after 3 hours/);
  assert.equal(warning.embeds[0].color, 0xff0000);
  assert.equal(warning.embeds[0].footer.text, 'SoTeen Studio • Honeypot');

  await HoneypotSetupListener.prototype.run(client);
  assert.equal(events.length, 1);

  messages.pop();
  await HoneypotSetupListener.prototype.run(client);
  assert.equal(events[1][0], 'send');
  assert.equal(events[1][1].title, '⚠️ Honeypot Channel');
});

test('only the user named in the DM button can submit an appeal', async (t) => {
  const { interaction, events } = appeal(t);
  await runAppeal({ ...interaction, user: { id: 'someone_else' } });
  assert.deepEqual(events.map((event) => event[0]), ['reply']);
  assert.equal(events[0][1].flags, MessageFlags.Ephemeral);
  assert.match(events[0][1].content, /another user/);

  await HoneypotAppealButtonHandler.prototype.run({ ...interaction, customId: 'honeypot_appeal_user_guild', user: { id: 'someone_else' }, replied: false });
  assert.match(events.at(-1)[1].content, /Only the affected user/);
  await runAppeal(interaction);
  assert.equal(events.includes('send'), true);
});

test('appeal verification failures use concise English responses', async (t) => {
  const fast = appeal(t);
  modalOpenTimes.set('user', Date.now());
  await HoneypotAppealHandler.prototype.run(fast.interaction);
  assert.match(fast.events[0][1].content, /Please wait a moment/);
  assert.equal(fast.events[0][1].flags, MessageFlags.Ephemeral);

  const incorrect = appeal(t);
  activeCaptchas.set('user', { answer: 2, stringCode: 'ABC123' });
  modalOpenTimes.set('user', Date.now() - 4000);
  incorrect.interaction.fields.getTextInputValue = () => 'wrong';
  await HoneypotAppealHandler.prototype.run(incorrect.interaction);
  assert.match(incorrect.events[0][1].content, /Check both answers/);
  assert.equal(incorrect.events[0][1].flags, MessageFlags.Ephemeral);
});

test('concurrent and later submissions by the same user send only one appeal', async (t) => {
  const { interaction, events } = appeal(t);
  const duplicate = { ...interaction };
  const { promise, resolve } = Promise.withResolvers();
  const deferReply = interaction.deferReply;
  interaction.deferReply = async function (value) {
    await deferReply.call(this, value);
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
  assert.equal(other.events.includes('send'), false);
});

test('confirmation failure retains the guard and reports successful delivery', async (t) => {
  const { interaction, events } = appeal(t);
  interaction.editReply = async () => {
    throw new Error('Confirmation failed');
  };
  await runAppeal(interaction);
  assert.equal(events.at(-1)[0], 'followUp');
  assert.match(events.at(-1)[1].content, /appeal was submitted/);
  await runAppeal({ ...interaction, deferred: false, replied: false });
  assert.equal(events.filter((event) => event === 'send').length, 1);
});

test('DM button update failure still confirms delivery and blocks duplicate clicks', async (t) => {
  const { interaction, events, errors } = appeal(t);
  interaction.message.edit = async () => {
    throw new Error('DM edit failed');
  };
  await runAppeal(interaction);
  assert.equal(events.filter((event) => event === 'send').length, 1);
  assert.equal(events.at(-1)[0], 'editReply');
  assert.match(events.at(-1)[1].content, /submitted to staff/);
  assert.match(errors[0][0], /Failed to update DM button/);
  assert.deepEqual(interaction.message.components, ['appeal button']);
  await runAppeal({ ...interaction, deferred: false, replied: false });
  assert.equal(events.filter((event) => event === 'send').length, 1);
});

test('failed error response is logged and leaves the appeal available for retry', async (t) => {
  const { interaction, events, channel, errors } = appeal(t);
  const send = channel.send;
  const editReply = interaction.editReply;
  channel.send = async () => {
    throw new Error('Send failed');
  };
  interaction.editReply = async () => {
    throw new Error('Response failed');
  };
  await runAppeal(interaction);
  assert.equal(errors.length, 2);
  assert.match(errors[0][0], /staff-channel delivery/);
  assert.match(errors[1][0], /Failed to respond/);
  assert.deepEqual(interaction.message.components, ['appeal button']);
  channel.send = send;
  await runAppeal({ ...interaction, editReply, deferred: false });
  assert.equal(events.filter((event) => event === 'send').length, 1);
});

test('failed acknowledgment and failed fallback reply are both logged', async (t) => {
  const { interaction, events, errors } = appeal(t);
  interaction.deferReply = async () => {
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
    const deferReply = interaction.deferReply;
    const send = channel.send;
    if (failure === 'configuration') channel.type = ChannelType.GuildVoice;
    if (failure === 'send')
      channel.send = async () => {
        throw new Error('Send failed');
      };
    if (failure === 'acknowledgment')
      interaction.deferReply = async () => {
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
    assert.equal(events.some((event) => event[0] === 'message.edit'), false);
    assert.equal(
      events.at(-1)[0],
      failure === 'acknowledgment' ? 'reply' : 'editReply',
    );
    if (failure === 'acknowledgment')
      assert.equal(events.at(-1)[1].flags, MessageFlags.Ephemeral);
    else assert.doesNotMatch(events.at(-1)[1].content, /submitted to staff/);
    assert.deepEqual(interaction.message.components, ['appeal button']);
    channel.type = ChannelType.GuildText;
    channel.send = send;
    await runAppeal({ ...interaction, deferReply, deferred: false, replied: false });
    assert.equal(events.filter((event) => event === 'send').length, 1);
    assert.equal(interaction.message.components[0].components[0].data.disabled, true);
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
    ['deferReply', 'guild', 'editReply'],
  );
  assert.deepEqual(interaction.message.components, ['appeal button']);
  await runAppeal({ ...interaction, deferred: false });
  assert.equal(events.filter((event) => event === 'send').length, 1);
  assert.equal(interaction.message.components[0].components[0].data.disabled, true);
});

for (const failure of [null, 'configuration', 'lookup', 'send']) {
  test(`ban timer is canceled only after successful staff delivery: ${failure ?? 'success'}`, async (t) => {
    const { interaction, channel } = appeal(t);
    const timer = setTimeout(() => {}, 60_000).unref();
    pendingHoneypotBans.set('user', timer);
    const clear = t.mock.method(globalThis, 'clearTimeout');
    const send = channel.send;
    channel.send = async (...args) => {
      assert.equal(pendingHoneypotBans.get('user'), timer);
      assert.equal(clear.mock.callCount(), 0);
      if (failure === 'send') throw new Error('Delivery failed');
      return send(...args);
    };
    if (failure === 'configuration') channel.type = ChannelType.GuildVoice;
    if (failure === 'lookup') interaction.client.guilds.fetch = async () => { throw new Error('Lookup failed'); };
    await runAppeal(interaction);
    assert.equal(pendingHoneypotBans.has('user'), Boolean(failure));
    assert.equal(handledAppeals.has('user'), !failure);
    assert.equal(clear.mock.callCount(), failure ? 0 : 1);
    if (!failure) assert.equal(clear.mock.calls[0].arguments[0], timer);
  });
}

function trapMessage(fetchGuild) {
  return {
    channelId: 'trap',
    author: { id: 'user', tag: 'User', bot: false, async send() {} },
    member: { bannable: true, roles: { cache: new Map() }, async timeout() {} },
    guild: { id: 'guild', name: 'Guild' },
    client: { guilds: { fetch: fetchGuild } },
    async delete() {},
  };
}

test('repeated honeypot messages replace the timer and only the latest timer bans', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let bans = 0;
  const message = trapMessage(async () => ({ members: { async ban() { bans++; } } }));
  const clear = t.mock.method(globalThis, 'clearTimeout');
  await HoneypotListener.prototype.run(message);
  const first = pendingHoneypotBans.get('user');
  await HoneypotListener.prototype.run(message);
  const second = pendingHoneypotBans.get('user');
  assert.notEqual(first, second);
  assert.equal(clear.mock.calls[0].arguments[0], first);
  t.mock.timers.tick(3 * 60 * 60 * 1000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(bans, 1);
  assert.equal(pendingHoneypotBans.has('user'), false);
});

for (const fails of [false, true]) {
  test(`an older timer finishing cannot remove a replacement timer: ban ${fails ? 'fails' : 'succeeds'}`, async (t) => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'error', () => {});
    const callbacks = [];
    t.mock.method(globalThis, 'setTimeout', (callback) => {
      const timer = { callback };
      callbacks.push(timer);
      return timer;
    });
    t.mock.method(globalThis, 'clearTimeout', () => {});
    const { promise, resolve } = Promise.withResolvers();
    const message = trapMessage(() => promise);
    await HoneypotListener.prototype.run(message);
    const running = callbacks[0].callback();
    await HoneypotListener.prototype.run(message);
    const replacement = callbacks[1];
    resolve({ members: { async ban() { if (fails) throw new Error('Ban failed'); } } });
    await running;
    assert.equal(pendingHoneypotBans.get('user'), replacement);
    await replacement.callback();
    assert.equal(pendingHoneypotBans.has('user'), false);
  });
}
