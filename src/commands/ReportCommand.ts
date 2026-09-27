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
import { deliverReportOnce } from '../lib/reportDelivery.js';

export class ReportCommand extends Subcommand {
  public constructor(
    context: Subcommand.LoaderContext,
    options: Subcommand.Options,
  ) {
    super(context, {
      ...options,
      name: 'report',
      description: 'Submit a report to the server staff.',
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
            .setDescription('Describe the issue you are reporting')
            .setMaxLength(4000)
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('category')
            .setDescription('Type of report')
            .setRequired(true)
            .addChoices(
              { name: 'Harassment', value: 'harassment' },
              { name: 'Bug or glitch', value: 'bug' },
              { name: 'Other', value: 'other' },
            ),
        )
        .setDMPermission(false),
    );
  }

  public async chatInputRun(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    console.log(`[Report] Command received for interaction ${interaction.id}`);
    const reason = interaction.options.getString('reason', true);
    const category = interaction.options.getString('category', true);
    const categoryName = category.charAt(0).toUpperCase() + category.slice(1);
    const reportChannelId = process.env.REPORT_CHANNEL;
    const reportChannel = reportChannelId
      ? interaction.guild?.channels.cache.get(reportChannelId)
      : undefined;

    if (!reportChannel || reportChannel.type !== ChannelType.GuildText) {
      await interaction.reply({
        content:
          '❌ Reports are unavailable because the staff channel is not configured.',
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`🚨 New ${categoryName} Report`)
      .setDescription(reason)
      .addFields(
        {
          name: 'Reporter',
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
          value: '⏳ Awaiting staff review',
          inline: false,
        },
      )
      .setColor(0xffa500)
      .setFooter({ text: 'Review this report before taking action.' })
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`report_done_${interaction.user.id}`)
        .setLabel('Mark as Resolved')
        .setStyle(ButtonStyle.Success),
    );

    try {
      const sent = await deliverReportOnce(interaction.id, async () => {
        console.log(
          `[Report] Sending interaction ${interaction.id} to staff channel ${reportChannel.id}`,
        );
        await reportChannel.send({
          embeds: [embed],
          components: [row],
          nonce: interaction.id,
          enforceNonce: true,
        });
      });
      console.log(
        `[Report] Interaction ${interaction.id} ${sent ? 'delivered to staff channel' : 'already delivered to staff channel'}`,
      );
      if (!sent && (interaction.replied || interaction.deferred)) return;
    } catch (error) {
      console.error(
        `[Report] Failed to deliver interaction ${interaction.id}:`,
        error,
      );

      await interaction.reply({
        content:
          '❌ Your report could not be delivered. Please contact a server administrator directly.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const confirmation = new EmbedBuilder()
      .setTitle('✅ Report Submitted')
      .setDescription(
        'Your report has been sent to the server staff. Thank you.',
      )
      .setColor(0x00ff00);

    try {
      await interaction.reply({
        embeds: [confirmation],
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('Failed to confirm delivered report:', error);
      try {
        const response = {
          content:
            'Your report was delivered, but the confirmation could not be displayed.',
          flags: MessageFlags.Ephemeral,
        } as const;
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(response);
        } else {
          await interaction.reply(response);
        }
      } catch (responseError) {
        console.error(
          'Failed to respond after report confirmation error:',
          responseError,
        );
      }
    }
  }
}
