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
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

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

  public override async parse(
    interaction:
      ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  ) {
    if (
      interaction.isButton() &&
      interaction.customId === 'partner_feedback_btn'
    ) {
      return this.some();
    }
    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === 'partner_feedback_select'
    ) {
      return this.some();
    }
    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith('partner_modal_')
    ) {
      return this.some();
    }
    return this.none();
  }

  public async run(
    interaction:
      ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  ) {
    if (interaction.isButton()) {
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('partner_feedback_select')
        .setPlaceholder('Select your feedback category...')
        .addOptions([
          {
            label: 'General Feedback / Suggestion',
            description:
              'Provide general thoughts or improvements for this feature.',
            value: 'general_feedback',
            emoji: '💬',
          },
          {
            label: 'New Character / Culture Proposal',
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
        content:
          '💡 Please choose the type of feedback you would like to share:',
        components: [row],
        ephemeral: true,
      });
      return;
    }

    if (interaction.isStringSelectMenu()) {
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
      return;
    }

    if (interaction.isModalSubmit()) {
      const feedbackText = interaction.fields.getTextInputValue(
        'feedback_input_text',
      );
      const category = interaction.customId.replace('partner_modal_', '');

      await interaction.reply({
        content: `✅ Thank you! Your ${category === 'new_character' ? 'character proposal' : 'feedback'} has been successfully submitted. We appreciate your contribution to SoTeen Studio!`,
        ephemeral: true,
      });
    }
  }
}
