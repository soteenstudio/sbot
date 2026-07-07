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
} from 'discord.js';
import { activePolls } from '../lib/pollData.js';

export class PollCommand extends Subcommand {
  public constructor(
    context: Subcommand.LoaderContext,
    options: Subcommand.Options,
  ) {
    super(context, {
      ...options,
      name: 'poll',
      description: 'Advanced polling suite for SoTeen Studio.',
      subcommands: [
        {
          name: 'create',
          chatInputRun: 'create',
          preconditions: ['PollCooldown'] as any,
        },
        { name: 'results', chatInputRun: 'results' },
        { name: 'close', chatInputRun: 'close' },
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
            .setDescription('Create a poll')
            .addStringOption((o) =>
              o.setName('question').setDescription('Topic').setRequired(true),
            )
            .addStringOption((o) =>
              o
                .setName('options')
                .setDescription('Separated by |')
                .setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('results')
            .setDescription('View results of your active poll'),
        )
        .addSubcommand((sub) =>
          sub.setName('close').setDescription('Close your active poll'),
        ),
    );
  }

  public async create(interaction: ChatInputCommandInteraction): Promise<void> {
    if (activePolls.has(interaction.user.id)) {
      await interaction.reply({
        content:
          '❌ You already have an active poll. Please close it using `/poll close` before creating a new one.',
        ephemeral: true,
      });
      return;
    }

    const question = interaction.options.getString('question', true);
    const options = interaction.options.getString('options', true).split('|');

    const embed = new EmbedBuilder()
      .setTitle(`📊 ${question}`)
      .setDescription(options.map((o, i) => `${i + 1}. ${o}`).join('\n'))
      .setColor(0x00ff9d);

    const row = new ActionRowBuilder<ButtonBuilder>();
    options.forEach((_, i) => {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`poll_${interaction.user.id}_${i + 1}`)
          .setLabel(`${i + 1}`)
          .setStyle(ButtonStyle.Primary),
      );
    });

    const response = await interaction.reply({
      embeds: [embed],
      components: [row],
      fetchReply: true,
    });

    activePolls.set(interaction.user.id, {
      question,
      options,
      messageId: response.id,
      channelId: interaction.channelId,
      votes: new Map<number, number>(),
      voters: new Set<string>(),
    });
  }

  public async results(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const poll = activePolls.get(interaction.user.id) ?? {
      question: 'N/A',
      options: [],
      messageId: '',
      channelId: '',
      votes: new Map<number, number>(),
      voters: new Set<string>(),
    };

    if (!poll)
      await interaction.reply({
        content: '❌ No active poll found.',
        ephemeral: true,
      });
    return;

    const votes = poll.votes || new Map<number, number>();

    const resultLines = poll.options
      .map((option, index) => {
        const count = votes.get(index + 1) || 0;
        return `**${option}**: ${count} votes`;
      })
      .join('\n');

    const embed = new EmbedBuilder()
      .setTitle(`📈 Results for: ${poll.question}`)
      .setDescription(resultLines)
      .setColor(0x00ff9d);

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  public async close(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!activePolls.delete(interaction.user.id)) {
      await interaction.reply({
        content: '❌ No active poll.',
        ephemeral: true,
      });
      return;
    }
    await interaction.reply({ content: '✅ Poll closed.', ephemeral: true });
  }
}
