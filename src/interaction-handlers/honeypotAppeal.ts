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
  ModalSubmitInteraction,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import 'dotenv/config';
import { pendingHoneypotBans } from '../listeners/honeypot.js';

const handledAppeals = new Set<string>();

const modalOpenTimes = new Map<string, number>();

const activeCaptchas = new Map<
  string,
  { answer: number; stringCode: string }
>();

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

  public override parse(
    interaction: ButtonInteraction | ModalSubmitInteraction,
  ) {
    if (
      interaction.customId.startsWith('honeypot_appeal_') ||
      interaction.customId.startsWith('honeypot_modal_submit_') ||
      interaction.customId.startsWith('report_done_') ||
      interaction.customId.startsWith('report_ban_')
    ) {
      return this.some();
    }
    return this.none();
  }

  public async run(interaction: ButtonInteraction | ModalSubmitInteraction) {
    if (
      interaction.customId.startsWith('report_done_') ||
      interaction.customId.startsWith('report_ban_')
    ) {
      if (!interaction.isButton()) return;
      const parts = interaction.customId.split('_');
      const action = parts[1];
      const targetUserId = parts[2];
      const guildId = interaction.guildId;

      await interaction.deferUpdate();

      try {
        const user = await interaction.client.users
          .fetch(targetUserId)
          .catch(() => null);

        const oldEmbed = interaction.message.embeds[0]
          ? EmbedBuilder.from(interaction.message.embeds[0])
          : new EmbedBuilder();

        const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`report_done_${targetUserId}`)
            .setLabel('Mark as Resolved')
            .setStyle(ButtonStyle.Success)
            .setDisabled(true),
          new ButtonBuilder()
            .setCustomId(`report_ban_${targetUserId}`)
            .setLabel('Reject & Ban')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(true),
        );

        if (action === 'done') {
          if (guildId) {
            const guildObj = await interaction.client.guilds
              .fetch(guildId)
              .catch(() => null);
            const guildMember = guildObj
              ? await guildObj.members.fetch(targetUserId).catch(() => null)
              : null;
            if (guildMember) {
              await guildMember
                .timeout(null, 'Honeypot appeal approved by staff')
                .catch(() => {});
              if (process.env.ROLE_MEMBER) {
                await guildMember.roles
                  .add(process.env.ROLE_MEMBER)
                  .catch(() => {});
              }
            }
          }

          if (user) {
            await user
              .send({
                content:
                  '✅ **Good news!** Your honeypot ban appeal has been reviewed and approved by the staff. Your restriction is fully lifted.',
              })
              .catch(() => {});
          }

          oldEmbed.setColor(0x00ff00).addFields({
            name: 'Status',
            value: `✅ Resolved by <@${interaction.user.id}>`,
          });

          await interaction.message.edit({
            embeds: [oldEmbed],
            components: [disabledRow],
          });
        } else if (action === 'ban') {
          if (user) {
            await user
              .send({
                content:
                  '❌ **Your honeypot ban appeal has been rejected by the staff.** You have now been permanently banned from the server.',
              })
              .catch(() => {});
          }

          if (guildId) {
            const guild = await interaction.client.guilds
              .fetch(guildId)
              .catch(() => null);
            if (guild) {
              await guild.members
                .ban(targetUserId, {
                  reason: `Honeypot appeal rejected by ${interaction.user.tag}`,
                })
                .catch(() => {});
            }
          }

          oldEmbed.setColor(0xff0000).addFields({
            name: 'Status',
            value: `❌ Rejected & Banned by <@${interaction.user.id}>`,
          });

          await interaction.message.edit({
            embeds: [oldEmbed],
            components: [disabledRow],
          });
        }
      } catch (err) {
        console.error(
          '[Honeypot Appeal Handler] Failed to process staff action:',
          err,
        );
      }
      return;
    }

    if (
      interaction.isButton() &&
      interaction.customId.startsWith('honeypot_appeal_')
    ) {
      const parts = interaction.customId.split('_');
      const targetUserId = parts[2];
      const targetGuildId = parts[3];

      if (interaction.user.id !== targetUserId) {
        return interaction.reply({
          content: '❌ Only the banned user can submit this appeal.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const num1 = Math.floor(Math.random() * 10) + 1;
      const num2 = Math.floor(Math.random() * 10) + 1;
      const mathAnswer = num1 + num2;
      const randomString = Math.random()
        .toString(36)
        .substring(2, 8)
        .toUpperCase();

      activeCaptchas.set(targetUserId, {
        answer: mathAnswer,
        stringCode: randomString,
      });
      modalOpenTimes.set(targetUserId, Date.now());

      const modal = new ModalBuilder()
        .setCustomId(`honeypot_modal_submit_${targetUserId}_${targetGuildId}`)
        .setTitle('🛡️ Anti-Bot Security Verification');

      const mathInput = new TextInputBuilder()
        .setCustomId('captcha_math')
        .setLabel(`Berapa hasil dari: ${num1} + ${num2} ?`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Masukkan angka jawaban...')
        .setRequired(true);

      const stringInput = new TextInputBuilder()
        .setCustomId('captcha_string')
        .setLabel(`Ketik ulang teks acak berikut: ${randomString}`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Masukkan teks di atas...')
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(mathInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(stringInput),
      );

      await interaction.showModal(modal);
      return;
    }

    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith('honeypot_modal_submit_')
    ) {
      const parts = interaction.customId.split('_');
      const targetUserId = parts[3];
      const targetGuildId = parts[4];

      if (interaction.user.id !== targetUserId) {
        return interaction.reply({
          content: '❌ Invalid user session.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const messageId = interaction.message?.id ?? '';
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
            '❌ **Appeal Rejected:** Your submission was detected as automated behavior (too fast). Appeal process blocked.',
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
            '❌ **Verification Failed:** Jawaban captcha matematika atau teks acak salah. Silakan klik tombol appeal ulang.',
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
        step = 'canceling timer';

        const activeTimer = pendingHoneypotBans.get(targetUserId);
        if (activeTimer) {
          clearTimeout(activeTimer);
          pendingHoneypotBans.delete(targetUserId);
        }

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
              '❌ Your appeal could not be sent because the staff channel is not configured properly.',
          });
          return;
        }

        const user = await interaction.client.users
          .fetch(targetUserId)
          .catch(() => null);

        const embed = new EmbedBuilder()
          .setTitle('🚨 Honeypot Ban Appeal (Passed Captcha)')
          .setDescription(
            `User **${user ? user.tag : targetUserId}** has passed the security verification and submitted an appeal.`,
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
            {
              name: 'Security Check',
              value:
                '✅ Passed Math & String Captcha\n✅ Passed Time Validation',
              inline: false,
            },
          )
          .setColor(0xffa500)
          .setTimestamp();

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`report_done_${targetUserId}`)
            .setLabel('Mark as Resolved')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`report_ban_${targetUserId}`)
            .setLabel('Reject & Ban')
            .setStyle(ButtonStyle.Danger),
        );

        await reportChannel.send({ embeds: [embed], components: [row] });
        submitted = true;
        step = 'DM button update';

        try {
          if (interaction.message) {
            const disabledDmRow =
              new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                  .setCustomId(
                    `honeypot_appeal_${targetUserId}_${targetGuildId}`,
                  )
                  .setLabel('Appeal Submitted & Verified')
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
          content:
            '✅ **Verification Successful!** Your appeal has been securely submitted to the server staff. Please wait while staff reviews your case.',
        });
      } catch (error) {
        console.error(`[Honeypot Appeal Handler] Failed at ${step}:`, error);

        const response = {
          content: submitted
            ? 'Your appeal was submitted, but the confirmation could not be displayed.'
            : '❌ Failed to deliver your appeal. Please contact a server administrator directly.',
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
