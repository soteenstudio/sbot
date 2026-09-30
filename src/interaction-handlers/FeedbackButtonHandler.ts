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
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { EMBED_COLORS } from '../engine/SEmbed.js';

export class FeedbackButtonHandler extends InteractionHandler {
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
    return interaction.customId.startsWith('feedback_done_')
      ? this.some()
      : this.none();
  }

  public async run(interaction: ButtonInteraction) {
    await interaction.deferUpdate();

    const originalEmbed = interaction.message.embeds[0];
    const reviewedEmbed = EmbedBuilder.from(originalEmbed)
      .setColor(EMBED_COLORS.CONFIRMED)
      .setFields(
        ...(originalEmbed.fields ?? []).filter(
          (field) => field.name !== 'Status',
        ),
        {
          name: 'Status',
          value: `✅ Reviewed by <@${interaction.user.id}>`,
          inline: true,
        },
      );
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(interaction.customId)
        .setEmoji('✅')
        .setLabel('Reviewed')
        .setStyle(ButtonStyle.Success)
        .setDisabled(true),
    );

    await interaction.editReply({
      embeds: [reviewedEmbed],
      components: [row],
    });
  }
}
