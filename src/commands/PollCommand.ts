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
      description: 'Create and manage polls.',
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
        .setDMPermission(false)
        .addSubcommand((sub) =>
          sub
            .setName('create')
            .setDescription('Create a new poll.')
            .addStringOption((o) =>
              o
                .setName('question')
                .setDescription('Question to ask voters')
                .setMaxLength(200)
                .setRequired(true),
            )
            .addStringOption((o) =>
              o
                .setName('options')
                .setDescription('Answer options separated by |')
                .setMaxLength(3000)
                .setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('results')
            .setDescription('View the results of your active poll.'),
        )
        .addSubcommand((sub) =>
          sub.setName('close').setDescription('Close your active poll.'),
        ),
    );
  }

  public async create(interaction: ChatInputCommandInteraction): Promise<void> {
    if (activePolls.has(interaction.user.id)) {
      await interaction.reply({
        content:
          '❌ You already have an active poll. Use `/poll close` before creating another.',
        ephemeral: true,
      });
      return;
    }

    const question = interaction.options.getString('question', true);
    const options = interaction.options.getString('options', true).split('|');
    if (options.length > 5) {
      await interaction.reply({
        content:
          '❌ A poll can have at most five answer options. Separate them with `|`.',
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('📊 Poll')
      .setDescription(
        `Question:\n${question}\n\n${options.map((option, index) => `${index + 1}. ${option}`).join('\n')}`,
      )
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
    const poll = activePolls.get(interaction.user.id);

    if (!poll) {
      await interaction.reply({
        content: '❌ You do not have an active poll.',
        ephemeral: true,
      });
      return;
    }

    const votes = poll.votes || new Map<number, number>();

    const resultLines = poll.options
      .map((option, index) => {
        const count = votes.get(index + 1) || 0;
        return `${index + 1}. ${option} — ${count} ${count === 1 ? 'vote' : 'votes'}`;
      })
      .join('\n');

    const embed = new EmbedBuilder()
      .setTitle('📈 Poll Results')
      .setDescription(`Question:\n${poll.question}\n\n${resultLines}`)
      .setColor(0x00ff9d);

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  public async close(interaction: ChatInputCommandInteraction): Promise<void> {
    const poll = activePolls.get(interaction.user.id);
    if (!poll) {
      await interaction.reply({
        content: '❌ You do not have an active poll to close.',
        ephemeral: true,
      });
      return;
    }

    activePolls.delete(interaction.user.id);

    try {
      const channel = await interaction.client.channels.fetch(poll.channelId);
      if (channel?.isTextBased()) {
        const message = await (channel as any).messages.fetch(poll.messageId);
        const disabledRow = new ActionRowBuilder<ButtonBuilder>();
        poll.options.forEach((_, i) => {
          disabledRow.addComponents(
            new ButtonBuilder()
              .setCustomId(`poll_${interaction.user.id}_${i + 1}`)
              .setLabel(`${i + 1}`)
              .setStyle(ButtonStyle.Primary)
              .setDisabled(true),
          );
        });
        await message.edit({ components: [disabledRow] });
      }
    } catch {}

    await interaction.reply({
      content: '✅ Your poll has been closed.',
      ephemeral: true,
    });
  }
}
