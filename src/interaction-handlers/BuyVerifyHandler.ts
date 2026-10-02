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
import { ButtonInteraction, EmbedBuilder } from 'discord.js';
import { EMBED_COLORS } from '../engine/SEmbed.js';
import { subscriptionStore } from '../lib/subscriptionStore.js';

export class BuyVerifyHandler extends InteractionHandler {
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
    if (!interaction.customId.startsWith('buy_verify_')) return this.none();
    return this.some();
  }

  public async run(interaction: ButtonInteraction) {
    if (!interaction.inCachedGuild()) return;

    const parts = interaction.customId.split('_');

    const userId = parts[2];
    const roleId = parts[3];
    const durationMonths = parseInt(parts[4], 10);

    const member = await interaction.guild.members
      .fetch(userId)
      .catch(() => null);
    if (!member) {
      await interaction.reply({
        content: '❌ Buyer is no longer in this server.',
        ephemeral: true,
      });
      return;
    }

    try {
      await member.roles.add(
        roleId,
        `Subscription verified by ${interaction.user.tag}`,
      );
    } catch (error) {
      await interaction.reply({
        content:
          '❌ Failed to add role to user. Check bot permissions/role hierarchy.',
        ephemeral: true,
      });
      return;
    }

    const expiresAt = Date.now() + durationMonths * 30 * 24 * 60 * 60 * 1000;

    await subscriptionStore.set({
      userId,
      guildId: interaction.guild.id,
      roleId,
      durationMonths,
      expiresAt,
    });

    const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
      .setColor(EMBED_COLORS.CONFIRMED)
      .addFields({
        name: 'Status',
        value: `✅ Verified and granted by ${interaction.user.tag} (<t:${Math.floor(Date.now() / 1000)}:R>)`,
        inline: false,
      });

    await interaction.update({
      embeds: [updatedEmbed],
      components: [],
    });
  }
}
