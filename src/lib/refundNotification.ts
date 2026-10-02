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
import {
  formatSubscriptionMoney,
  type SubscriptionCurrency,
} from './subscriptionPrices.js';

// Call only after a staff-confirmed refund is persisted and required access changes succeed.
export async function notifyBuyerOfRefund(
  member: GuildMember,
  refund: {
    roleId: string;
    gross: number;
    tax: number;
    net: number;
    currency: SubscriptionCurrency;
  },
): Promise<void> {
  try {
    const amounts = refund;
    const fields = [
      {
        name: 'Gross Refund',
        value: formatSubscriptionMoney(amounts.gross, refund.currency),
        inline: true,
      },
      {
        name: '5% Deduction',
        value: formatSubscriptionMoney(amounts.tax, refund.currency),
        inline: true,
      },
      {
        name: 'Net Refund',
        value: formatSubscriptionMoney(amounts.net, refund.currency),
        inline: true,
      },
    ];
    const tierName =
      member.guild.roles.cache.get(refund.roleId)?.name ??
      Object.entries(Roles).find(
        ([, role]) => role.id === refund.roleId,
      )?.[0] ??
      'Subscription';
    const embed = new EmbedBuilder()
      .setTitle('✅ Your Refund Has Been Recorded')
      .setDescription(
        'Your unused subscription time refund was recorded for manual payment. Your subscription is cancelled and subscription access removed. The 5% tax does not include inter-bank transfer fees.',
      )
      .setColor(EMBED_COLORS.CONFIRMED)
      .addFields(
        { name: 'Server', value: member.guild.name, inline: true },
        { name: 'Subscription Tier', value: tierName, inline: true },
        ...fields,
      )
      .setFooter({ text: `${EMBED_FOOTER} • Purchases` })
      .setTimestamp();
    await member.send({ embeds: [embed] });
  } catch (error) {
    console.error(`Failed to send refund DM to user ${member.id}:`, error);
  }
}
