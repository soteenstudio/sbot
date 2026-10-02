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
import { EMBED_COLORS } from '../engine/SEmbed.js';
import { Roles } from '../config.js';
import { getPaymentAmount } from '../lib/subscriptionPrices.js';
import { subscriptionStore } from '../lib/subscriptionStore.js';

export class BuyCommand extends Subcommand {
  public static commandName: string = 'buy';
  public static commandDescription: string =
    'Record a subscription purchase for a buyer (Admin Only).';

  public constructor(
    context: Subcommand.LoaderContext,
    options: Subcommand.Options,
  ) {
    super(context, {
      ...options,
      name: BuyCommand.commandName,
      description: BuyCommand.commandDescription,
    });
  }

  public override registerApplicationCommands(registry: Subcommand.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
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
    );
  }

  public async chatInputRun(
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
        content: '❌ Cancellation is pending. Retry /refund first.',
      });
      return;
    }
    if (existing?.roleId === selectedRole.id) {
      await interaction.editReply({
        content:
          '❌ This buyer already has a subscription for this role. Use /renew to extend it.',
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
      await logChannel.send({ embeds: [embed], components: [row] });
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
}
