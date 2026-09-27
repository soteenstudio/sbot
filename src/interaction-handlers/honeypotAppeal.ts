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
  ButtonInteraction,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import 'dotenv/config';

const handledAppeals = new Set<string>();

export class HoneypotAppealHandler extends InteractionHandler {
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
    // Filter tombol khusus honeypot appeal
    if (interaction.customId.startsWith('honeypot_appeal_')) {
      return this.some();
    }
    return this.none();
  }

  public async run(interaction: ButtonInteraction) {
    console.log(`[Honeypot Appeal Handler] Triggered with customId: ${interaction.customId}`);

    const parts = interaction.customId.split('_');
    // Format: honeypot_appeal_<userId>_<guildId>
    const targetUserId = parts[2];
    const targetGuildId = parts[3];

    if (!targetUserId || !targetGuildId) {
      return interaction.reply({
        content: '❌ Invalid appeal data detected.',
        ephemeral: true,
      });
    }

    if (interaction.user.id !== targetUserId) {
      return interaction.reply({
        content: '❌ Only the banned user can submit this appeal.',
        ephemeral: true,
      });
    }

    const messageId = interaction.message.id;
    if (handledAppeals.has(messageId)) {
      return interaction.reply({
        content: 'Your appeal is already being processed or has been submitted.',
        ephemeral: true,
      });
    }

    handledAppeals.add(messageId);
    let submitted = false;

    try {
      await interaction.deferUpdate();

      const reportChannelId = process.env.REPORT_CHANNEL;
      const guild = await interaction.client.guilds
        .fetch(targetGuildId)
        .catch(() => null);
      
      const reportChannel =
        reportChannelId && guild
          ? await guild.channels.fetch(reportChannelId).catch(() => null)
          : undefined;

      if (!reportChannel || reportChannel.type !== ChannelType.GuildText) {
        return interaction.followUp({
          content: '❌ Your appeal could not be sent because the staff channel is not configured properly.',
          ephemeral: true,
        });
      }

      const user = await interaction.client.users
        .fetch(targetUserId)
        .catch(() => null);

      const embed = new EmbedBuilder()
        .setTitle('🚨 Honeypot Ban Appeal')
        .setDescription(
          `User **${user ? user.tag : targetUserId}** has submitted an appeal regarding their ban from the honeypot channel.`,
        )
        .addFields(
          {
            name: 'User Details',
            value: `${user ? user.tag : 'Unknown'} (${targetUserId})`,
            inline: true,
          },
          {
            name: 'Submitted',
            value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
            inline: true,
          },
        )
        .setColor(0xffa500)
        .setTimestamp();

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`report_done_${targetUserId}`)
          .setLabel('Mark as Resolved')
          .setStyle(ButtonStyle.Success),
      );

      await reportChannel.send({ embeds: [embed], components: [row] });
      submitted = true;

      return interaction.editReply({
        content: '✅ Your appeal has been successfully submitted to the server staff. Please wait for their response.',
        components: [],
      });
    } catch (error) {
      console.error('Failed to process honeypot appeal:', error);

      return interaction.followUp({
        content: submitted
          ? 'Your appeal was submitted, but the confirmation could not be updated.'
          : '❌ Failed to deliver your appeal. Please contact a server administrator directly.',
        ephemeral: true,
      });
    } finally {
      if (!submitted) handledAppeals.delete(messageId);
    }
  }
}