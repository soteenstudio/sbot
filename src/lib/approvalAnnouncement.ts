/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import type { Guild } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { subscriptionStore } from './subscriptionStore.js';
import { EMBED_COLORS } from '../engine/SEmbed.js';

export type ApprovalKind = 'Buy' | 'Renew' | 'Refund' | 'Upgrade' | 'Downgrade';

export async function announceApproval(
  guild: Guild,
  channelId: string | undefined,
  approverId: string,
  kind: ApprovalKind,
): Promise<void> {
  try {
    if (!channelId) {
      console.warn(
        `Skipping ${kind} approval announcement: command channel is missing.`,
      );
      return;
    }
    const channel = await guild.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || channel.guild.id !== guild.id)
      throw new Error('Command channel is not a text-based guild channel');

    const embed = new EmbedBuilder()
      .setTitle(`📣 ${kind} Info`)
      .setDescription(
        `<@${approverId}> has ${kind === 'Renew' ? 'approved' : 'verified'} this process (${kind})`,
      )
      .setColor(EMBED_COLORS.INFO)
      .setFooter({ text: 'SoTeen Studio • Purchases' })
      .setTimestamp();

    await channel.send({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    console.error(`Failed to announce ${kind} approval:`, error);
  }
}

export async function announceSavedApproval(
  guild: Guild,
  key: string,
  approverId: string,
  kind: ApprovalKind,
): Promise<void> {
  try {
    const origin =
      kind === 'Refund'
        ? await subscriptionStore.getRefundRequest(key)
        : kind === 'Upgrade' || kind === 'Downgrade'
          ? await subscriptionStore.getPlanChangeRequest(key)
          : await subscriptionStore.getApprovalOrigin(key);
    if (!origin?.commandChannelId) {
      await announceApproval(guild, undefined, approverId, kind);
      return;
    }
    if (await subscriptionStore.markAnnounced(key))
      await announceApproval(guild, origin.commandChannelId, approverId, kind);
  } catch (error) {
    console.error(`Failed to track ${kind} approval announcement:`, error);
  }
}
