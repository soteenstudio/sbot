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
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { EMBED_COLORS, EMBED_FOOTER } from '../engine/SEmbed.js';
import { subscriptionStore } from '../lib/subscriptionStore.js';
import { coordinateSubscriptionChange } from '../lib/subscriptionCoordinator.js';

export class RenewCommand extends Subcommand {
  public static commandName = 'renew';
  public static commandDescription = 'Renew a buyer subscription (Admin Only).';

  public constructor(
    context: Subcommand.LoaderContext,
    options: Subcommand.Options,
  ) {
    super(context, {
      ...options,
      name: RenewCommand.commandName,
      description: RenewCommand.commandDescription,
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
    );
  }

  public async chatInputRun(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        content: '❌ Use /renew in a server.',
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
              '❌ No subscription record exists for this buyer. Use /buy to grant a subscription first.',
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
        const embed = new EmbedBuilder()
          .setTitle('🔄 Subscription Renewal Request')
          .setDescription(
            'A subscription renewal is waiting for staff approval.',
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
            { name: 'Requested By', value: interaction.user.tag, inline: true },
            { name: 'Status', value: '⏳ Pending approval' },
          )
          .setFooter({ text: `${EMBED_FOOTER} • Purchases` })
          .setTimestamp();
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(
              `renew_approve_${buyer.id}_${existing.roleId}_${durationMonths}`,
            )
            .setLabel('Approve Renewal')
            .setStyle(ButtonStyle.Success),
        );
        try {
          await logChannel.send({ embeds: [embed], components: [row] });
        } catch (error) {
          console.error('Failed to send renewal request:', error);
          await interaction.editReply({
            content:
              '❌ Failed to send renewal request to staff channel. The subscription was not changed.',
          });
          return;
        }
        await interaction.editReply({
          content: `✅ Renewal for **${buyer.tag}** is awaiting approval in the purchase-log channel.`,
        });
      },
    );
  }
}
