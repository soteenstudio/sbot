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
  ModalSubmitInteraction,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import 'dotenv/config';
import { cancelHoneypotBan } from '../listeners/honeypot.js';
import { HONEYPOT_APPEAL_TITLE } from '../lib/honeypotAppeal.js';
import { updateHoneypotRecord } from '../lib/honeypotStore.js';

export class HoneypotAppealHandler extends InteractionHandler {
  public constructor(
    context: InteractionHandler.LoaderContext,
    options: InteractionHandler.Options,
  ) {
    super(context, {
      ...options,
      interactionHandlerType: InteractionHandlerTypes.ModalSubmit,
    });
  }

  public override parse(interaction: ModalSubmitInteraction) {
    return interaction.customId.startsWith('honeypot_modal_submit_')
      ? this.some()
      : this.none();
  }

  public async run(interaction: ModalSubmitInteraction) {
    const parts = interaction.customId.split('_');
    const targetUserId = parts[3];
    const targetGuildId = parts[4];
    if (interaction.user.id !== targetUserId) {
      return interaction.reply({
        content: '❌ This appeal belongs to another user.',
        flags: MessageFlags.Ephemeral,
      });
    }
    const userMathInput = interaction.fields
      .getTextInputValue('captcha_math')
      .trim();
    const userStringInput = interaction.fields
      .getTextInputValue('captcha_string')
      .trim();
    let submitted = false;
    let step = 'acknowledgment';
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      step = 'staff-channel delivery';
      const outcome = await updateHoneypotRecord(
        targetGuildId,
        targetUserId,
        async (current) => {
          if (!current || current.status !== 'pending')
            return [current, 'handled' as const];
          const now = Date.now();
          if (
            current.deadline === null ||
            now >= current.deadline ||
            !current.challenge ||
            now >= current.challenge.expiresAt
          )
            return [
              current.challenge ? { ...current, challenge: null } : current,
              'expired' as const,
            ];
          if (now - current.challenge.openedAt < 3_000)
            return [current, 'early' as const];
          if (
            userMathInput !== String(current.challenge.answer) ||
            userStringInput !== current.challenge.stringCode
          )
            return [current, 'invalid' as const];

          const reportChannelId = process.env.REPORT_CHANNEL;
          const guild = await interaction.client.guilds
            .fetch(targetGuildId)
            .catch(() => null);
          const reportChannel =
            reportChannelId && guild
              ? await guild.channels.fetch(reportChannelId).catch(() => null)
              : null;
          if (!reportChannel || reportChannel.type !== ChannelType.GuildText)
            return [current, 'unavailable' as const];
          const user = await interaction.client.users
            .fetch(targetUserId)
            .catch(() => null);
          const embed = new EmbedBuilder()
            .setTitle(HONEYPOT_APPEAL_TITLE)
            .setDescription(
              `**${user ? user.tag : targetUserId}** passed verification and submitted a honeypot appeal.`,
            )
            .addFields(
              {
                name: 'User',
                value: `${user ? user.tag : 'Unknown'} (${targetUserId})`,
                inline: true,
              },
              {
                name: 'Submitted',
                value: `<t:${Math.floor(now / 1000)}:R>`,
                inline: true,
              },
              {
                name: 'Verification',
                value: '✅ Challenge and time check passed',
                inline: false,
              },
            )
            .setColor(0xffa500)
            .setFooter({ text: 'Review this appeal before taking action.' })
            .setTimestamp();
          const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`report_done_${targetUserId}`)
              .setLabel('Approve Appeal')
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`report_ban_${targetUserId}`)
              .setLabel('Reject and Ban')
              .setStyle(ButtonStyle.Danger),
          );
          await reportChannel.send({ embeds: [embed], components: [row] });
          return [
            {
              ...current,
              status: 'submitted' as const,
              deadline: null,
              challenge: null,
            },
            'submitted' as const,
          ];
        },
      );
      if (outcome !== 'submitted') {
        await interaction.editReply({
          content:
            outcome === 'handled'
              ? 'Your appeal has already been submitted or reviewed.'
              : outcome === 'early'
                ? '❌ Verification failed. Please wait a moment before submitting your appeal.'
                : outcome === 'invalid'
                  ? '❌ Verification failed. Check both answers and click Appeal Restriction to try again.'
                  : outcome === 'expired'
                    ? '❌ This verification challenge expired. Click Appeal Restriction to try again.'
                    : '❌ Your appeal could not be sent. Please contact a server administrator.',
        });
        return;
      }
      submitted = true;
      cancelHoneypotBan(targetGuildId, targetUserId);
      step = 'DM button update';
      try {
        if (interaction.message) {
          const disabledDmRow =
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(`honeypot_appeal_${targetUserId}_${targetGuildId}`)
                .setLabel('Appeal Submitted')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
            );
          await interaction.message.edit({ components: [disabledDmRow] });
        }
      } catch (error) {
        console.error(
          '[Honeypot Appeal Handler] Failed to update DM button:',
          error,
        );
      }
      step = 'confirmation';
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('✅ Appeal Submitted')
            .setDescription(
              'Your appeal was submitted to staff. You will be notified after review.',
            )
            .setColor(0x00ff00),
        ],
      });
    } catch (error) {
      console.error(`[Honeypot Appeal Handler] Failed at ${step}:`, error);
      const response = {
        content: submitted
          ? 'Your appeal was submitted, but the confirmation could not be displayed.'
          : '❌ Your appeal could not be sent. Please contact a server administrator.',
      };
      try {
        if (interaction.deferred || interaction.replied) {
          if (step === 'confirmation')
            await interaction.followUp({
              ...response,
              flags: MessageFlags.Ephemeral,
            });
          else await interaction.editReply(response);
        } else
          await interaction.reply({
            ...response,
            flags: MessageFlags.Ephemeral,
          });
      } catch (responseError) {
        console.error(
          '[Honeypot Appeal Handler] Failed to respond:',
          responseError,
        );
      }
    }
  }
}
