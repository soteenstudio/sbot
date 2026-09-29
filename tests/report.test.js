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
import { ChannelType, MessageFlags } from 'discord.js';
import { ReportCommand } from '../dist/commands/ReportCommand.js';
import { ReportHandler } from '../dist/interaction-handlers/ReportHandler.js';
import {
  HONEYPOT_APPEAL_TITLE,
  LEGACY_HONEYPOT_APPEAL_TITLE,
} from '../dist/lib/honeypotAppeal.js';

function reportInteraction() {
  const events = [];
  const channel = {
    type: ChannelType.GuildText,
    async send(payload) {
      events.push(['send', payload]);
    },
  };
  const interaction = {
    options: { getString: (name) => name === 'reason' ? 'Please investigate' : 'other' },
    user: { id: 'reporter', tag: 'Reporter' },
    guild: { channels: { cache: new Map([['reports', channel]]) } },
    replied: false,
    deferred: false,
    async reply(payload) {
      events.push(['reply', payload]);
      this.replied = true;
    },
    async followUp(payload) {
      events.push(['followUp', payload]);
    },
  };
  return { interaction, channel, events };
}

test('a delivered report has an ephemeral confirmation embed and a pending staff message', async () => {
  const previous = process.env.REPORT_CHANNEL;
  process.env.REPORT_CHANNEL = 'reports';
  try {
    const { interaction, events } = reportInteraction();
    await ReportCommand.prototype.chatInputRun(interaction);
    assert.deepEqual(events.map(([name]) => name), ['send', 'reply']);
    const staff = events[0][1];
    assert.equal(staff.embeds[0].data.title, '🚨 New Other Report');
    assert.equal(staff.embeds[0].data.color, 0xffa500);
    assert.equal(staff.embeds[0].data.fields.at(-1).name, 'Status');
    assert.match(staff.embeds[0].data.fields.at(-1).value, /Awaiting staff review/);
    assert.equal(staff.embeds[0].data.footer.text, 'Review this report before taking action.');
    assert.equal(staff.components[0].components[0].data.custom_id, 'report_done_reporter');
    assert.equal(staff.components[0].components[0].data.label, '✅ Mark as Resolved');
    assert.equal(staff.components[0].components[0].data.style, 3);
    const confirmation = events[1][1];
    assert.equal(confirmation.flags, MessageFlags.Ephemeral);
    assert.equal(confirmation.embeds[0].data.title, '✅ Report Submitted');
    assert.match(confirmation.embeds[0].data.description, /sent to the server staff/);
    assert.equal(confirmation.embeds[0].data.color, 0x00ff00);
    assert.equal(confirmation.content, undefined);
  } finally {
    if (previous === undefined) delete process.env.REPORT_CHANNEL;
    else process.env.REPORT_CHANNEL = previous;
  }
});

test('report delivery failure receives delivery feedback', async (t) => {
  t.mock.method(console, 'error', () => {});
  const previous = process.env.REPORT_CHANNEL;
  process.env.REPORT_CHANNEL = 'reports';
  try {
    const { interaction, channel, events } = reportInteraction();
    channel.send = async () => { throw new Error('Delivery failed'); };
    await ReportCommand.prototype.chatInputRun(interaction);
    assert.deepEqual(events.map(([name]) => name), ['reply']);
    assert.match(events[0][1].content, /could not be delivered/);
    assert.equal(events[0][1].flags, MessageFlags.Ephemeral);
  } finally {
    if (previous === undefined) delete process.env.REPORT_CHANNEL;
    else process.env.REPORT_CHANNEL = previous;
  }
});

test('failed confirmation after delivery never claims the report was undelivered', async (t) => {
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args));
  const previous = process.env.REPORT_CHANNEL;
  process.env.REPORT_CHANNEL = 'reports';
  try {
    const { interaction, events } = reportInteraction();
    interaction.reply = async function (payload) {
      events.push(['reply', payload]);
      this.replied = true;
      throw new Error('Confirmation failed');
    };
    await ReportCommand.prototype.chatInputRun(interaction);
    assert.deepEqual(events.map(([name]) => name), ['send', 'reply', 'followUp']);
    assert.match(events[2][1].content, /report was delivered/);
    assert.doesNotMatch(events[2][1].content, /could not be delivered/);
    assert.equal(events[2][1].flags, MessageFlags.Ephemeral);
    assert.match(errors[0][0], /Failed to confirm delivered report/);
  } finally {
    if (previous === undefined) delete process.env.REPORT_CHANNEL;
    else process.env.REPORT_CHANNEL = previous;
  }
});

test('report resolution updates status, disables the existing button, and confirms to staff', async () => {
  const events = [];
  const message = {
    embeds: [{ title: '🚨 New Other Report', fields: [
      { name: 'Reporter', value: 'Reporter (reporter)', inline: true },
      { name: 'Status', value: '⏳ Awaiting staff review' },
    ] }],
    async edit(payload) { events.push(['edit', payload]); },
  };
  const interaction = {
    customId: 'report_done_reporter',
    user: { id: 'staff', tag: 'Staff' },
    message,
    client: { users: { async fetch(id) {
      assert.equal(id, 'reporter');
      return { async send(payload) { events.push(['dm', payload]); } };
    } } },
    async deferReply(payload) { events.push(['deferReply', payload]); },
    async editReply(payload) { events.push(['editReply', payload]); },
  };
  await ReportHandler.prototype.run(interaction);
  assert.deepEqual(events.map(([name]) => name), ['deferReply', 'edit', 'dm', 'editReply']);
  assert.equal(events[0][1].flags, MessageFlags.Ephemeral);
  const updated = events[1][1];
  assert.equal(updated.embeds[0].data.color, 0x00ff00);
  assert.equal(updated.embeds[0].data.fields.filter((field) => field.name === 'Status').length, 1);
  assert.equal(updated.embeds[0].data.fields.at(-1).value, '✅ Resolved by <@staff>');
  assert.equal(updated.embeds[0].data.footer.text, 'Resolved by Staff');
  assert.equal(updated.components[0].components[0].data.custom_id, 'report_done_reporter');
  assert.equal(updated.components[0].components[0].data.label, 'Mark as Resolved');
  assert.equal(updated.components[0].components[0].data.disabled, true);
  assert.equal(events[3][1].embeds[0].data.title, '✅ Report Resolved');
  assert.match(events[3][1].embeds[0].data.description, /marked as resolved/);
  assert.equal(events[3][1].embeds[0].data.color, 0x00ff00);
});

test('existing report buttons stay distinct from current and legacy appeal buttons', () => {
  const handler = { some: () => 'matched', none: () => 'ignored' };
  for (const title of ['🚨 New Other Report', 'Ordinary report', HONEYPOT_APPEAL_TITLE, LEGACY_HONEYPOT_APPEAL_TITLE]) {
    const interaction = { customId: 'report_done_reporter', message: { embeds: [{ title }] } };
    assert.equal(
      ReportHandler.prototype.parse.call(handler, interaction),
      title.includes('Appeal') ? 'ignored' : 'matched',
    );
  }
  assert.equal(ReportHandler.prototype.parse.call(handler, {
    customId: 'report_ban_reporter', message: { embeds: [{ title: 'Ordinary report' }] },
  }), 'ignored');
});
