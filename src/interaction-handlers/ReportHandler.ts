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
import { ButtonInteraction, EmbedBuilder, MessageFlags } from 'discord.js';

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
    return interaction.customId.startsWith('report_done_')
      ? this.some()
      : this.none();
  }

  public async run(interaction: ButtonInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const reporterId = interaction.customId.split('_')[2];
    const originalEmbed = interaction.message.embeds[0];

    const resolvedEmbed = EmbedBuilder.from(originalEmbed)
      .setColor(0x00ff00)
      .setFooter({ text: `Resolved by ${interaction.user.tag}` });

    await interaction.message.edit({ embeds: [resolvedEmbed], components: [] });

    const dmEmbed = new EmbedBuilder()
      .setTitle('✅ Report Resolved')
      .setColor(0x00ff00)
      .setDescription(
        `Your report regarding: **${originalEmbed.title}** has been successfully resolved by our staff.`,
      )
      .addFields(
        { name: 'Resolution Status', value: 'Complete', inline: true },
        {
          name: 'Timestamp',
          value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
          inline: true,
        },
      )
      .setFooter({ text: 'Thank you for helping keep our community safe!' });

    try {
      const reporter = await interaction.client.users.fetch(reporterId);
      await reporter.send({ embeds: [dmEmbed] });
    } catch (err) {
      console.error(`Failed to send DM to user ${reporterId}:`, err);
    }

    await interaction.editReply({
      content:
        '✅ The report has been marked as resolved, and the reporter has been notified via DM.',
    });
  }
}
