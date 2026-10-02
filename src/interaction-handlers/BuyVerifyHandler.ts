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
import { randomUUID } from 'node:crypto';
import { snapshotPaidPeriod } from '../lib/subscriptionPrices.js';
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
        let existing;
        try {
          existing = await subscriptionStore.get(interaction.guild.id, userId);
        } catch (error) {
          console.error(
            'Failed to load subscription for purchase verification:',
            error,
          );
          await interaction.followUp({
            content:
              '❌ Failed to load the subscription. Try again after storage is restored.',
            ephemeral: true,
          });
          return;
        }
        if (existing?.pendingRefundId) {
          await interaction.followUp({
            content: '❌ Cancellation is pending. Retry /refund first.',
            ephemeral: true,
          });
          return;
        }
        if (existing?.roleId === roleId) {
          await interaction.followUp({
            content:
              '❌ This buyer already has a subscription for this role. Use /renew to extend it.',
            ephemeral: true,
          });
          return;
        }

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

        const startAt = Date.now();
        const expiresAt = startAt + durationMonths * 30 * 24 * 60 * 60 * 1000;
        let period;
        try {
          const tier =
            Object.entries(Roles).find(([, r]) => r.id === roleId)?.[0] ?? '';
          period = snapshotPaidPeriod(tier, durationMonths, startAt, expiresAt);
        } catch (error) {
          await interaction.followUp({
            content:
              '❌ Invalid subscription price configuration. No role was changed.',
            ephemeral: true,
          });
          return;
        }
        const hadRole = member.roles.cache.has(roleId);
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

        try {
          await subscriptionStore.set({
            subscriptionId: randomUUID(),
            paidPeriods: [period],
            paymentHistoryComplete: true,
            userId,
            guildId: interaction.guild.id,
            roleId,
            durationMonths,
            expiresAt,
          });
        } catch (error) {
          console.error(
            'Failed to save subscription for purchase verification:',
            error,
          );
          let rollbackStatus =
            'The buyer already had this role, so it was left unchanged.';
          if (!hadRole) {
            try {
              await member.roles.remove(
                roleId,
                'Purchase verification rollback: subscription save failed',
              );
              rollbackStatus = 'The newly granted role was revoked.';
            } catch (rollbackError) {
              console.error(
                'Failed to roll back purchase role grant:',
                rollbackError,
              );
              rollbackStatus =
                "Failed to remove the newly granted role. Check the buyer's access and remove it manually.";
            }
          }
          await interaction.followUp({
            content: `❌ Failed to save the subscription. ${rollbackStatus} Try again after storage is restored.`,
            ephemeral: true,
          });
          return;
        }

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
