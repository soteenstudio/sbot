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
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ComponentType,
} from 'discord.js';
import { activeLFG } from '../lib/lfg-data.js';

export class LFGCommand extends Subcommand {
  public constructor(
    context: Subcommand.LoaderContext,
    options: Subcommand.Options,
  ) {
    super(context, {
      ...options,
      name: 'lfg-pro',
      description: 'Elite matchmaking system for competitive players.',
      subcommands: [
        {
          name: 'create',
          chatInputRun: 'create',
          preconditions: [
            { name: 'RequireRole', context: { level: 'BILLION' } } as any,
          ],
        },
        {
          name: 'close',
          chatInputRun: 'close',
          preconditions: [
            { name: 'RequireRole', context: { level: 'BILLION' } } as any,
          ],
        },
        { name: 'list', chatInputRun: 'list' },
      ],
    });
  }

  public override registerApplicationCommands(registry: Subcommand.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addSubcommand((sub) =>
          sub
            .setName('create')
            .setDescription('Initialize a premium LFG session')
            .addStringOption((o) =>
              o
                .setName('game')
                .setDescription('The game title')
                .setRequired(true),
            )
            .addStringOption((o) =>
              o
                .setName('rank')
                .setDescription('Your current rank')
                .setRequired(true),
            )
            .addIntegerOption((o) =>
              o
                .setName('max_players')
                .setDescription('Max players allowed')
                .setMinValue(2)
                .setMaxValue(10),
            ),
        )
        .addSubcommand((sub) =>
          sub.setName('close').setDescription('Close your active LFG session'),
        )
        .addSubcommand((sub) =>
          sub.setName('list').setDescription('View all active elite sessions'),
        ),
    );
  }

  public async create(interaction: ChatInputCommandInteraction) {
    const member = interaction.member;

    const game = interaction.options.getString('game', true);
    const rank = interaction.options.getString('rank', true);
    const maxPlayers = interaction.options.getInteger('max_players') || 2;

    const embed = new EmbedBuilder()
      .setTitle('🛡️ Elite Matchmaking Session')
      .setDescription(
        `**Host:** ${interaction.user}\n**Game:** ${game}\n**Requirement:** ${rank}\n**Players:** 1/${maxPlayers}`,
      )
      .setColor(0x00ff9d)
      .setFooter({ text: 'Session ID: ' + interaction.user.id.slice(-4) });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`lfg_pro_join_${interaction.user.id}`)
        .setLabel('Join Session')
        .setStyle(ButtonStyle.Success),
    );

    const response = await interaction.reply({
      embeds: [embed],
      components: [row],
      fetchReply: true,
    });

    activeLFG.set(interaction.user.id, {
      game,
      rank,
      maxPlayers,
      author: interaction.user.tag,
      authorId: interaction.user.id,
      channelId: interaction.channelId!,
      messageId: response.id,
      vcId: '',
    });
  }

  public async close(interaction: ChatInputCommandInteraction) {
    const session = activeLFG.get(interaction.user.id);

    if (!session) {
      return interaction.reply({
        content: "❌ You don't have an active LFG session to close.",
        ephemeral: true,
      });
    }

    if (session.vcId) {
      const channel = await interaction.guild?.channels
        .fetch(session.vcId)
        .catch(() => null);
      if (channel) {
        await channel.delete().catch(() => null);
      }
    }

    const channel = await interaction.client.channels
      .fetch(session.channelId)
      .catch(() => null);
    if (channel && channel.isTextBased()) {
      const message = await channel.messages
        .fetch(session.messageId)
        .catch(() => null);

      if (message) {
        const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId('disabled')
            .setLabel('Session Closed')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        );

        await message.edit({ components: [disabledRow] }).catch(() => null);
      }
    }

    activeLFG.delete(interaction.user.id);

    return interaction.reply({
      content: '✅ Your LFG session has been closed successfully.',
      ephemeral: true,
    });
  }

  public async list(interaction: ChatInputCommandInteraction) {
    if (activeLFG.size === 0) {
      return interaction.reply({
        content: '🔍 No active elite sessions found at the moment.',
        ephemeral: true,
      });
    }

    const list = Array.from(activeLFG.values())
      .map((l) => `• **${l.game}** | Rank: ${l.rank} | Host: ${l.author}`)
      .join('\n');
    const embed = new EmbedBuilder()
      .setTitle('Active Elite Sessions')
      .setDescription(list)
      .setColor(0x2f3136);

    return interaction.reply({ embeds: [embed] });
  }
}
