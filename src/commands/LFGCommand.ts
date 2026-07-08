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

export class LFGCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'lfg',
      description: 'Post a standard LFG session.',
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .setDMPermission(false)
        .addStringOption((o) =>
          o.setName('game').setDescription('Game title').setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName('slots')
            .setDescription('Available slots')
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('vc_link')
            .setDescription('Voice Channel Link (URL)')
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
          '❌ Invalid link provided. Please ensure your Voice Channel Link is a valid URL (e.g., https://discord.gg/...).',
        ephemeral: true,
      });
    }

    const embed = new EmbedBuilder()
      .setTitle('🎮 LFG Session')
      .setColor(0x5865f2)
      .setDescription(
        `**Host:** ${interaction.user}\n**Game:** ${game}\n**Slots:** ${slots} players needed`,
      )
      .setFooter({ text: 'Standard Matchmaking' });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('Join Voice')
        .setStyle(ButtonStyle.Link)
        .setURL(vcLink),
    );

    return interaction.reply({
      embeds: [embed],
      components: [row],
    });
  }
}
