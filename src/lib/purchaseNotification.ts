/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { EmbedBuilder, type GuildMember } from 'discord.js';
import { Roles } from '../config.js';
import { EMBED_COLORS, EMBED_FOOTER } from '../engine/SEmbed.js';
import type { SubscriptionRecord } from './subscriptionStore.js';

export async function notifyBuyerOfPurchase(
  member: GuildMember,
  purchase: Pick<
    SubscriptionRecord,
    'roleId' | 'durationMonths' | 'expiresAt'
  > & {
    amountText?: string;
  },
): Promise<void> {
  await notifyBuyer(member, purchase, false);
}

export async function notifyBuyerOfRenewal(
  member: GuildMember,
  purchase: Pick<
    SubscriptionRecord,
    'roleId' | 'durationMonths' | 'expiresAt'
  > & {
    amountText?: string;
  },
): Promise<void> {
  await notifyBuyer(member, purchase, true);
}

async function notifyBuyer(
  member: GuildMember,
  purchase: Pick<
    SubscriptionRecord,
    'roleId' | 'durationMonths' | 'expiresAt'
  > & {
    amountText?: string;
  },
  renewal: boolean,
): Promise<void> {
  try {
    const tierName =
      member.guild.roles.cache.get(purchase.roleId)?.name ??
      Object.entries(Roles).find(
        ([, role]) => role.id === purchase.roleId,
      )?.[0] ??
      'Subscription';
    const embed = new EmbedBuilder()
      .setTitle(
        renewal
          ? '✅ Your Subscription Has Been Renewed'
          : '✅ Your Purchase Has Been Granted',
      )
      .setColor(EMBED_COLORS.CONFIRMED)
      .setDescription(
        (renewal
          ? 'Your subscription renewal has been saved and your access extended.'
          : 'Your subscription purchase has been verified and granted.') +
          '\n\nRecorded for manual payment; the bot does not take payment.',
      )
      .addFields(
        { name: 'Server', value: member.guild.name, inline: true },
        { name: 'Subscription Tier', value: tierName, inline: true },
        {
          name: renewal ? 'Added Duration' : 'Purchased Duration',
          value: `${purchase.durationMonths} Month${purchase.durationMonths > 1 ? 's' : ''}`,
          inline: true,
        },
        ...(purchase.amountText
          ? [
              {
                name: 'Amount to Pay',
                value: purchase.amountText,
                inline: true,
              },
            ]
          : []),
        {
          name: 'Expires',
          value: `<t:${Math.floor(purchase.expiresAt / 1000)}:F>`,
          inline: true,
        },
      )
      .setFooter({ text: `${EMBED_FOOTER} • Purchases` })
      .setTimestamp();

    await member.send({ embeds: [embed] });
  } catch (error) {
    console.error(
      `Failed to send ${renewal ? 'renewal' : 'purchase'} DM to user ${member.id}:`,
      error,
    );
  }
}
