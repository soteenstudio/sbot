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
  type SlashCommandStringOption,
  type SlashCommandUserOption,
} from 'discord.js';
import 'dotenv/config';
import { EMBED_COLORS, EMBED_FOOTER } from '../engine/SEmbed.js';
import { Roles } from '../config.js';
import {
  getPaymentAmount,
  formatSubscriptionMoney,
} from '../lib/subscriptionPrices.js';
import { subscriptionStore } from '../lib/subscriptionStore.js';

import {
  calculatePlanChange,
  type PlanChangeDirection,
} from '../lib/proratedPlanChange.js';
import {
  planChangeButton,
  planChangeRequestEmbed,
  planChangeConfirmationEmbed,
} from '../lib/planChangePresentation.js';
import {
  subscriptionPrices,
  type SubscriptionDuration,
} from '../lib/subscriptionPrices.js';
import { PLAN_CHANGE_PENDING } from '../lib/subscriptionStore.js';
import { randomUUID } from 'node:crypto';
import { coordinateSubscriptionChange } from '../lib/subscriptionCoordinator.js';
import { calculateProportionalRefund } from '../lib/proportionalRefund.js';
import { refundButton, refundRequestEmbed } from '../lib/refundPresentation.js';

function buyerOption(description: string) {
  return (option: SlashCommandUserOption) =>
    option.setName('buyer').setDescription(description).setRequired(true);
}
function tierOption(option: SlashCommandStringOption) {
  return option
    .setName('role')
    .setDescription('Select subscription tier role')
    .setRequired(true)
    .addChoices(
      { name: 'Donatur', value: 'DONATUR' },
      { name: 'Billion', value: 'BILLION' },
      { name: 'Richman', value: 'RICHMAN' },
    );
}
function durationOption(description: string, plural = true) {
  return (option: SlashCommandStringOption) =>
    option
      .setName('duration')
      .setDescription(description)
      .setRequired(true)
      .addChoices(
        ...[1, 6, 12].map((n) => ({
          name: `${n} Month${plural && n > 1 ? 's' : ''}`,
          value: String(n),
        })),
      );
}

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
        { name: 'upgrade', chatInputRun: 'chatInputUpgrade' },
        { name: 'downgrade', chatInputRun: 'chatInputDowngrade' },
      ],
    });
  }

  public override registerApplicationCommands(registry: Subcommand.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .setDMPermission(false)
        .addSubcommand((sub) =>
          sub
            .setName('buy')
            .setDescription(
              'Record a subscription purchase for a buyer (Admin Only).',
            )
            .addUserOption(buyerOption('The user who bought the subscription'))
            .addStringOption(tierOption)
            .addStringOption(
              durationOption('Select subscription duration', false),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('renew')
            .setDescription('Renew a buyer subscription (Admin Only).')
            .addUserOption(buyerOption('The buyer whose subscription to renew'))
            .addStringOption(
              durationOption('Select added subscription duration'),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('refund')
            .setDescription('Record a subscription refund (Admin Only).')
            .addUserOption(
              buyerOption('The buyer whose subscription to refund'),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('upgrade')
            .setDescription('Upgrade a buyer subscription (Admin Only).')
            .addUserOption(
              buyerOption('The buyer whose subscription to change'),
            )
            .addStringOption(tierOption)
            .addStringOption(durationOption('Select subscription duration')),
        )
        .addSubcommand((sub) =>
          sub
            .setName('downgrade')
            .setDescription('Downgrade a buyer subscription (Admin Only).')
            .addUserOption(
              buyerOption('The buyer whose subscription to change'),
            )
            .addStringOption(tierOption)
            .addStringOption(durationOption('Select subscription duration')),
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
    if (
      existing?.pendingPlanChangeId ||
      (existing?.subscriptionId &&
        (await subscriptionStore.findActivePlanChange(existing.subscriptionId)))
    ) {
      await interaction.editReply({ content: '❌ ' + PLAN_CHANGE_PENDING });
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
      !interaction.member.roles.cache.has(Roles.STAFF.id) ||
      !interaction.member.roles.cache.has(Roles.DEPUTY_SUBSCRIPTION.id)
    ) {
      await interaction.reply({
        content:
          '❌ Deputy Subscription or Staff role is required to renew subscriptions.',
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
        if (
          existing.pendingPlanChangeId ||
          (existing.subscriptionId &&
            (await subscriptionStore.findActivePlanChange(
              existing.subscriptionId,
            )))
        ) {
          await interaction.editReply({ content: '❌ ' + PLAN_CHANGE_PENDING });
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
      !interaction.member.roles.cache.has(Roles.STAFF.id) ||
      !interaction.member.roles.cache.has(Roles.DEPUTY_SUBSCRIPTION.id)
    ) {
      await interaction.reply({
        content:
          '❌ Deputy Subscription or Staff role is required to refund subscriptions.',
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
          if (
            record.pendingPlanChangeId ||
            (record.subscriptionId &&
              (await subscriptionStore.findActivePlanChange(
                record.subscriptionId,
              )))
          )
            throw new Error(PLAN_CHANGE_PENDING);
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
  public async chatInputUpgrade(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    await this.submitPlanChange(interaction, 'upgrade');
  }
  public async chatInputDowngrade(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    await this.submitPlanChange(interaction, 'downgrade');
  }
  private async submitPlanChange(
    interaction: ChatInputCommandInteraction,
    direction: PlanChangeDirection,
  ): Promise<void> {
    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        content: '❌ Use subscription plan changes in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (
      !interaction.member.roles.cache.has(Roles.STAFF.id) ||
      !interaction.member.roles.cache.has(Roles.DEPUTY_SUBSCRIPTION.id)
    ) {
      await interaction.reply({
        content:
          '❌ Deputy Subscription or Staff role is required to change subscriptions.',
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
        try {
          const channelId = process.env.BUY_LOG_CHANNEL;
          const channel = channelId
            ? interaction.guild.channels.cache.get(channelId)
            : undefined;
          if (!channel || channel.type !== ChannelType.GuildText)
            throw new Error(
              'Purchase log is unavailable because the staff log channel is not configured',
            );
          const record = await subscriptionStore.get(
            interaction.guild.id,
            buyer.id,
          );
          if (!record || record.expiresAt <= Date.now())
            throw new Error('No active subscription exists for this buyer');
          if (record.paymentHistoryComplete !== true || !record.subscriptionId)
            throw new Error(
              'Payment metadata repair required: repair historical payments first',
            );
          if (record.pendingRefundId)
            throw new Error(
              'Cancellation is pending; retry /subscription refund first',
            );
          if (record.pendingPlanChangeId) throw new Error(PLAN_CHANGE_PENDING);
          const roleKey = interaction.options.getString(
            'role',
            true,
          ) as keyof typeof Roles;
          const roleId = Roles[roleKey]?.id;
          if (!roleId) throw new Error('Selected role is not configured');
          const duration = Number(
            interaction.options.getString('duration', true),
          );
          if (![1, 6, 12].includes(duration))
            throw new Error('Choose a duration of 1, 6, or 12 months');
          const quote = calculatePlanChange(
            record,
            roleId,
            duration as SubscriptionDuration,
            direction,
            Date.now(),
          );
          const active = await subscriptionStore.findActivePlanChange(
            record.subscriptionId,
          );
          if (active)
            throw new Error(
              `Plan change already pending; retry the existing log${active.logMessageId ? `: https://discord.com/channels/${active.guildId}/${active.logChannelId}/${active.logMessageId}` : ''}`,
            );
          let request = await subscriptionStore.createPlanChangeRequest({
            id: randomUUID(),
            subscriptionId: record.subscriptionId,
            userId: buyer.id,
            buyerTag: buyer.tag,
            guildId: interaction.guild.id,
            fromRoleId: record.roleId,
            toRoleId: roleId,
            durationMonths: duration as SubscriptionDuration,
            direction,
            requestedBy: interaction.user.id,
            requesterTag: interaction.user.tag,
            requestedAt: quote.at,
            commandChannelId: interaction.channelId,
            announced: false,
            logChannelId: channel.id,
            status: 'logging',
          });
          try {
            const message = await channel.send({
              embeds: [
                planChangeRequestEmbed(
                  request,
                  quote,
                  subscriptionPrices.currency!,
                ),
              ],
              components: [planChangeButton(request.id, true)],
              allowedMentions: { parse: [] },
            });
            request = await subscriptionStore.bindPlanChangeLog(
              request.id,
              channel.id,
              message.id,
            );
            await message.edit({ components: [planChangeButton(request.id)] });
          } catch (error) {
            await subscriptionStore.abortPlanChange(request.id);
            throw new Error(
              'Plan change logging failed; submit a new request. No subscription was changed',
            );
          }
          try {
            await subscriptionStore.saveApprovalOrigin(
              request.id,
              interaction.channelId,
            );
          } catch (error) {
            console.error('Failed to save plan change approval origin:', error);
          }
          await interaction.editReply({
            embeds: [
              planChangeConfirmationEmbed(
                request,
                quote,
                subscriptionPrices.currency!,
              ),
            ],
          });
        } catch (error) {
          console.error('Failed to submit plan change:', error);
          await interaction.editReply({
            content:
              '❌ ' +
              (error instanceof Error
                ? error.message
                : 'Plan change logging failed'),
          });
        }
      },
    );
  }
}
