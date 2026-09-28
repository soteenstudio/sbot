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
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { container, InteractionHandlerStore } from '@sapphire/framework';
import { ChannelType, MessageFlags } from 'discord.js';
import { PartnerCommand } from '../dist/commands/PartnerCommand.js';
import { PartnerFeedbackHandler } from '../dist/interaction-handlers/PartnerFeedbackHandler.js';
import { PartnerFeedbackSelectHandler } from '../dist/interaction-handlers/PartnerFeedbackSelectHandler.js';
import { PartnerFeedbackModalHandler } from '../dist/interaction-handlers/PartnerFeedbackModalHandler.js';

function setFeedbackChannel(t, value) {
  const previous = process.env.FEEDBACK_CHANNEL;
  process.env.FEEDBACK_CHANNEL = value;
  t.after(() => {
    if (previous === undefined) delete process.env.FEEDBACK_CHANNEL;
    else process.env.FEEDBACK_CHANNEL = previous;
  });
}

function component(kind, customId, userId = 'owner') {
  return {
    customId,
    user: { id: userId, tag: 'Submitter' },
    isButton: () => kind === 'button',
    isAnySelectMenu: () => kind === 'select',
    isStringSelectMenu: () => kind === 'select',
    isModalSubmit: () => kind === 'modal',
  };
}

function handlerStore() {
  container.client = new EventEmitter();
  const errors = [];
  container.client.on('interactionHandlerError', (error) => errors.push(error));
  container.client.on('interactionHandlerParseError', (error) => errors.push(error));
  const store = new InteractionHandlerStore();
  for (const Handler of [PartnerFeedbackHandler, PartnerFeedbackSelectHandler, PartnerFeedbackModalHandler]) {
    const handler = new Handler({ name: Handler.name, path: '', root: '', store }, {});
    store.set(handler.name, handler);
  }
  return { store, errors };
}

function assertPartnerEmbed(embed, mode, expectedMember = 'Member') {
  const { data } = embed;
  assert.equal(data.title, '🎲 Partner Selection');
  assert.equal(data.description, 'A partner has been selected.');
  assert.equal(data.color, 0x0099ff);
  assert.equal(data.footer.text, 'SoTeen Studio | Session ID: wner');
  assert.ok(data.timestamp);
  assert.deepEqual(data.fields.map(({ name, inline }) => ({ name, inline })), [
    { name: 'Partner', inline: true },
    { name: 'Category', inline: true },
    { name: 'Details', inline: false },
  ]);
  if (mode === 'fic') {
    assert.ok(data.fields[0].value);
    assert.match(data.fields[1].value, / Fiction · (Common|Uncommon|Rare|Epic|Mythic|Legendary)$/);
    assert.match(data.fields[2].value, /Draw rate: \d+\.\d%\nSuggestions\? Select Feedback below\.$/);
  } else {
    assert.equal(data.fields[0].value, expectedMember);
    assert.equal(data.fields[1].value, '👤 Server member');
    assert.equal(data.fields[2].value, 'Selected for <@owner>.');
  }
}

for (const mode of ['fic', 'user']) {
  test(`${mode} uses the shared response and collector, leaving feedback for the handler`, async () => {
    let options;
    const listeners = {};
    const events = [];
    let initialPayload;
    const response = {
      createMessageComponentCollector(value) {
        options = value;
        return { on(event, fn) { listeners[event] = fn; } };
      },
    };
    const command = {
      user: { id: 'owner' },
      guild: { members: { fetch: async () => new Map([
        ['member', { user: { bot: false, username: 'Member' } }],
        ['bot', { user: { bot: true, username: 'Bot' } }],
      ]) } },
      reply: async () => assert.fail('both partner modes must use the deferred reply'),
      deferReply: async () => { events.push('defer'); },
      editReply: async (payload) => {
        events.push('edit');
        if (!initialPayload) initialPayload = payload;
        else assert.deepEqual(payload.components, []);
        return response;
      },
    };
    await PartnerCommand.prototype[mode].call(PartnerCommand.prototype, command);
    assert.deepEqual(events, ['defer', 'edit']);
    assertPartnerEmbed(initialPayload.embeds[0], mode);
    assert.equal(initialPayload.components.length, 1);
    const buttons = initialPayload.components[0].components.map(({ data }) => ({
      id: data.custom_id,
      label: data.label,
    }));
    assert.deepEqual(buttons, [
      { id: `roll_again_${mode}`, label: '🎲 Roll Again' },
      { id: 'partner_feedback_btn', label: '💡 Feedback' },
    ]);
    assert.equal(options.time, 60_000);
    const { store, errors } = handlerStore();
    for (const user of ['owner', 'visitor']) {
      const feedback = component('button', 'partner_feedback_btn', user);
      let replies = 0;
      feedback.reply = async (payload) => {
        replies++;
        assert.equal(payload.components[0].components[0].data.custom_id, 'partner_feedback_select');
      };
      assert.equal(options.filter(feedback), false);
      if (options.filter(feedback)) await listeners.collect(feedback);
      assert.equal(await store.run(feedback), true);
      assert.equal(replies, 1);
      const reroll = component('button', `roll_again_${mode}`, user);
      let action;
      reroll.reply = async (payload) => {
        action = 'denied';
        assert.equal(payload.ephemeral, true);
        assert.equal(payload.content, '❌ This partner session belongs to another user.');
      };
      reroll.update = async (payload) => {
        action = 'updated';
        assertPartnerEmbed(payload.embeds[0], mode);
        assert.equal(payload.components[0], initialPayload.components[0]);
      };
      assert.equal(options.filter(reroll), true);
      await listeners.collect(reroll);
      assert.equal(action, user === 'owner' ? 'updated' : 'denied');
      assert.equal(await store.run(reroll), false);
    }
    assert.equal(options.filter(component('button', `roll_again_${mode === 'fic' ? 'user' : 'fic'}`)), false);
    await listeners.end();
    assert.deepEqual(events, ['defer', 'edit', 'edit']);
    assert.deepEqual(errors, []);
  });
}

test('user reroll selects from the members fetched when the session starts', async (t) => {
  const draws = [0, 0.9];
  t.mock.method(Math, 'random', () => draws.shift());
  const members = new Map([
    ['first', { user: { bot: false, username: 'First' } }],
    ['second', { user: { bot: false, username: 'Second' } }],
    ['bot', { user: { bot: true, username: 'Bot' } }],
  ]);
  let fetches = 0;
  let initial;
  let collect;
  const response = {
    createMessageComponentCollector() {
      return { on(event, listener) { if (event === 'collect') collect = listener; } };
    },
  };
  const interaction = {
    user: { id: 'owner' },
    guild: { members: { fetch: async () => { fetches++; return members; } } },
    deferReply: async () => {},
    editReply: async (payload) => { initial = payload; return response; },
  };

  await PartnerCommand.prototype.user.call(PartnerCommand.prototype, interaction);
  assert.equal(initial.embeds[0].data.fields[0].value, 'First');
  let rerolled;
  await collect({
    user: { id: 'owner' },
    update: async (payload) => { rerolled = payload; },
  });
  assertPartnerEmbed(rerolled.embeds[0], 'user', 'Second');
  assert.equal(rerolled.embeds[0].data.fields[0].value, 'Second');
  assert.equal(fetches, 1);
});

for (const category of ['general_feedback', 'new_character']) {
  test(`${category} select and modal dispatch through Sapphire and deliver before confirming`, async (t) => {
    setFeedbackChannel(t, 'staff');
    const { store, errors } = handlerStore();
    const select = component('select', 'partner_feedback_select');
    select.values = [category];
    let modal;
    select.showModal = async (value) => { modal = value; };
    assert.equal(await store.run(select), true);
    assert.equal(modal.data.custom_id, `partner_modal_${category}`);
    const fieldValues = category === 'new_character'
      ? {
          char_name_input: 'Nyoman Sari',
          char_region_input: 'Gianyar, Bali',
          char_culture_input: 'Balinese',
          char_tradition_input: 'Weaving',
          char_desc_input: 'A skilled traditional weaver @everyone',
        }
      : { feedback_input_text: 'My suggestion @everyone' };
    const fieldIds = modal.components.map((row) => row.components[0].data.custom_id);
    assert.deepEqual(fieldIds, Object.keys(fieldValues));
    const expectedDescription = category === 'new_character'
      ? '- **Name**: Nyoman Sari\n- **Region**: Gianyar, Bali\n- **Culture**: Balinese\n- **Tradition**: Weaving\n- **Description**: A skilled traditional weaver @everyone'
      : 'My suggestion @everyone';
    const submission = component('modal', modal.data.custom_id);
    const events = [];
    submission.fields = { getTextInputValue: (id) => {
      assert.ok(Object.hasOwn(fieldValues, id), `unexpected modal field: ${id}`);
      return fieldValues[id];
    } };
    submission.deferReply = async (payload) => {
      events.push('defer');
      assert.equal(payload.flags, MessageFlags.Ephemeral);
    };
    let releaseDelivery;
    const delivery = new Promise((resolve) => { releaseDelivery = resolve; });
    let markSending;
    const sending = new Promise((resolve) => { markSending = resolve; });
    submission.guild = { channels: { fetch: async (id) => {
      assert.equal(id, 'staff');
      return { type: ChannelType.GuildText, send: async (payload) => {
        events.push('send');
        assert.equal(payload.embeds[0].data.description, expectedDescription);
        assert.equal(payload.embeds[0].data.fields[0].value, 'Submitter (owner)');
        assert.match(payload.embeds[0].data.title, category === 'new_character' ? /Character Proposal/ : /Feedback/);
        assert.deepEqual(payload.allowedMentions, { parse: [] });
        markSending();
        await delivery;
      } };
    } } };
    submission.editReply = async (payload) => {
      events.push('confirm');
      assert.match(payload.content, /successfully submitted/);
    };
    const running = store.run(submission);
    await sending;
    assert.deepEqual(events, ['defer', 'send']);
    releaseDelivery();
    assert.equal(await running, true);
    assert.deepEqual(events, ['defer', 'send', 'confirm']);
    assert.deepEqual(errors, []);
    assert.equal(await store.run(component('modal', 'partner_modal_unknown')), false);
    assert.equal(await store.run(component('select', 'unrelated')), false);
  });
}

test('maximum-length new-character submission delivers all five fields in the description', async (t) => {
  setFeedbackChannel(t, 'staff');
  const { store, errors } = handlerStore();
  const select = component('select', 'partner_feedback_select');
  select.values = ['new_character'];
  let modal;
  select.showModal = async (value) => { modal = value; };
  assert.equal(await store.run(select), true);

  const fieldValues = {
    char_name_input: 'N'.repeat(100),
    char_region_input: 'R'.repeat(100),
    char_culture_input: 'C'.repeat(100),
    char_tradition_input: 'T'.repeat(100),
    char_desc_input: 'D'.repeat(1000),
  };
  for (const row of modal.components) {
    const input = row.components[0].data;
    assert.equal(fieldValues[input.custom_id].length, input.max_length);
  }
  const expectedDescription = [
    `- **Name**: ${fieldValues.char_name_input}`,
    `- **Region**: ${fieldValues.char_region_input}`,
    `- **Culture**: ${fieldValues.char_culture_input}`,
    `- **Tradition**: ${fieldValues.char_tradition_input}`,
    `- **Description**: ${fieldValues.char_desc_input}`,
  ].join('\n');

  const submission = component('modal', modal.data.custom_id);
  submission.fields = { getTextInputValue: (id) => {
    assert.ok(Object.hasOwn(fieldValues, id), `unexpected modal field: ${id}`);
    return fieldValues[id];
  } };
  submission.deferReply = async ({ flags }) => assert.equal(flags, MessageFlags.Ephemeral);
  let deliveries = 0;
  submission.guild = { channels: { fetch: async (id) => {
    assert.equal(id, 'staff');
    return { type: ChannelType.GuildText, send: async ({ embeds }) => {
      deliveries++;
      assert.equal(embeds[0].data.description, expectedDescription);
    } };
  } } };
  let confirmation;
  submission.editReply = async ({ content }) => { confirmation = content; };

  assert.equal(await store.run(submission), true);
  assert.equal(deliveries, 1);
  assert.match(confirmation, /successfully submitted/);
  assert.deepEqual(errors, []);
});

for (const failure of ['unconfigured', 'missing', 'wrong type', 'fetch', 'send', 'confirmation']) {
  test(`feedback handles ${failure} failure without false delivery status`, async (t) => {
    setFeedbackChannel(t, failure === 'unconfigured' ? '' : 'staff');
    t.mock.method(console, 'error', () => {});
    const submission = component('modal', 'partner_modal_general_feedback');
    const events = [];
    submission.fields = { getTextInputValue: () => 'Feedback' };
    submission.deferReply = async () => events.push('defer');
    submission.guild = { channels: { fetch: async () => {
      if (failure === 'fetch') throw new Error('Fetch failed');
      if (failure === 'missing') return null;
      return { type: failure === 'wrong type' ? ChannelType.GuildVoice : ChannelType.GuildText, send: async () => {
        if (failure === 'send') throw new Error('Send failed');
        events.push('sent');
      } };
    } } };
    submission.editReply = async (payload) => {
      events.push(payload.content);
      if (failure === 'confirmation') throw new Error('Confirmation failed');
    };
    const running = PartnerFeedbackModalHandler.prototype.run(submission);
    if (failure === 'confirmation') {
      await assert.rejects(running, /Confirmation failed/);
      assert.equal(events.length, 3);
      assert.equal(events[1], 'sent');
      assert.match(events[2], /successfully submitted/);
    } else {
      await running;
      assert.equal(events.length, 2);
      assert.match(events[1], /unavailable|could not be delivered/);
      assert.doesNotMatch(events[1], /successfully submitted/);
    }
  });
}
