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
import {
  activeCaptchas,
  modalOpenTimes,
  handledAppeals,
  HONEYPOT_APPEAL_TITLE,
} from '../lib/honeypotAppeal.js';

export class HoneypotAppealButtonHandler extends InteractionHandler {
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
    if (
      interaction.customId.startsWith('honeypot_appeal_') ||
      ((interaction.customId.startsWith('report_done_') ||
        interaction.customId.startsWith('report_ban_')) &&
        interaction.message.embeds[0]?.title === HONEYPOT_APPEAL_TITLE)
    ) {
      return this.some();
    }
    return this.none();
  }

  public async run(interaction: ButtonInteraction) {
    if (
      interaction.customId.startsWith('report_done_') ||
      interaction.customId.startsWith('report_ban_')
    ) {
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
          handledAppeals.delete(targetUserId);
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
          handledAppeals.delete(targetUserId);
        }
      } catch (err) {
        console.error(
          '[Honeypot Appeal Handler] Failed to process staff action:',
          err,
        );
      }
      return;
    }

    if (interaction.customId.startsWith('honeypot_appeal_')) {
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
  }
}
