/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import type { GuildMember } from 'discord.js';
import type {
  PlanChangeRequest,
  PlanChangeReceipt,
} from './subscriptionStore.js';
import { planChangeRequestEmbed } from './planChangePresentation.js';
export async function notifyBuyerOfPlanChange(
  member: GuildMember,
  request: PlanChangeRequest,
  receipt: PlanChangeReceipt,
): Promise<void> {
  try {
    const embed = planChangeRequestEmbed(
      request,
      receipt,
      receipt.newPaidPeriod.currency,
      true,
    )
      .setTitle('✅ Your Subscription Plan Has Changed')
      .addFields(
        { name: 'Server', value: member.guild.name },
        {
          name: 'Expires',
          value: `<t:${Math.floor(receipt.newExpiresAt / 1000)}:F>`,
        },
      );
    await member.send({ embeds: [embed] });
  } catch (error) {
    console.error(`Failed to send plan change DM to user ${member.id}:`, error);
  }
}
