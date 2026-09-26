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
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
} from 'discord.js';
import { activeLFG } from '../lib/lfg-data.js';
import { isUnknownChannel } from '../lib/party-data.js';

export class EndSessionHandler extends InteractionHandler {
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
    return interaction.customId.startsWith('lfg_pro_end_')
      ? this.some()
      : this.none();
  }

  public async run(interaction: ButtonInteraction) {
    const channelId = interaction.customId.split('_')[3];
    const entry = [...activeLFG.entries()].find(
      ([, session]) => session.vcId === channelId,
    );
    if (!entry || entry[0] !== interaction.user.id || !interaction.guild) {
      return interaction.reply({
        content: '❌ Only the host of this active session can end it.',
        ephemeral: true,
      });
    }

    const [hostId, session] = entry;
    try {
      const channel = await interaction.guild.channels.fetch(channelId);
      if (channel) await channel.delete();
    } catch (error) {
      if (!isUnknownChannel(error)) {
        console.error('Could not end LFG voice session:', error);
        return interaction.reply({
          content:
            '❌ Could not end the session voice channel. Please try again.',
          ephemeral: true,
        });
      }
    }

    activeLFG.delete(hostId);
    const origin = await interaction.client.channels
      .fetch(session.channelId)
      .catch(() => null);
    if (origin?.isTextBased()) {
      const message = await origin.messages
        .fetch(session.messageId)
        .catch(() => null);
      if (message) {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId('disabled')
            .setLabel('Session Closed')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        );
        await message.edit({ components: [row] }).catch(() => null);
      }
    }

    return interaction.reply({
      content: '✅ Your session has ended.',
      ephemeral: true,
    });
  }
}
