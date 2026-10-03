/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { EmbedBuilder, ChannelType, type Guild } from 'discord.js';
import { EMBED_COLORS, EMBED_FOOTER } from '../engine/SEmbed.js';
export async function logRoleChange(
  guild: Guild,
  change: {
    buyerId: string;
    fromRoleId: string;
    toRoleId?: string;
    reason: 'Upgrade' | 'Downgrade' | 'Expired';
    staffId?: string;
    subscriptionId?: string;
  },
): Promise<void> {
  try {
    const channelId = process.env.BUY_LOG_CHANNEL;
    if (!channelId) throw new Error('Purchase log is unconfigured');
    const channel = await guild.channels.fetch(channelId);
    if (
      !channel ||
      channel.type !== ChannelType.GuildText ||
      channel.guild.id !== guild.id
    )
      throw new Error('Purchase log is not a guild text channel');
    const embed = new EmbedBuilder()
      .setTitle('Automatic Subscription Role Change')
      .setColor(EMBED_COLORS.INFO)
      .addFields(
        { name: 'Member', value: `<@${change.buyerId}>` },
        {
          name: 'Change',
          value: `<@&${change.fromRoleId}> → ${change.toRoleId ? `<@&${change.toRoleId}>` : 'None'}`,
        },
        { name: 'Reason', value: change.reason },
        {
          name: 'Verified by',
          value: change.staffId ? `<@${change.staffId}>` : 'Automatic expiry',
        },
        {
          name: 'Subscription ID',
          value: change.subscriptionId ?? 'Legacy subscription',
        },
      )
      .setFooter({ text: `${EMBED_FOOTER} • Purchases` })
      .setTimestamp();
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (error) {
    console.error('Failed to log automatic subscription role change:', error);
  }
}
