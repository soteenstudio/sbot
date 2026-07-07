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
  PieceContext,
} from '@sapphire/framework';
import {
  ButtonInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { activeLFG } from '../lib/lfg-data.js';

export class JoinButtonHandler extends InteractionHandler {
  public constructor(
    context: PieceContext,
    options: InteractionHandler.Options,
  ) {
    super(context, {
      ...options,
      interactionHandlerType: InteractionHandlerTypes.Button,
    });
  }

  public override parse(interaction: ButtonInteraction) {
    if (!interaction.customId.startsWith('lfg_pro_join_')) return this.none();
    return this.some();
  }

  public async run(interaction: ButtonInteraction) {
    await interaction.deferUpdate();

    const parts = interaction.customId.split('_');
    const hostId = parts[parts.length - 1];

    const session = activeLFG.get(hostId);

    if (!session)
      return interaction.reply({
        content: '❌ Session expired!',
        ephemeral: true,
      });

    const host = await interaction.client.users.fetch(hostId);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          `lfg_pro_accept_${interaction.user.id}_${interaction.channelId}_${hostId}`,
        )
        .setLabel('Accept')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`lfg_pro_decline_${interaction.user.id}_${hostId}`)
        .setLabel('Decline')
        .setStyle(ButtonStyle.Danger),
    );

    const notificationEmbed = new EmbedBuilder()
      .setTitle('🔔 New LFG Request')
      .setColor(0x0099ff)
      .setDescription(
        `**${interaction.user.tag}** wants to join your LFG session!`,
      )
      .setThumbnail(interaction.user.displayAvatarURL())
      .setTimestamp()
      .setFooter({ text: 'SoTeen Studio LFG System' });

    try {
      await host.send({
        embeds: [notificationEmbed],
        components: [row],
      });

      return interaction.followUp({
        content: `✅ Request sent to host!`,
        ephemeral: true,
      });
    } catch {
      return interaction.followUp({
        content: '❌ Host DM is closed.',
        ephemeral: true,
      });
    }
  }
}
