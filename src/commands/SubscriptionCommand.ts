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
  EmbedBuilder,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import 'dotenv/config';
import { EMBED_COLORS, EMBED_FOOTER } from '../engine/SEmbed.js';
import { Roles } from '../config.js';
import {
  getPaymentAmount,
  formatSubscriptionMoney,
} from '../lib/subscriptionPrices.js';
import { subscriptionStore } from '../lib/subscriptionStore.js';

import { randomUUID } from 'node:crypto';
import { coordinateSubscriptionChange } from '../lib/subscriptionCoordinator.js';
import { calculateProportionalRefund } from '../lib/proportionalRefund.js';
import { refundButton, refundRequestEmbed } from '../lib/refundPresentation.js';

export class SubscriptionCommand extends Subcommand {
  public static commandName: string = 'subscription';
  public static commandDescription: string = 'Manage member subscriptions.';

  public constructor(
    context: Subcommand.LoaderContext,
    options: Subcommand.Options,
  ) {
    super(context, {
      ...options,
      name: SubscriptionCommand.commandName,
      description: SubscriptionCommand.commandDescription,
      subcommands: [
        { name: 'buy', chatInputRun: 'chatInputBuy' },
        { name: 'renew', chatInputRun: 'chatInputRenew' },
        { name: 'refund', chatInputRun: 'chatInputRefund' },
      ],
    });
  }

  public override registerApplicationCommands(registry: Subcommand.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand((sub) =>
          sub
            .setName('buy')
            .setDescription(
              'Record a subscription purchase for a buyer (Admin Only).',
            )
            .addUserOption((o) =>
              o
                .setName('buyer')
                .setDescription('The user who bought the subscription')
                .setRequired(true),
            )
            .addStringOption((o) =>
              o
                .setName('role')
                .setDescription('Select subscription tier role')
                .setRequired(true)
                .addChoices(
                  { name: 'Donatur', value: 'DONATUR' },
                  { name: 'Billion', value: 'BILLION' },
                  { name: 'Richman', value: 'RICHMAN' },
                ),
            )
            .addStringOption((o) =>
              o
                .setName('duration')
                .setDescription('Select subscription duration')
                .setRequired(true)
                .addChoices(
                  { name: '1 Month', value: '1' },
                  { name: '6 Month', value: '6' },
                  { name: '12 Month', value: '12' },
                ),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('renew')
            .setDescription('Renew a buyer subscription (Admin Only).')
            .addUserOption((option) =>
              option
                .setName('buyer')
                .setDescription('The buyer whose subscription to renew')
                .setRequired(true),
            )
            .addStringOption((option) =>
              option
                .setName('duration')
                .setDescription('Select added subscription duration')
                .setRequired(true)
                .addChoices(
                  { name: '1 Month', value: '1' },
                  { name: '6 Months', value: '6' },
                  { name: '12 Months', value: '12' },
                ),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('refund')
            .setDescription('Record a subscription refund (Admin Only).')
            .addUserOption((option) =>
              option
                .setName('buyer')
                .setDescription('The buyer whose subscription to refund')
                .setRequired(true),
            ),
        ),
    );
  }

  public async chatInputBuy(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const buyer = interaction.options.getUser('buyer', true);
    const roleKey = interaction.options.getString(
      'role',
      true,
    ) as keyof typeof Roles;
    const durationMonths = parseInt(
      interaction.options.getString('duration', true),
      10,
    );

    const selectedRole = Roles[roleKey];
    if (!selectedRole || !selectedRole.id) {
      await interaction.reply({
        content:
          '❌ Selected role is not properly configured in environment variables.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let existing;
    try {
      existing = await subscriptionStore.get(interaction.guildId!, buyer.id);
    } catch (error) {
      console.error('Failed to load subscription for purchase:', error);
      await interaction.editReply({
        content:
          '❌ Failed to load the subscription. Try again after storage is restored.',
      });
      return;
    }
    if (existing?.pendingRefundId) {
      await interaction.editReply({
        content:
          '❌ Cancellation is pending. Retry /subscription refund first.',
      });
      return;
    }
    if (existing?.roleId === selectedRole.id) {
      await interaction.editReply({
        content:
          '❌ This buyer already has a subscription for this role. Use /subscription renew to extend it.',
      });
      return;
    }

    const logChannelId = process.env.BUY_LOG_CHANNEL;
    const logChannel = logChannelId
      ? interaction.guild?.channels.cache.get(logChannelId)
      : undefined;

    if (!logChannel || logChannel.type !== ChannelType.GuildText) {
      await interaction.editReply({
        content:
          '❌ Purchase log is unavailable because the staff log channel is not configured.',
      });
      return;
    }

    let payment;
    try {
      payment = getPaymentAmount(selectedRole.id, durationMonths);
    } catch (error) {
      await interaction.editReply({
        content: `❌ Unable to determine amount to pay: ${error instanceof Error ? error.message : 'Invalid subscription price configuration'}. No log was posted.`,
      });
      return;
    }

    const durationText = `${durationMonths} Month${durationMonths > 1 ? 's' : ''}`;

    const embed = new EmbedBuilder()
      .setTitle('🛒 New Subscription Purchase')
      .setDescription(
        'A new subscription purchase is waiting for admin verification. Amount to Pay is an estimate using dummy test prices; approval uses the price at approval time. Recorded for manual payment; the bot does not take payment.',
      )
      .addFields(
        { name: 'Buyer', value: `${buyer.tag} (${buyer.id})`, inline: true },
        { name: 'Tier Role', value: `<@&${selectedRole.id}>`, inline: true },
        { name: 'Duration', value: durationText, inline: true },
        { name: 'Amount to Pay', value: payment.text, inline: true },
        {
          name: 'Processed By',
          value: `${interaction.user.tag}`,
          inline: true,
        },
      )
      .setColor(EMBED_COLORS.WARNING)
      .setFooter({
        text: 'Click verify to grant role and schedule expiration.',
      })
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          `buy_verify_${buyer.id}_${selectedRole.id}_${durationMonths}`,
        )
        .setEmoji('✅')
        .setLabel('Verify & Grant')
        .setStyle(ButtonStyle.Success),
    );

    try {
      const message = await logChannel.send({
        embeds: [embed],
        components: [row],
      });
      try {
        await subscriptionStore.saveApprovalOrigin(
          `${interaction.guildId ?? interaction.guild!.id}:${logChannelId}:${message.id}`,
          interaction.channelId,
        );
      } catch (error) {
        console.error('Failed to save buy approval origin:', error);
      }
    } catch (error) {
      console.error('Failed to send purchase log:', error);
      await interaction.editReply({
        content: '❌ Failed to send log message to staff channel.',
      });
      return;
    }

    const confirmation = new EmbedBuilder()
      .setTitle('✅ Purchase Logged')
      .setDescription(
        `Successfully logged purchase for **${buyer.tag}**. Staff can verify it in the log channel.\n\n**Amount to Pay (estimate): ${payment.text}**. Dummy test prices; approval uses the price at approval time. Recorded for manual payment; the bot does not take payment.`,
      )
      .setColor(EMBED_COLORS.CONFIRMED)
      .setFooter({ text: 'SoTeen Studio • Purchases' })
      .setTimestamp();

    await interaction.editReply({ embeds: [confirmation] });
  }

  public async chatInputRenew(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        content: '❌ Use /subscription renew in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (
      !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
      await interaction.reply({
        content:
          '❌ Administrator permission is required to renew subscriptions.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const buyer = interaction.options.getUser('buyer', true);
    const durationMonths = Number(
      interaction.options.getString('duration', true),
    );
    if (![1, 6, 12].includes(durationMonths)) {
      await interaction.editReply({
        content: '❌ Choose a duration of 1, 6, or 12 months.',
      });
      return;
    }

    await coordinateSubscriptionChange(
      interaction.guild.id,
      buyer.id,
      async () => {
        let existing;
        try {
          existing = await subscriptionStore.get(
            interaction.guild.id,
            buyer.id,
          );
        } catch (error) {
          console.error('Failed to load subscription for renewal:', error);
          await interaction.editReply({
            content:
              '❌ Failed to load the subscription. Try again after storage is restored.',
          });
          return;
        }
        if (!existing) {
          await interaction.editReply({
            content:
              '❌ No subscription record exists for this buyer. Use /subscription buy to grant a subscription first.',
          });
          return;
        }
        if (existing.pendingRefundId) {
          await interaction.editReply({
            content:
              '❌ Cancellation is pending. Retry /subscription refund first.',
          });
          return;
        }
        const expiresAt =
          Math.max(existing.expiresAt, Date.now()) +
          durationMonths * 30 * 24 * 60 * 60 * 1000;
        if (
          !Number.isFinite(existing.expiresAt) ||
          existing.expiresAt < 0 ||
          !Number.isSafeInteger(expiresAt)
        ) {
          await interaction.editReply({
            content:
              '❌ The stored subscription expiration is invalid. Repair the subscription record before renewing.',
          });
          return;
        }
        const member = await interaction.guild.members
          .fetch(buyer.id)
          .catch(() => null);
        if (!member) {
          await interaction.editReply({
            content: '❌ Buyer is unavailable or no longer in this server.',
          });
          return;
        }
        const role = await interaction.guild.roles
          .fetch(existing.roleId)
          .catch(() => null);
        if (!role) {
          await interaction.editReply({
            content:
              '❌ The stored subscription role is unavailable. Restore the role before renewing.',
          });
          return;
        }
        const logChannelId = process.env.BUY_LOG_CHANNEL;
        const logChannel = logChannelId
          ? interaction.guild.channels.cache.get(logChannelId)
          : undefined;
        if (!logChannel || logChannel.type !== ChannelType.GuildText) {
          await interaction.editReply({
            content:
              '❌ Purchase log is unavailable because the staff log channel is not configured.',
          });
          return;
        }
        let payment;
        try {
          payment = getPaymentAmount(existing.roleId, durationMonths);
        } catch (error) {
          await interaction.editReply({
            content: `❌ Unable to determine amount to pay: ${error instanceof Error ? error.message : 'Invalid subscription price configuration'}. No log was posted.`,
          });
          return;
        }

        const embed = new EmbedBuilder()
          .setTitle('🔄 Subscription Renewal Request')
          .setDescription(
            'A subscription renewal is waiting for staff approval. Amount to Pay is an estimate using dummy test prices; approval uses the price at approval time. Recorded for manual payment; the bot does not take payment.',
          )
          .setColor(EMBED_COLORS.WARNING)
          .addFields(
            {
              name: 'Buyer',
              value: `${buyer.tag} (${buyer.id})`,
              inline: true,
            },
            {
              name: 'Tier Role',
              value: `<@&${existing.roleId}>`,
              inline: true,
            },
            {
              name: 'Added Duration',
              value: `${durationMonths} Month${durationMonths > 1 ? 's' : ''}`,
              inline: true,
            },
            { name: 'Amount to Pay', value: payment.text, inline: true },
            { name: 'Requested By', value: interaction.user.tag, inline: true },
            { name: 'Status', value: '⏳ Pending approval' },
          )
          .setFooter({ text: `${EMBED_FOOTER} • Purchases` })
          .setTimestamp();
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(
              `renew_approve_${buyer.id}_${existing.roleId}_${durationMonths}${existing.subscriptionId ? `_${existing.subscriptionId}` : ''}`,
            )
            .setEmoji('✅')
            .setLabel('Approve Renewal')
            .setStyle(ButtonStyle.Success),
        );
        try {
          const message = await logChannel.send({
            embeds: [embed],
            components: [row],
          });
          try {
            await subscriptionStore.saveApprovalOrigin(
              `${interaction.guildId ?? interaction.guild!.id}:${logChannelId}:${message.id}`,
              interaction.channelId,
            );
          } catch (error) {
            console.error('Failed to save renew approval origin:', error);
          }
        } catch (error) {
          console.error('Failed to send renewal request:', error);
          await interaction.editReply({
            content:
              '❌ Failed to send renewal request to staff channel. The subscription was not changed.',
          });
          return;
        }
        const confirmation = new EmbedBuilder()
          .setTitle('✅ Renewal Logged')
          .setDescription(
            `Successfully logged renewal for **${buyer.tag}**. The renewal is awaiting staff approval in the log channel.\n\n**Amount to Pay (estimate): ${payment.text}**. Dummy test prices; approval uses the price at approval time. Recorded for manual payment; the bot does not take payment.`,
          )
          .setColor(EMBED_COLORS.CONFIRMED)
          .setFooter({ text: 'SoTeen Studio • Purchases' })
          .setTimestamp();

        await interaction.editReply({ embeds: [confirmation] });
      },
    );
  }

  public async chatInputRefund(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        content: '❌ Use /subscription refund in a server.',
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
            commandChannelId: interaction.channelId,
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
          const description = `Successfully logged refund for **${buyer.tag}**. Staff verification is pending in the log channel.

Amounts are estimates; verification recalculates the refund from remaining time at verification. The refund is recorded for manual payment; the bot does not transfer funds. Prices are dummy test prices. The 5% tax does not include inter-bank transfer fees.`;
          let confirmation;
          try {
            confirmation = new EmbedBuilder()
              .setTitle('✅ Refund Logged')
              .setDescription(description)
              .addFields(
                {
                  name: 'Estimated Gross Refund',
                  value: formatSubscriptionMoney(
                    preview.gross,
                    preview.currency,
                  ),
                  inline: true,
                },
                {
                  name: 'Estimated 5% Deduction',
                  value: formatSubscriptionMoney(preview.tax, preview.currency),
                  inline: true,
                },
                {
                  name: 'Estimated Net Refund',
                  value: formatSubscriptionMoney(preview.net, preview.currency),
                  inline: true,
                },
              )
              .setColor(EMBED_COLORS.CONFIRMED)
              .setFooter({ text: `${EMBED_FOOTER} • Purchases` })
              .setTimestamp();
          } catch (error) {
            console.error('Failed to build refund confirmation:', error);
          }
          await interaction.editReply(
            confirmation
              ? { embeds: [confirmation] }
              : { content: `✅ Refund Logged\n${description}` },
          );
        } catch (error) {
          console.error('Failed to log refund request:', error);
          await fail(
            (error instanceof Error ? error.message + '. ' : '') +
              'Refund logging did not finish. Retry /subscription refund to recover the log; no subscription was changed.',
          );
        }
      },
    );
  }
}
