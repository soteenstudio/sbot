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
import { formatSubscriptionMoney } from './subscriptionPrices.js';
import type {
  PlanChangeRequest,
  PlanChangeReceipt,
} from './subscriptionStore.js';
export async function notifyBuyerOfPlanChange(
  member: GuildMember,
  request: PlanChangeRequest,
  receipt: PlanChangeReceipt,
): Promise<void> {
  try {
    const tierName = (roleId: string) =>
      member.guild.roles.cache.get(roleId)?.name ??
      Object.entries(Roles).find(([, role]) => role.id === roleId)?.[0] ??
      'Subscription';
    const money = (amount: number) =>
      formatSubscriptionMoney(amount, receipt.newPaidPeriod.currency);
    const embed = new EmbedBuilder()
      .setTitle(
        request.direction === 'upgrade'
          ? '✅ Your Subscription Has Been Upgraded'
          : '✅ Your Subscription Has Been Downgraded',
      )
      .setColor(EMBED_COLORS.CONFIRMED)
      .setDescription(
        'Your subscription plan change has been verified and your access updated. Credit uses unused paid time with no 5% deduction. Excess credit is settled manually.\n\nRecorded for manual payment; the bot does not take payment.',
      )
      .addFields(
        { name: 'Server', value: member.guild.name, inline: true },
        { name: 'Old Tier', value: tierName(request.fromRoleId), inline: true },
        { name: 'New Tier', value: tierName(request.toRoleId), inline: true },
        {
          name: 'Duration',
          value: `${request.durationMonths} Month${request.durationMonths > 1 ? 's' : ''}`,
          inline: true,
        },
        { name: 'Prorated Credit', value: money(receipt.credit), inline: true },
        { name: 'New Price', value: money(receipt.newPrice), inline: true },
        {
          name: receipt.creditBalance ? 'Credit Balance' : 'Amount to Pay',
          value: money(receipt.creditBalance || receipt.amountToPay),
          inline: true,
        },
        {
          name: 'Expires',
          value: `<t:${Math.floor(receipt.newExpiresAt / 1000)}:F>`,
          inline: true,
        },
      )
      .setFooter({ text: `${EMBED_FOOTER} • Purchases` })
      .setTimestamp();
    await member.send({ embeds: [embed] });
  } catch (error) {
    console.error(`Failed to send plan change DM to user ${member.id}:`, error);
  }
}
