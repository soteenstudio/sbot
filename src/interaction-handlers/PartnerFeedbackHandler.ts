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
  ButtonInteraction,
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { EMBED_COLORS, EMBED_FOOTER } from '../engine/SEmbed.js';

export class PartnerFeedbackHandler extends InteractionHandler {
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
    return interaction.customId === 'partner_feedback_btn'
      ? this.some()
      : this.none();
  }

  public async run(interaction: ButtonInteraction) {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('partner_feedback_select')
      .setPlaceholder('Select your feedback category...')
      .addOptions([
        {
          label: 'General Feedback',
          description:
            'Provide general thoughts or improvements for this feature.',
          value: 'general_feedback',
          emoji: '💬',
        },
        {
          label: 'New Character',
          description:
            'Suggest a new fictional character and regional background.',
          value: 'new_character',
          emoji: '🌟',
        },
      ]);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      selectMenu,
    );

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('💡 Partner Feedback')
          .setDescription(
            'Choose the type of feedback you would like to share. Suggestions are delivered straight to the SoTeen Studio team.',
          )
          .setColor(EMBED_COLORS.INFO)
          .setFooter({ text: EMBED_FOOTER })
          .setTimestamp(),
      ],
      components: [row],
      ephemeral: true,
    });
  }
}
