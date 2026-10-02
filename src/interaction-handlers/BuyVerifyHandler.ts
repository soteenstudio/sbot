/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import {
  InteractionHandler,
  InteractionHandlerTypes,
} from '@sapphire/framework';
import {
  ButtonInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { EMBED_COLORS } from '../engine/SEmbed.js';
import { coordinateSubscriptionChange } from '../lib/subscriptionCoordinator.js';
import { subscriptionStore } from '../lib/subscriptionStore.js';
import { notifyBuyerOfPurchase } from '../lib/purchaseNotification.js';
import { Roles } from '../config.js';

export class BuyVerifyHandler extends InteractionHandler {
  public constructor(
    context: InteractionHandler.LoaderContext,
    options: InteractionHandler.Options,
  ) {
    super(context, {
      ...options,
      interactionHandlerType: InteractionHandlerTypes.Button,
    });
  }

  public override parse(interaction: ButtonInteraction) {
    if (!interaction.customId.startsWith('buy_verify_')) return this.none();
    return this.some();
  }

  public async run(interaction: ButtonInteraction) {
    if (!interaction.inCachedGuild()) return;

    const allowedRoleIds = [Roles.FOUNDER.id, Roles.DEPUTY.id].filter(
      Boolean,
    ) as string[];

    const hasPermission =
      interaction.member.permissions.has('Administrator') ||
      allowedRoleIds.some((roleId) =>
        interaction.member.roles.cache.has(roleId),
      );

    if (!hasPermission) {
      await interaction.reply({
        content: '❌ You do not have permission to verify this purchase.',
        ephemeral: true,
      });
      return;
    }

    const parts = interaction.customId.split('_');
    const userId = parts[2];
    const roleId = parts[3];
    const durationMonths = parseInt(parts[4], 10);

    await interaction.deferUpdate();

    await coordinateSubscriptionChange(
      interaction.guild.id,
      userId,
      async () => {
        const member = await interaction.guild.members
          .fetch(userId)
          .catch(() => null);
        if (!member) {
          await interaction.followUp({
            content: '❌ Buyer is no longer in this server.',
            ephemeral: true,
          });
          return;
        }

        try {
          await member.roles.add(
            roleId,
            `Subscription verified by ${interaction.user.tag}`,
          );
        } catch (error) {
          await interaction.followUp({
            content:
              '❌ Failed to add role to user. Check bot permissions/role hierarchy.',
            ephemeral: true,
          });
          return;
        }

        const existing = await subscriptionStore.get(
          interaction.guild.id,
          userId,
        );
        const now = Date.now();
        const startsAt =
          existing?.roleId === roleId ? Math.max(existing.expiresAt, now) : now;
        const expiresAt = startsAt + durationMonths * 30 * 24 * 60 * 60 * 1000;

        await subscriptionStore.set({
          userId,
          guildId: interaction.guild.id,
          roleId,
          durationMonths,
          expiresAt,
        });

        await notifyBuyerOfPurchase(member, {
          roleId,
          durationMonths,
          expiresAt,
        });

        const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
          .setColor(EMBED_COLORS.CONFIRMED)
          .addFields({
            name: 'Status',
            value: `✅ Verified and granted by ${interaction.user.tag} (<t:${Math.floor(Date.now() / 1000)}:R>)`,
            inline: false,
          });

        const oldActionRow = interaction.message.components[0];
        const newActionRow = new ActionRowBuilder<ButtonBuilder>();

        if (oldActionRow && 'components' in oldActionRow) {
          oldActionRow.components.forEach((component) => {
            if (component.type === 2) {
              const button = ButtonBuilder.from(component)
                .setDisabled(true)
                .setStyle(ButtonStyle.Success);
              newActionRow.addComponents(button);
            }
          });
        }

        await interaction.editReply({
          embeds: [updatedEmbed],
          components: [newActionRow],
        });
      },
    );
  }
}
