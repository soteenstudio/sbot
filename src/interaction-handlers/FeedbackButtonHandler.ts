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
  MessageFlags,
} from 'discord.js';
import { EMBED_COLORS, EMBED_FOOTER } from '../engine/SEmbed.js';

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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const feedbackUserId = interaction.customId.split('_')[2];
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
      )
      .setFooter({ text: `Reviewed by ${interaction.user.tag}` })
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(interaction.customId)
        .setEmoji('✅')
        .setLabel('Mark as Reviewed')
        .setStyle(ButtonStyle.Success)
        .setDisabled(true),
    );

    await interaction.message.edit({
      embeds: [reviewedEmbed],
      components: [row],
    });

    const dmEmbed = new EmbedBuilder()
      .setTitle('✅ Your Feedback Has Been Reviewed')
      .setColor(EMBED_COLORS.CONFIRMED)
      .setDescription(
        `The server staff have reviewed your feedback (${originalEmbed.title}).`,
      )
      .addFields(
        { name: 'Status', value: 'Reviewed', inline: true },
        {
          name: 'Reviewed',
          value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
          inline: true,
        },
      )
      .setFooter({ text: 'Thank you for helping improve our community.' })
      .setTimestamp();

    try {
      const feedbackUser = await interaction.client.users.fetch(feedbackUserId);
      await feedbackUser.send({ embeds: [dmEmbed] });
    } catch (err) {
      console.error(`Failed to send DM to user ${feedbackUserId}:`, err);
    }

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('✅ Feedback Reviewed')
          .setDescription(
            'The feedback has been marked as reviewed. The user was notified if direct messages were available.',
          )
          .setColor(EMBED_COLORS.CONFIRMED)
          .setFooter({ text: EMBED_FOOTER })
          .setTimestamp(),
      ],
    });
  }
}
