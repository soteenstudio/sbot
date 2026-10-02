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
import type { RefundRequest, RefundReceipt } from './subscriptionStore.js';

export function refundButton(requestId: string, disabled: boolean) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`refund_verify_${requestId}`)
      .setEmoji('✅')
      .setLabel('Verify & Refund')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
  );
}

export function refundRequestEmbed(
  request: RefundRequest,
  amounts: {
    gross: number;
    tax: number;
    net: number;
    currency: SubscriptionCurrency;
  },
  receipt?: RefundReceipt,
) {
  const completed = receipt?.status === 'completed';
  const final = Boolean(receipt);
  return new EmbedBuilder()
    .setTitle(
      completed ? '✅ Refund Recorded' : '💸 Subscription Refund Request',
    )
    .setColor(completed ? EMBED_COLORS.CONFIRMED : EMBED_COLORS.WARNING)
    .setDescription(
      completed
        ? "Subscription cancelled and the buyer's subscription role removed. Recorded for manual payment; the bot has not transferred funds. The 5% tax does not include inter-bank transfer fees."
        : "Amounts are estimates; verification calculates unused time at verification, cancels the subscription and removes only the buyer's subscription role, never the server's role. Recorded for manual payment; the bot does not transfer funds. The 5% tax does not include inter-bank transfer fees.",
    )
    .addFields(
      {
        name: 'Buyer',
        value: `<@${request.userId}> (${request.userId})`,
        inline: true,
      },
      { name: 'Tier Role', value: `<@&${request.roleId}>`, inline: true },
      { name: 'Refund Basis', value: 'Unused subscription time' },
      {
        name: final ? 'Gross Refund' : 'Estimated Gross Refund',
        value: formatSubscriptionMoney(amounts.gross, amounts.currency),
        inline: true,
      },
      {
        name: final ? '5% Deduction' : 'Estimated 5% Deduction',
        value: formatSubscriptionMoney(amounts.tax, amounts.currency),
        inline: true,
      },
      {
        name: final ? 'Net Refund' : 'Estimated Net Refund',
        value: formatSubscriptionMoney(amounts.net, amounts.currency),
        inline: true,
      },
      {
        name: 'Requested By',
        value: `${request.requesterTag} (${request.requestedBy})`,
      },
      {
        name: 'Status',
        value: completed
          ? '✅ Cancelled; awaiting manual payment'
          : final
            ? '⏳ Verified; cancellation pending'
            : '⏳ Pending verification',
      },
      ...(receipt
        ? [
            {
              name: 'Verified By',
              value: `<@${request.verifiedBy}> (<t:${Math.floor(request.verifiedAt! / 1000)}:F>)`,
            },
            {
              name: 'Final Calculation',
              value: `<t:${Math.floor(receipt.refundAt / 1000)}:F>`,
            },
            { name: 'Refund Reference', value: receipt.refundId },
          ]
        : []),
    )
    .setFooter({ text: `${EMBED_FOOTER} • Purchases` })
    .setTimestamp(receipt?.refundAt ?? request.requestedAt);
}
