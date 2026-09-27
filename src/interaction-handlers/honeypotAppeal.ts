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
import { pendingHoneypotBans } from '../listeners/honeypot.js';

import {
  activeCaptchas,
  modalOpenTimes,
  handledAppeals,
  HONEYPOT_APPEAL_TITLE,
} from '../lib/honeypotAppeal.js';

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
    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith('honeypot_modal_submit_')
    ) {
      const parts = interaction.customId.split('_');
      const targetUserId = parts[3];
      const targetGuildId = parts[4];

      if (interaction.user.id !== targetUserId) {
        return interaction.reply({
          content: '❌ This appeal belongs to another user.',
          flags: MessageFlags.Ephemeral,
        });
      }

      if (handledAppeals.has(targetUserId)) {
        return interaction.reply({
          content: 'Your appeal has already been submitted.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const openTime = modalOpenTimes.get(targetUserId) || 0;
      const elapsedTime = (Date.now() - openTime) / 1000;
      const MIN_ALLOWED_SECONDS = 3;

      if (elapsedTime < MIN_ALLOWED_SECONDS) {
        return interaction.reply({
          content:
            '❌ Verification failed. Please wait a moment before submitting your appeal.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const userMathInput = interaction.fields
        .getTextInputValue('captcha_math')
        .trim();
      const userStringInput = interaction.fields
        .getTextInputValue('captcha_string')
        .trim();
      const storedCaptcha = activeCaptchas.get(targetUserId);

      if (
        !storedCaptcha ||
        parseInt(userMathInput, 10) !== storedCaptcha.answer ||
        userStringInput !== storedCaptcha.stringCode
      ) {
        return interaction.reply({
          content:
            '❌ Verification failed. Check both answers and click Appeal Restriction to try again.',
          flags: MessageFlags.Ephemeral,
        });
      }

      activeCaptchas.delete(targetUserId);
      modalOpenTimes.delete(targetUserId);
      handledAppeals.add(targetUserId);

      let submitted = false;
      let step = 'acknowledgment';

      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        step = 'staff-channel delivery';

        const reportChannelId = process.env.REPORT_CHANNEL;
        const guildObj = await interaction.client.guilds
          .fetch(targetGuildId)
          .catch(() => null);
        const guild =
          guildObj ??
          (await interaction.client.guilds
            .fetch(targetGuildId)
            .catch(() => null));

        const reportChannel =
          reportChannelId && guild
            ? await guild.channels.fetch(reportChannelId).catch(() => null)
            : undefined;

        if (!reportChannel || reportChannel.type !== ChannelType.GuildText) {
          await interaction.editReply({
            content:
              '❌ Your appeal could not be sent. Please contact a server administrator.',
          });
          return;
        }

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
              value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
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
        submitted = true;
        step = 'canceling timer';

        const activeTimer = pendingHoneypotBans.get(targetUserId);
        if (activeTimer) {
          clearTimeout(activeTimer);
          pendingHoneypotBans.delete(targetUserId);
        }

        step = 'DM button update';

        try {
          if (interaction.message) {
            const disabledDmRow =
              new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                  .setCustomId(
                    `honeypot_appeal_${targetUserId}_${targetGuildId}`,
                  )
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
            if (step === 'confirmation') {
              await interaction.followUp({
                ...response,
                flags: MessageFlags.Ephemeral,
              });
            } else {
              await interaction.editReply(response);
            }
          } else {
            await interaction.reply({
              ...response,
              flags: MessageFlags.Ephemeral,
            });
          }
        } catch (responseError) {
          console.error(
            '[Honeypot Appeal Handler] Failed to respond:',
            responseError,
          );
        }
      } finally {
        if (!submitted) handledAppeals.delete(targetUserId);
      }
    }
  }
}
