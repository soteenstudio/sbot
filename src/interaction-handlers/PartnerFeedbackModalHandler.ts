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
  ModalSubmitInteraction,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';

export class PartnerFeedbackModalHandler extends InteractionHandler {
  public constructor(
    context: InteractionHandler.LoaderContext,
    options: InteractionHandler.Options,
  ) {
    super(context, {
      ...options,
      interactionHandlerType: InteractionHandlerTypes.ModalSubmit,
    });
  }

  public override parse(interaction: ModalSubmitInteraction) {
    return interaction.customId === 'partner_modal_general_feedback' ||
      interaction.customId === 'partner_modal_new_character'
      ? this.some()
      : this.none();
  }

  public async run(interaction: ModalSubmitInteraction) {
    const feedbackText = interaction.fields.getTextInputValue(
      'feedback_input_text',
    );
    const isNewChar = interaction.customId === 'partner_modal_new_character';
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const channelId = process.env.FEEDBACK_CHANNEL;
      const channel =
        channelId && interaction.guild
          ? await interaction.guild.channels.fetch(channelId)
          : null;
      if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.editReply({
          content:
            '❌ Feedback is unavailable because the staff channel is not configured.',
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(
          isNewChar ? '🌟 Partner Character Proposal' : '💬 Partner Feedback',
        )
        .setDescription(feedbackText)
        .addFields({
          name: 'Submitted by',
          value: `${interaction.user.tag} (${interaction.user.id})`,
        })
        .setTimestamp();
      await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    } catch (error) {
      console.error('Failed to deliver partner feedback:', error);
      await interaction.editReply({
        content:
          '❌ Your feedback could not be delivered. Please try again later or contact a server administrator.',
      });
      return;
    }

    await interaction.editReply({
      content: `✅ Thank you! Your ${isNewChar ? 'character proposal' : 'feedback'} has been successfully submitted. We appreciate your contribution to SoTeen Studio!`,
    });
  }
}
