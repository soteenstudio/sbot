/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { Command } from '@sapphire/framework';
import {
  EmbedBuilder,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { EMBED_COLORS } from '../engine/SEmbed.js';

export class LFGCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'lfg',
      description: 'Post a looking-for-group session.',
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .setDMPermission(false)
        .addStringOption((o) =>
          o
            .setName('game')
            .setDescription('Name of the game')
            .setMaxLength(1000)
            .setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName('slots')
            .setDescription('Number of players needed')
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('vc_link')
            .setDescription('Link to the voice channel')
            .setRequired(true),
        ),
    );
  }

  public async chatInputRun(interaction: ChatInputCommandInteraction) {
    const game = interaction.options.getString('game', true);
    const slots = interaction.options.getInteger('slots', true);
    const vcLink = interaction.options.getString('vc_link', true);

    try {
      new URL(vcLink);
    } catch {
      return interaction.reply({
        content:
          '❌ Enter a valid voice channel URL (for example, https://discord.gg/...).',
        ephemeral: true,
      });
    }

    const embed = new EmbedBuilder()
      .setTitle('🎮 Looking for Group')
      .setColor(EMBED_COLORS.INFO)
      .setDescription(
        `**Host:** ${interaction.user}\n**Game:** ${game}\n**Players needed:** ${slots}`,
      )
      .setFooter({ text: 'SoTeen Studio • Looking for group' })
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setEmoji('🔊')
        .setLabel('Join Voice Channel')
        .setStyle(ButtonStyle.Link)
        .setURL(vcLink),
    );

    return interaction.reply({
      embeds: [embed],
      components: [row],
    });
  }
}
