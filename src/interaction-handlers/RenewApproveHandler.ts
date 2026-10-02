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
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { Roles } from '../config.js';
import { EMBED_COLORS } from '../engine/SEmbed.js';
import { coordinateSubscriptionChange } from '../lib/subscriptionCoordinator.js';
import {
  subscriptionStore,
  type RenewalApproval,
} from '../lib/subscriptionStore.js';
import { notifyBuyerOfRenewal } from '../lib/purchaseNotification.js';

export class RenewApproveHandler extends InteractionHandler {
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
    return interaction.customId.startsWith('renew_approve_')
      ? this.some()
      : this.none();
  }

  public async run(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) return;
    const allowed =
      interaction.member.permissions.has('Administrator') ||
      [Roles.FOUNDER.id, Roles.DEPUTY.id].some(
        (id) => id && interaction.member.roles.cache.has(id),
      );
    if (!allowed) {
      await interaction.reply({
        content: '❌ You do not have permission to approve this renewal.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const payload =
      /^renew_approve_([0-9]{17,20})_([0-9]{17,20})_(1|6|12)$/.exec(
        interaction.customId,
      );
    if (
      !payload ||
      !process.env.BUY_LOG_CHANNEL ||
      interaction.channelId !== process.env.BUY_LOG_CHANNEL ||
      !interaction.message.id
    ) {
      await interaction.reply({
        content:
          '❌ Invalid renewal request or purchase-log channel. Submit a new /renew request.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const [, userId, roleId, duration] = payload;
    const durationMonths = Number(duration);
    const requestId = `${interaction.guild.id}:${interaction.channelId}:${interaction.message.id}`;
    await interaction.deferUpdate();
    const fail = async (content: string) => {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    };
    await coordinateSubscriptionChange(
      interaction.guild.id,
      userId,
      async () => {
        let receipt: RenewalApproval | undefined;
        let existing;
        try {
          receipt = await subscriptionStore.getRenewalApproval(requestId);
          if (!receipt)
            existing = await subscriptionStore.get(
              interaction.guild.id,
              userId,
            );
        } catch (error) {
          console.error('Failed to load renewal approval:', error);
          await fail(
            '❌ Failed to load the subscription. Try again after storage is restored.',
          );
          return;
        }
        if (!receipt) {
          if (!existing) {
            await fail(
              '❌ No subscription record exists for this buyer. Use /buy first, then submit a new /renew request.',
            );
            return;
          }
          if (existing.roleId !== roleId) {
            await fail(
              '❌ The subscription tier changed since this request. Submit a new /renew request for the current tier.',
            );
            return;
          }
          const approvedAt = Date.now();
          const expiresAt =
            Math.max(existing.expiresAt, approvedAt) +
            durationMonths * 30 * 24 * 60 * 60 * 1000;
          if (
            !Number.isFinite(existing.expiresAt) ||
            existing.expiresAt < 0 ||
            !Number.isSafeInteger(expiresAt)
          ) {
            await fail(
              '❌ The stored subscription expiration is invalid. Repair the subscription record before renewing.',
            );
            return;
          }
          const member = await interaction.guild.members
            .fetch(userId)
            .catch(() => null);
          if (!member) {
            await fail('❌ Buyer is unavailable or no longer in this server.');
            return;
          }
          const role = await interaction.guild.roles
            .fetch(roleId)
            .catch(() => null);
          if (!role) {
            await fail(
              '❌ The stored subscription role is unavailable. Restore the role before renewing.',
            );
            return;
          }
          const needsRestoration = !member.roles.cache.has(roleId);
          if (needsRestoration) {
            try {
              await member.roles.add(
                roleId,
                `Subscription renewed by ${interaction.user.tag}`,
              );
            } catch (error) {
              console.error('Failed to restore subscription role:', error);
              await fail(
                '❌ Failed to restore the subscription role. Check bot permissions/role hierarchy.',
              );
              return;
            }
          }
          const renewed = { ...existing, durationMonths, expiresAt };
          receipt = {
            requestId,
            userId,
            guildId: interaction.guild.id,
            roleId,
            durationMonths,
            expiresAt,
            approvedAt,
            approvedBy: interaction.user.tag,
          };
          try {
            await subscriptionStore.saveRenewalApproval(renewed, receipt);
          } catch (error) {
            console.error('Failed to save subscription renewal:', error);
            await fail(
              needsRestoration
                ? '❌ The subscription role was restored, but the renewal could not be saved. The expiration was not extended; repair storage and retry.'
                : '❌ The renewal could not be saved. The expiration was not extended; repair storage and retry.',
            );
            return;
          }
          await notifyBuyerOfRenewal(member, renewed);
        }

        const embed = EmbedBuilder.from(
          interaction.message.embeds[0] ?? {
            title: 'Subscription Renewal Request',
          },
        ).setColor(EMBED_COLORS.CONFIRMED);
        embed.setFields(
          ...(embed.data.fields ?? []).filter(
            (field) => !['Status', 'Expires'].includes(field.name),
          ),
          {
            name: 'Status',
            value: `✅ Approved by ${receipt.approvedBy} (<t:${Math.floor(receipt.approvedAt / 1000)}:F>)`,
          },
          {
            name: 'Expires',
            value: `<t:${Math.floor(receipt.expiresAt / 1000)}:F>`,
            inline: true,
          },
        );
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(interaction.customId)
            .setEmoji('✅')
            .setLabel('Approve Renewal')
            .setStyle(ButtonStyle.Success)
            .setDisabled(true),
        );
        try {
          await interaction.editReply({ embeds: [embed], components: [row] });
        } catch (error) {
          console.error('Failed to update approved renewal log:', error);
          await fail(
            '❌ The renewal was saved, but the log could not be updated. Retry approval to repair the log; it will not extend the subscription again.',
          );
        }
      },
    );
  }
}
