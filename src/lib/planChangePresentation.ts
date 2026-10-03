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
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { EMBED_COLORS, EMBED_FOOTER } from '../engine/SEmbed.js';
import {
  formatSubscriptionMoney,
  type SubscriptionCurrency,
} from './subscriptionPrices.js';
import type { PlanChangeQuote } from './proratedPlanChange.js';
import type { PlanChangeRequest } from './subscriptionStore.js';
export function planChangeButton(requestId: string, disabled = false) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`plan_change_verify_${requestId}`)
      .setEmoji('✅')
      .setLabel('Verify Plan Change')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
  );
}
export function planChangeRequestEmbed(
  request: PlanChangeRequest,
  quote: PlanChangeQuote,
  currency: SubscriptionCurrency,
  completed = false,
) {
  const money = (amount: number) => formatSubscriptionMoney(amount, currency);
  return new EmbedBuilder()
    .setTitle(
      completed
        ? '✅ Plan Change Completed'
        : '🔄 Subscription Plan Change Request',
    )
    .setColor(completed ? EMBED_COLORS.CONFIRMED : EMBED_COLORS.WARNING)
    .setDescription(
      completed
        ? 'Subscription roles changed and final amounts saved. Credit uses unused paid time with no 5% deduction. Prices are dummy test prices. Payment and excess credit are settled manually; the bot never moves funds.'
        : 'Credit uses unused paid time with no 5% deduction. Amounts use dummy test prices; verification recalculates the estimate. Payment and excess credit are settled manually; the bot never moves funds.',
    )
    .addFields(
      { name: 'Buyer', value: `<@${request.userId}>`, inline: true },
      {
        name: 'Requested By',
        value: `<@${request.requestedBy}>`,
        inline: true,
      },
      { name: 'Old Tier', value: `<@&${request.fromRoleId}>`, inline: true },
      { name: 'New Tier', value: `<@&${request.toRoleId}>`, inline: true },
      {
        name: 'Duration',
        value: `${request.durationMonths} Months`,
        inline: true,
      },
      { name: 'Prorated Credit', value: money(quote.credit), inline: true },
      { name: 'New Price', value: money(quote.newPrice), inline: true },
      {
        name:
          (quote.creditBalance ? 'Credit Balance' : 'Amount to Pay') +
          (completed ? '' : ' (estimate)'),
        value: money(quote.creditBalance || quote.amountToPay),
        inline: true,
      },
      {
        name: 'Status',
        value: completed
          ? '✅ Completed'
          : request.status === 'verified'
            ? '⏳ Verified; role change pending'
            : '⏳ Pending verification',
      },
    )
    .setFooter({ text: `${EMBED_FOOTER} • Purchases` })
    .setTimestamp(quote.at);
}
export function planChangeConfirmationEmbed(
  request: PlanChangeRequest,
  quote: PlanChangeQuote,
  currency: SubscriptionCurrency,
) {
  return planChangeRequestEmbed(request, quote, currency)
    .setTitle('✅ Plan Change Logged')
    .setColor(EMBED_COLORS.CONFIRMED);
}
