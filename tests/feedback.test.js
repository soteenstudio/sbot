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
import { test } from 'node:test';
import { join } from 'node:path';
import { SapphireClient, InteractionHandlerTypes } from '@sapphire/framework';
import { ChannelType, GatewayIntentBits, MessageFlags } from 'discord.js';
import { FeedbackCommand } from '../dist/commands/FeedbackCommand.js';
import { FeedbackButtonHandler } from '../dist/interaction-handlers/FeedbackButtonHandler.js';

function feedbackInteraction(t) {
  const previous = process.env.FEEDBACK_CHANNEL;
  process.env.FEEDBACK_CHANNEL = 'feedback';
  t.after(() => {
    if (previous === undefined) delete process.env.FEEDBACK_CHANNEL;
    else process.env.FEEDBACK_CHANNEL = previous;
  });
  const events = [];
  const channel = {
    type: ChannelType.GuildText,
    async send(payload) { events.push(['send', payload]); },
  };
  const interaction = {
    options: { getString: (name) => name === 'content' ? 'Add more events' : 'suggestion' },
    user: { id: 'author', tag: 'Author' },
    guild: { channels: { cache: new Map([['feedback', channel]]) } },
    async deferReply(payload) { events.push(['deferReply', payload]); },
    async editReply(payload) { events.push(['editReply', payload]); },
    async reply(payload) { events.push(['reply', payload]); },
  };
  return { interaction, channel, events };
}

test('feedback defers ephemerally before delivery and edits its confirmation', async (t) => {
  const { interaction, events } = feedbackInteraction(t);
  await FeedbackCommand.prototype.chatInputRun(interaction);
  assert.deepEqual(events.map(([name]) => name), ['deferReply', 'send', 'editReply']);
  assert.equal(events[0][1].flags, MessageFlags.Ephemeral);
  const staff = events[1][1];
  assert.equal(staff.embeds[0].data.description, 'Add more events');
  assert.equal(staff.embeds[0].data.fields.at(-1).value, '⏳ Awaiting review');
  assert.equal(staff.components[0].components[0].data.custom_id, 'feedback_done_author');
  assert.equal(events[2][1].embeds[0].data.title, '✅ Feedback Submitted');
});

test('feedback delivery failure edits the deferred response', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { interaction, channel, events } = feedbackInteraction(t);
  channel.send = async () => {
    events.push(['send']);
    throw new Error('Delivery failed');
  };
  await FeedbackCommand.prototype.chatInputRun(interaction);
  assert.deepEqual(events.map(([name]) => name), ['deferReply', 'send', 'editReply']);
  assert.equal(events[0][1].flags, MessageFlags.Ephemeral);
  assert.match(events[2][1].content, /could not be delivered/);
});

test('failed feedback confirmation retries editing without claiming delivery failed', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { interaction, events } = feedbackInteraction(t);
  interaction.editReply = async (payload) => {
    events.push(['editReply', payload]);
    if (payload.embeds?.length) throw new Error('Confirmation failed');
  };
  await FeedbackCommand.prototype.chatInputRun(interaction);
  assert.deepEqual(events.map(([name]) => name), ['deferReply', 'send', 'editReply', 'editReply']);
  assert.match(events[3][1].content, /feedback was delivered/);
  assert.deepEqual(events[3][1].embeds, []);
});

test('unconfigured feedback channel responds immediately without sending', async (t) => {
  const { interaction, events } = feedbackInteraction(t);
  interaction.guild.channels.cache.clear();
  await FeedbackCommand.prototype.chatInputRun(interaction);
  assert.deepEqual(events.map(([name]) => name), ['reply']);
  assert.equal(events[0][1].ephemeral, true);
  assert.match(events[0][1].content, /not configured/);
});

test('review button acknowledges and updates the clicked message, preserving feedback', async (t) => {
  const { interaction, events } = feedbackInteraction(t);
  await FeedbackCommand.prototype.chatInputRun(interaction);
  const original = events[1][1].embeds[0].toJSON();
  const updates = [];
  await FeedbackButtonHandler.prototype.run({
    customId: 'feedback_done_author',
    user: { id: 'staff' },
    message: { embeds: [original] },
    async deferUpdate() { updates.push(['deferUpdate']); },
    async editReply(payload) { updates.push(['editReply', payload]); },
  });
  assert.deepEqual(updates.map(([name]) => name), ['deferUpdate', 'editReply']);
  const updated = updates[1][1];
  const embed = updated.embeds[0].toJSON();
  assert.equal(embed.description, original.description);
  assert.equal(embed.title, original.title);
  assert.deepEqual(embed.fields.slice(0, -1), original.fields.slice(0, -1));
  assert.equal(embed.fields.filter((field) => field.name === 'Status').length, 1);
  assert.equal(embed.fields.at(-1).value, '✅ Reviewed by <@staff>');
  assert.equal(embed.color, 0x00ff00);
  const button = updated.components[0].components[0].data;
  assert.equal(button.custom_id, 'feedback_done_author');
  assert.equal(button.disabled, true);
  assert.equal(button.label, 'Reviewed');
});

test('Sapphire registers the feedback button handler and routes only its prefix', async (t) => {
  const sapphire = new SapphireClient({
    intents: [GatewayIntentBits.Guilds],
    baseUserDirectory: join(process.cwd(), 'dist'),
  });
  t.after(() => sapphire.destroy());
  sapphire.stores.registerPath(sapphire.options.baseUserDirectory);
  const store = sapphire.stores.get('interaction-handlers');
  await store.loadAll();
  const handler = store.get('FeedbackButtonHandler');
  assert.ok(handler);
  assert.equal(handler.interactionHandlerType, InteractionHandlerTypes.Button);
  assert.equal(handler.parse({ customId: 'feedback_done_author' }).isSome(), true);
  for (const customId of ['partner_feedback_btn', 'report_done_author', 'feedback_other_author']) {
    assert.equal(handler.parse({ customId }).isNone(), true);
  }
});
