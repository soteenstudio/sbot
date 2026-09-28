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

    const inputField = new TextInputBuilder()
      .setCustomId('feedback_input_text')
      .setLabel(
        isNewChar
          ? 'Character Name, Region & Description:'
          : 'Your suggestions or thoughts:',
      )
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder(
        isNewChar
          ? 'Example: Name: Nyoman Sari | Region: Gianlar, Bali | Desc: A skilled weaver...'
          : 'Type your feedback here to help us improve...',
      )
      .setRequired(true)
      .setMaxLength(1000);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(inputField),
    );

    await interaction.showModal(modal);
  }
}
