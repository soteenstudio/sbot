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
import { meetsRoleLevel } from '../lib/roleUtils.js';
import { isHoneypotAppealTitle } from '../lib/honeypotAppeal.js';
import { updateHoneypotRecord } from '../lib/honeypotStore.js';

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
        isHoneypotAppealTitle(interaction.message.embeds[0]?.title))
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
      if (!meetsRoleLevel(interaction.member, 'DEPUTY')) {
        return interaction.reply({
          content:
            '❌ You need the Deputy role or higher to review honeypot appeals.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const parts = interaction.customId.split('_');
      const action = parts[1];
      const targetUserId = parts[2];
      const guildId = interaction.guildId;

      await interaction.deferUpdate();

      try {
        if (!guildId) return;
        const reviewed = await updateHoneypotRecord(
          guildId,
          targetUserId,
          async (current) => {
            if (!current || current.status !== 'submitted')
              return [current, false];
            if (action === 'done') {
              const guild = await interaction.client.guilds.fetch(guildId);
              const member = await guild.members
                .fetch(targetUserId)
                .catch((error: { code?: number }) => {
                  if (error.code === 10007) return null;
                  throw error;
                });
              if (member) {
                await member.timeout(null, 'Honeypot appeal approved by staff');
                if (process.env.ROLE_MEMBER)
                  await member.roles.add(process.env.ROLE_MEMBER);
              }
            } else if (action === 'ban') {
              const guild = await interaction.client.guilds.fetch(guildId);
              await guild.members.ban(targetUserId, {
                reason: `Honeypot appeal rejected by ${interaction.user.tag}`,
              });
            } else return [current, false];
            return [
              {
                ...current,
                status:
                  action === 'done'
                    ? ('approved' as const)
                    : ('rejected' as const),
                challenge: null,
              },
              true,
            ];
          },
        );
        if (!reviewed) return;
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
          if (user) {
            await user
              .send({
                content:
                  '✅ Your honeypot appeal was approved. Your restriction has been lifted.',
              })
              .catch(() => {});
          }

          oldEmbed
            .setColor(0x00ff00)
            .addFields({
              name: 'Status',
              value: `✅ Approved by <@${interaction.user.id}>`,
            })
            .setFooter({ text: `Approved by ${interaction.user.tag}` });

          await interaction.message.edit({
            embeds: [oldEmbed],
            components: [disabledRow],
          });
        } else if (action === 'ban') {
          if (user) {
            await user
              .send({
                content:
                  '❌ Your honeypot appeal was rejected. You have been banned from the server.',
              })
              .catch(() => {});
          }

          oldEmbed
            .setColor(0xff0000)
            .addFields({
              name: 'Status',
              value: `❌ Rejected and banned by <@${interaction.user.id}>`,
            })
            .setFooter({ text: `Rejected by ${interaction.user.tag}` });

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

    if (interaction.customId.startsWith('honeypot_appeal_')) {
      const parts = interaction.customId.split('_');
      const targetUserId = parts[2];
      const targetGuildId = parts[3];

      if (interaction.user.id !== targetUserId) {
        return interaction.reply({
          content: '❌ Only the affected user can submit this appeal.',
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

      const openedAt = Date.now();
      const stored = await updateHoneypotRecord(
        targetGuildId,
        targetUserId,
        (current) => {
          if (
            !current ||
            current.status !== 'pending' ||
            current.deadline === null ||
            current.deadline <= openedAt
          )
            return [current, false];
          return [
            {
              ...current,
              challenge: {
                answer: mathAnswer,
                stringCode: randomString,
                openedAt,
                expiresAt: Math.min(current.deadline, openedAt + 10 * 60_000),
              },
            },
            true,
          ];
        },
      );
      if (!stored)
        return interaction.reply({
          content: 'This appeal is no longer available.',
          flags: MessageFlags.Ephemeral,
        });

      const modal = new ModalBuilder()
        .setCustomId(`honeypot_modal_submit_${targetUserId}_${targetGuildId}`)
        .setTitle('Honeypot Appeal Verification');

      const mathInput = new TextInputBuilder()
        .setCustomId('captcha_math')
        .setLabel(`What is ${num1} + ${num2}?`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter the answer')
        .setRequired(true);

      const stringInput = new TextInputBuilder()
        .setCustomId('captcha_string')
        .setLabel(`Type this code: ${randomString}`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter the code above')
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(mathInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(stringInput),
      );

      try {
        await interaction.showModal(modal);
      } catch (error) {
        await updateHoneypotRecord(targetGuildId, targetUserId, (current) => {
          if (!current || current.challenge?.stringCode !== randomString)
            return [current, undefined];
          return [{ ...current, challenge: null }, undefined];
        });
        throw error;
      }
      return;
    }
  }
}
