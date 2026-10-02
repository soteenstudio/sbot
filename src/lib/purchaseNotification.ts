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
  purchase: Pick<SubscriptionRecord, 'roleId' | 'durationMonths' | 'expiresAt'>,
): Promise<void> {
  try {
    const tierName =
      member.guild.roles.cache.get(purchase.roleId)?.name ??
      Object.entries(Roles).find(([, role]) => role.id === purchase.roleId)?.[0] ??
      'Subscription';
    const embed = new EmbedBuilder()
      .setTitle('✅ Your Purchase Has Been Granted')
      .setColor(EMBED_COLORS.CONFIRMED)
      .setDescription('Your subscription purchase has been verified and granted.')
      .addFields(
        { name: 'Server', value: member.guild.name, inline: true },
        { name: 'Subscription Tier', value: tierName, inline: true },
        {
          name: 'Purchased Duration',
          value: `${purchase.durationMonths} Month${purchase.durationMonths > 1 ? 's' : ''}`,
          inline: true,
        },
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
    console.error(`Failed to send purchase DM to user ${member.id}:`, error);
  }
}
