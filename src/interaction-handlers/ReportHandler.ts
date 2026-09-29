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
import { isHoneypotAppealTitle } from '../lib/honeypotAppeal.js';

export class ReportHandler extends InteractionHandler {
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
    return interaction.customId.startsWith('report_done_') &&
      !isHoneypotAppealTitle(interaction.message.embeds[0]?.title)
      ? this.some()
      : this.none();
  }

  public async run(interaction: ButtonInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const reporterId = interaction.customId.split('_')[2];
    const originalEmbed = interaction.message.embeds[0];

    const resolvedEmbed = EmbedBuilder.from(originalEmbed)
      .setColor(EMBED_COLORS.CONFIRMED)
      .setFields(
        ...(originalEmbed.fields ?? []).filter(
          (field) => field.name !== 'Status',
        ),
        {
          name: 'Status',
          value: `✅ Resolved by <@${interaction.user.id}>`,
          inline: true,
        },
      )
      .setFooter({ text: `Resolved by ${interaction.user.tag}` })
      .setTimestamp();

    const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(interaction.customId)
        .setEmoji('✅')
        .setLabel('Mark as Resolved')
        .setStyle(ButtonStyle.Success)
        .setDisabled(true),
    );

    await interaction.message.edit({
      embeds: [resolvedEmbed],
      components: [disabledRow],
    });

    const dmEmbed = new EmbedBuilder()
      .setTitle('✅ Your Report Has Been Resolved')
      .setColor(EMBED_COLORS.CONFIRMED)
      .setDescription(
        `The server staff have resolved your report (${originalEmbed.title}).`,
      )
      .addFields(
        { name: 'Status', value: 'Resolved', inline: true },
        {
          name: 'Resolved',
          value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
          inline: true,
        },
      )
      .setFooter({ text: 'Thank you for helping keep our community safe.' })
      .setTimestamp();

    try {
      const reporter = await interaction.client.users.fetch(reporterId);
      await reporter.send({ embeds: [dmEmbed] });
    } catch (err) {
      console.error(`Failed to send DM to user ${reporterId}:`, err);
    }

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('✅ Report Resolved')
          .setDescription(
            'The report has been marked as resolved. The reporter was notified if direct messages were available.',
          )
          .setColor(EMBED_COLORS.CONFIRMED)
          .setFooter({ text: EMBED_FOOTER })
          .setTimestamp(),
      ],
    });
  }
}
