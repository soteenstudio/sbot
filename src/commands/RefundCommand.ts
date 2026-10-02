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
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';

import { randomUUID } from 'node:crypto';
import { subscriptionStore } from '../lib/subscriptionStore.js';
import { coordinateSubscriptionChange } from '../lib/subscriptionCoordinator.js';
import { calculateProportionalRefund } from '../lib/proportionalRefund.js';
import { refundButton, refundRequestEmbed } from '../lib/refundPresentation.js';
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
        try {
          const record = await subscriptionStore.get(
            interaction.guild.id,
            buyer.id,
          );
          if (!record) {
            await fail('No subscription exists for this buyer.');
            return;
          }
          const channelId = process.env.BUY_LOG_CHANNEL;
          const channel = channelId
            ? interaction.guild.channels.cache.get(channelId)
            : undefined;
          if (!channel || channel.type !== ChannelType.GuildText) {
            await fail(
              'Purchase log is unavailable because the staff log channel is not configured.',
            );
            return;
          }
          const frozen = record.pendingRefundId
            ? await subscriptionStore.getRefund(record.pendingRefundId)
            : undefined;
          if (record.pendingRefundId && !frozen)
            throw new Error('Pending refund receipt missing');
          const preview =
            frozen ?? calculateProportionalRefund(record, Date.now());
          const request = await subscriptionStore.createRefundRequest({
            requestId: randomUUID(),
            guildId: record.guildId,
            userId: buyer.id,
            roleId: record.roleId,
            subscriptionId: record.subscriptionId!,
            requestedBy: interaction.user.id,
            requesterTag: interaction.user.tag,
            requestedAt: Date.now(),
            logChannelId: channel.id,
            status: 'logging',
          });
          if (request.logMessageId) {
            if (
              request.status === 'logged' &&
              request.logChannelId === channel.id
            ) {
              const message = await channel.messages.fetch(
                request.logMessageId,
              );
              await message.edit({
                components: [refundButton(request.requestId, false)],
              });
            }
            await interaction.editReply({
              content: `Refund verification is pending. Retry verification on the existing log message: https://discord.com/channels/${request.guildId}/${request.logChannelId}/${request.logMessageId}`,
            });
            return;
          }
          // Send disabled: an unbound message can never execute a cancellation.
          const message = await channel.send({
            embeds: [refundRequestEmbed(request, preview)],
            components: [refundButton(request.requestId, true)],
          });
          await subscriptionStore.bindRefundLog(
            request.requestId,
            channel.id,
            message.id,
          );
          await message.edit({
            components: [refundButton(request.requestId, false)],
          });
          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle('✅ Refund Logged')
                .setDescription(
                  `Successfully logged refund for **${buyer.tag}**. Staff verification is pending in the log channel.`,
                )
                .setColor(EMBED_COLORS.CONFIRMED)
                .setFooter({ text: `${EMBED_FOOTER} • Purchases` })
                .setTimestamp(),
            ],
          });
        } catch (error) {
          console.error('Failed to log refund request:', error);
          await fail(
            (error instanceof Error ? error.message + '. ' : '') +
              'Refund logging did not finish. Retry /refund to recover the log; no subscription was changed.',
          );
        }
      },
    );
  }
}
