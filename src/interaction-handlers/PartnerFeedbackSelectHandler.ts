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
  StringSelectMenuInteraction,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

export class PartnerFeedbackSelectHandler extends InteractionHandler {
  public constructor(
    context: InteractionHandler.LoaderContext,
    options: InteractionHandler.Options,
  ) {
    super(context, {
      ...options,
      interactionHandlerType: InteractionHandlerTypes.SelectMenu,
    });
  }

  public override parse(interaction: StringSelectMenuInteraction) {
    return interaction.isStringSelectMenu() &&
      interaction.customId === 'partner_feedback_select'
      ? this.some()
      : this.none();
  }

  public async run(interaction: StringSelectMenuInteraction) {
    const selectedValue = interaction.values[0];
    const isNewChar = selectedValue === 'new_character';

    const modal = new ModalBuilder()
      .setCustomId(`partner_modal_${selectedValue}`)
      .setTitle(
        isNewChar
          ? '🌟 Suggest New Character & Culture'
          : '💬 General Feedback',
      );

    if (isNewChar) {
      const nameInput = new TextInputBuilder()
        .setCustomId('char_name_input')
        .setLabel('Character Name')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g., Nyoman Sari')
        .setRequired(true)
        .setMaxLength(100);

      const regionInput = new TextInputBuilder()
        .setCustomId('char_region_input')
        .setLabel('Region / Culture')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g., Gianyar, Bali')
        .setRequired(true)
        .setMaxLength(100);

      const descInput = new TextInputBuilder()
        .setCustomId('char_desc_input')
        .setLabel('Character Description (English)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder(
          'e.g., A skilled traditional weaver from the highlands...',
        )
        .setRequired(true)
        .setMaxLength(1000);

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(regionInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(descInput),
      );
    } else {
      const inputField = new TextInputBuilder()
        .setCustomId('feedback_input_text')
        .setLabel('Your suggestions or thoughts:')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Type your feedback here to help us improve...')
        .setRequired(true)
        .setMaxLength(1000);

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(inputField),
      );
    }

    await interaction.showModal(modal);
  }
}
