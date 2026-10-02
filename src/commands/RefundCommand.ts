/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { Subcommand } from '@sapphire/plugin-subcommands';
import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';

import { randomUUID } from 'node:crypto';
import {
  subscriptionStore,
  type RefundReceipt,
} from '../lib/subscriptionStore.js';
import { coordinateSubscriptionChange } from '../lib/subscriptionCoordinator.js';
import { calculateProportionalRefund } from '../lib/proportionalRefund.js';
import { notifyBuyerOfRefund } from '../lib/refundNotification.js';
import { formatSubscriptionMoney } from '../lib/subscriptionPrices.js';
import { EMBED_COLORS, EMBED_FOOTER } from '../engine/SEmbed.js';

export class RefundCommand extends Subcommand {
  public static commandName = 'refund';
  public static commandDescription =
    'Record a subscription refund (Admin Only).';

  public constructor(
    context: Subcommand.LoaderContext,
    options: Subcommand.Options,
  ) {
    super(context, {
      ...options,
      name: RefundCommand.commandName,
      description: RefundCommand.commandDescription,
    });
  }

  public override registerApplicationCommands(registry: Subcommand.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((option) =>
          option
            .setName('buyer')
            .setDescription('The buyer whose subscription to refund')
            .setRequired(true),
        ),
    );
  }

  public async chatInputRun(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        content: '❌ Use /refund in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (
      !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
      await interaction.reply({
        content:
          '❌ Administrator permission is required to refund subscriptions.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const buyer = interaction.options.getUser('buyer', true);
    await coordinateSubscriptionChange(
      interaction.guild.id,
      buyer.id,
      async () => {
        const fail = async (content: string) => {
          await interaction.editReply({ content: '❌ ' + content });
        };
        let receipt: RefundReceipt | undefined;
        let record;
        try {
          record = await subscriptionStore.get(interaction.guild.id, buyer.id);
          receipt = interaction.id
            ? await subscriptionStore.getRefund(
                interaction.guild.id + ':' + interaction.id,
              )
            : undefined;
          receipt ??= record?.pendingRefundId
            ? await subscriptionStore.getRefund(record.pendingRefundId)
            : !record
              ? await subscriptionStore.findRefund(
                  interaction.guild.id,
                  buyer.id,
                )
              : undefined;
          if (record?.pendingRefundId && !receipt)
            throw new Error(
              'Pending refund receipt missing; metadata repair required',
            );
          if (
            receipt?.status === 'pending' &&
            record &&
            receipt.subscriptionId !== record.subscriptionId
          )
            throw new Error('Subscription changed; metadata repair required');
        } catch (error) {
          console.error('Failed to load refund:', error);
          await fail(
            'Failed to load refund recovery state. Repair storage before retrying.',
          );
          return;
        }
        if (receipt?.status === 'completed') {
          await interaction.editReply({
            embeds: [refundConfirmation(receipt)],
          });
          return;
        }
        if (!record) {
          await fail('No subscription exists for this buyer.');
          return;
        }
        let member;
        try {
          member = await interaction.guild.members.fetch(buyer.id);
        } catch (error) {
          console.error('Failed to fetch refund buyer:', error);
          await fail(
            'Buyer is unavailable or no longer in this server. No access changes were made; any pending refund remains recoverable.',
          );
          return;
        }
        if (!member) {
          await fail('Buyer is unavailable or no longer in this server.');
          return;
        }
        if (!receipt) {
          try {
            const refundAt = Date.now();
            const amounts = calculateProportionalRefund(record, refundAt);
            receipt = await subscriptionStore.beginRefund({
              ...amounts,
              refundId: interaction.id
                ? interaction.guild.id + ':' + interaction.id
                : randomUUID(),
              subscriptionId: record.subscriptionId!,
              guildId: record.guildId,
              userId: record.userId,
              roleId: record.roleId,
              refundAt,
              staffId: interaction.user.id,
              staffTag: interaction.user.tag,
              status: 'pending',
            });
          } catch (error) {
            console.error('Failed to prepare refund:', error);
            await fail(
              error instanceof Error
                ? error.message + '. No role was removed.'
                : 'Failed to persist refund. No role was removed.',
            );
            return;
          }
        }
        try {
          if (member.roles.cache.has(receipt.roleId))
            await member.roles.remove(
              receipt.roleId,
              'Subscription cancelled for unused-time refund',
            );
        } catch (error) {
          console.error('Failed to remove refunded subscription role:', error);
          await fail(
            'Refund calculation saved, but role removal failed. Subscription cancellation is pending; retry /refund to resume the same refund.',
          );
          return;
        }
        try {
          receipt = await subscriptionStore.completeRefund(receipt.refundId);
        } catch (error) {
          console.error('Failed to complete refund cancellation:', error);
          await fail(
            'Subscription role is absent, but cancellation could not be saved. The saved refund remains pending; repair storage and retry /refund.',
          );
          return;
        }
        await notifyBuyerOfRefund(member, receipt);
        await interaction.editReply({ embeds: [refundConfirmation(receipt)] });
      },
    );
  }
}

function refundConfirmation(receipt: RefundReceipt) {
  return new EmbedBuilder()
    .setTitle('✅ Refund Recorded')
    .setDescription(
      'Unused subscription time refunded. Subscription cancelled and buyer access removed. Recorded for manual payment; the bot has not transferred funds. The 5% tax does not include inter-bank transfer fees.',
    )
    .setColor(EMBED_COLORS.CONFIRMED)
    .addFields(
      {
        name: 'Gross Refund',
        value: formatSubscriptionMoney(receipt.gross, receipt.currency),
        inline: true,
      },
      {
        name: '5% Deduction',
        value: formatSubscriptionMoney(receipt.tax, receipt.currency),
        inline: true,
      },
      {
        name: 'Net Refund',
        value: formatSubscriptionMoney(receipt.net, receipt.currency),
        inline: true,
      },
      { name: 'Refund Reference', value: receipt.refundId },
    )
    .setFooter({ text: EMBED_FOOTER + ' • Purchases' })
    .setTimestamp(receipt.refundAt);
}
