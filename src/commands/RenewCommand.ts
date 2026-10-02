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
import { EMBED_COLORS, EMBED_FOOTER } from '../engine/SEmbed.js';
import { subscriptionStore } from '../lib/subscriptionStore.js';
import { coordinateSubscriptionChange } from '../lib/subscriptionCoordinator.js';
import { notifyBuyerOfRenewal } from '../lib/purchaseNotification.js';

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
        const needsRestoration = !member.roles.cache.has(existing.roleId);
        if (needsRestoration) {
          try {
            await member.roles.add(
              existing.roleId,
              `Subscription renewed by ${interaction.user.tag}`,
            );
          } catch (error) {
            console.error('Failed to restore subscription role:', error);
            await interaction.editReply({
              content:
                '❌ Failed to restore the subscription role. Check bot permissions/role hierarchy.',
            });
            return;
          }
        }
        const renewed = { ...existing, durationMonths, expiresAt };
        try {
          await subscriptionStore.set(renewed);
        } catch (error) {
          console.error('Failed to save subscription renewal:', error);
          await interaction.editReply({
            content: needsRestoration
              ? '❌ The subscription role was restored, but the renewal could not be saved. The expiration was not extended; repair storage and retry.'
              : '❌ The renewal could not be saved. The expiration was not extended; repair storage and retry.',
          });
          return;
        }
        await notifyBuyerOfRenewal(member, renewed);
        const embed = new EmbedBuilder()
          .setTitle('✅ Subscription Renewed')
          .setDescription(`Renewed the subscription for **${buyer.tag}**.`)
          .setColor(EMBED_COLORS.CONFIRMED)
          .addFields(
            { name: 'Tier Role', value: `<@&${renewed.roleId}>`, inline: true },
            {
              name: 'Added Duration',
              value: `${durationMonths} Month${durationMonths > 1 ? 's' : ''}`,
              inline: true,
            },
            {
              name: 'Expires',
              value: `<t:${Math.floor(expiresAt / 1000)}:F>`,
              inline: true,
            },
          )
          .setFooter({ text: `${EMBED_FOOTER} • Purchases` })
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      },
    );
  }
}
