/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { Subcommand } from '@sapphire/plugin-subcommands';
import {
  EmbedBuilder,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} from 'discord.js';
import 'dotenv/config';

export class ReportCommand extends Subcommand {
  public constructor(
    context: Subcommand.LoaderContext,
    options: Subcommand.Options,
  ) {
    super(context, {
      ...options,
      name: 'report',
      description: 'Report an issue or user.',
    });
  }

  public override registerApplicationCommands(registry: Subcommand.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .setDMPermission(false)
        .addStringOption((o) =>
          o
            .setName('reason')
            .setDescription('What is happening?')
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('category')
            .setDescription('Category')
            .setRequired(true)
            .addChoices(
              { name: 'Harassment', value: 'harassment' },
              { name: 'Bug/Glitch', value: 'bug' },
              { name: 'Other', value: 'other' },
            ),
        )
        .setDMPermission(false),
    );
  }

  public async chatInputRun(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const reason = interaction.options.getString('reason', true);
    const category = interaction.options.getString('category', true);
    const reportChannel = interaction.guild?.channels.cache.get(
      process.env.REPORT_CHANNEL as string,
    );

    if (!reportChannel || reportChannel.type !== ChannelType.GuildText) {
      await interaction.reply({
        content: '❌ Report channel not configured.',
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`🚨 New Report: ${category.toUpperCase()}`)
      .setDescription(reason)
      .addFields(
        {
          name: 'Reporter',
          value: `${interaction.user.tag} (${interaction.user.id})`,
          inline: true,
        },
        {
          name: 'Timestamp',
          value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
          inline: true,
        },
      )
      .setColor(0xff0000)
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`report_done_${interaction.user.id}`)
        .setLabel('Mark as Done')
        .setStyle(ButtonStyle.Success),
    );

    try {
      await reportChannel.send({ embeds: [embed], components: [row] });
      await interaction.reply({
        content: '✅ Your report has been sent to the staff. Thank you!',
        ephemeral: true,
      });
    } catch (error) {
      console.error('Failed to send report to channel:', error);

      await interaction.reply({
        content:
          "❌ Sorry, I couldn't deliver your report to the staff channel. Please contact an admin directly.",
        ephemeral: true,
      });
    }
  }
}
