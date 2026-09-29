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
  MessageFlags,
} from 'discord.js';
import 'dotenv/config';
import { EMBED_COLORS, EMBED_FOOTER } from '../engine/SEmbed.js';

export class FeedbackCommand extends Subcommand {
  public static commandName: string = 'feedback';
  public static commandDescription: string =
    'Submit your feedback or suggestions to the server staff.';

  public constructor(
    context: Subcommand.LoaderContext,
    options: Subcommand.Options,
  ) {
    super(context, {
      ...options,
      name: FeedbackCommand.commandName,
      description: FeedbackCommand.commandDescription,
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
            .setName('content')
            .setDescription('Describe your feedback or suggestion')
            .setMaxLength(4000)
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('category')
            .setDescription('Type of feedback')
            .setRequired(true)
            .addChoices(
              { name: 'Suggestion', value: 'suggestion' },
              { name: 'Praise', value: 'praise' },
              { name: 'General Feedback', value: 'general' },
            ),
        )
        .setDMPermission(false),
    );
  }

  public async chatInputRun(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const feedbackContent = interaction.options.getString('content', true);
    const category = interaction.options.getString('category', true);
    const categoryName = category.charAt(0).toUpperCase() + category.slice(1);
    const feedbackChannelId = process.env.FEEDBACK_CHANNEL;
    const feedbackChannel = feedbackChannelId
      ? interaction.guild?.channels.cache.get(feedbackChannelId)
      : undefined;

    if (!feedbackChannel || feedbackChannel.type !== ChannelType.GuildText) {
      await interaction.reply({
        content:
          '❌ Feedback is unavailable because the staff channel is not configured.',
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`💡 New ${categoryName} Feedback`)
      .setDescription(feedbackContent)
      .addFields(
        {
          name: 'Author',
          value: `${interaction.user.tag} (${interaction.user.id})`,
          inline: true,
        },
        {
          name: 'Submitted',
          value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
          inline: true,
        },
        {
          name: 'Status',
          value: '⏳ Awaiting review',
          inline: true,
        },
      )
      .setColor(EMBED_COLORS.WARNING)
      .setFooter({ text: 'Review this feedback for server improvement.' })
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`feedback_done_${interaction.user.id}`)
        .setEmoji('✅')
        .setLabel('Mark as Reviewed')
        .setStyle(ButtonStyle.Success),
    );

    try {
      await feedbackChannel.send({ embeds: [embed], components: [row] });
    } catch (error) {
      console.error('Failed to send feedback to channel:', error);

      await interaction.reply({
        content:
          '❌ Your feedback could not be delivered. Please try again later.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const confirmation = new EmbedBuilder()
      .setTitle('✅ Feedback Submitted')
      .setDescription(
        'Your feedback has been successfully sent to the staff. Thank you for helping us improve!',
      )
      .setColor(EMBED_COLORS.CONFIRMED)
      .setFooter({ text: EMBED_FOOTER })
      .setTimestamp();

    try {
      await interaction.reply({
        embeds: [confirmation],
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('Failed to confirm delivered feedback:', error);
      try {
        const response = {
          content:
            'Your feedback was delivered, but the confirmation could not be displayed.',
          flags: MessageFlags.Ephemeral,
        } as const;
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(response);
        } else {
          await interaction.reply(response);
        }
      } catch (responseError) {
        console.error(
          'Failed to respond after feedback confirmation error:',
          responseError,
        );
      }
    }
  }
}
