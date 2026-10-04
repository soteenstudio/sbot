import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlashCommandBuilder, PermissionFlagsBits, Collection } from 'discord.js';
import { container } from '@sapphire/framework';
import { SubscriptionCommand } from '../dist/commands/SubscriptionCommand.js';
import { removeLegacySubscriptionCommands } from '../dist/lib/subscriptionCommandCleanup.js';

test('subscription registration preserves all nested options and permissions', () => {
  let data;
  SubscriptionCommand.prototype.registerApplicationCommands.call(
    { name: 'subscription', description: SubscriptionCommand.commandDescription },
    { registerChatInputCommand(callback) { data = callback(new SlashCommandBuilder()).toJSON(); } },
  );
  assert.equal(data.name, 'subscription');
  assert.equal(data.dm_permission, false);
  assert.equal(data.default_member_permissions, String(PermissionFlagsBits.Administrator));
  assert.deepEqual(data.options.map(({ name, type }) => [name, type]), [['buy', 1], ['renew', 1], ['refund', 1], ['upgrade', 1], ['downgrade', 1]]);
  for (const sub of data.options.slice(3)) {
    assert.deepEqual(sub.options.map(option => [option.name, option.type, option.required]), [['buyer', 6, true], ['role', 3, true], ['duration', 3, true]]);
    assert.deepEqual(sub.options[1].choices, data.options[0].options[1].choices);
    assert.deepEqual(sub.options[2].choices, data.options[1].options[1].choices);
  }
  const durations = (plural) => [1, 6, 12].map(n => ({ name: `${n} Month${plural && n > 1 ? 's' : ''}`, value: String(n) }));
  const buyer = description => ({ name: 'buyer', type: 6, description, required: true });
  const duration = (description, plural) => ({ name: 'duration', type: 3, description, required: true, choices: durations(plural) });
  assert.deepEqual(data.options.slice(0, 3).map(sub => sub.options.map(({ name, type, description, required, choices }) => ({ name, type, description, required, ...(choices ? { choices: choices.map(({ name, value }) => ({ name, value })) } : {}) }))), [
    [buyer('The user who bought the subscription'), { name: 'role', type: 3, description: 'Select subscription tier role', required: true, choices: [{ name: 'Donatur', value: 'DONATUR' }, { name: 'Billion', value: 'BILLION' }, { name: 'Richman', value: 'RICHMAN' }] }, duration('Select subscription duration', false)],
    [buyer('The buyer whose subscription to renew'), duration('Select added subscription duration', true)],
    [buyer('The buyer whose subscription to refund')],
  ]);
});

test('subscription routing maps each subcommand to an existing method', () => {
  container.client = { options: {} };
  const command = new SubscriptionCommand({ name: 'SubscriptionCommand', path: '/tmp/SubscriptionCommand.js', root: '/tmp', store: {} }, {});
  assert.deepEqual(command.options.subcommands.map(({ name, chatInputRun }) => [name, chatInputRun]), [['buy', 'chatInputBuy'], ['renew', 'chatInputRenew'], ['refund', 'chatInputRefund'], ['upgrade', 'chatInputUpgrade'], ['downgrade', 'chatInputDowngrade']]);
  for (const entry of command.options.subcommands) assert.equal(typeof SubscriptionCommand.prototype[entry.chatInputRun], 'function');
});

test('migration deletes only retired global chat-input commands and is repeatable', async () => {
  const deleted = [];
  const commands = new Collection();
  for (const [name, type] of [['buy', 1], ['renew', 1], ['refund', 1], ['subscription', 1], ['buy', 2], ['ping', 1]]) {
    const id = `${name}:${type}`;
    commands.set(id, { name, type, delete: async () => { deleted.push(id); commands.delete(id); } });
  }
  const client = { application: { commands: { fetch: async () => commands } } };
  await removeLegacySubscriptionCommands(client);
  await removeLegacySubscriptionCommands(client);
  assert.deepEqual(deleted, ['buy:1', 'renew:1', 'refund:1']);
});
