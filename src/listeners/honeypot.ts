/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { Listener } from '@sapphire/framework';
import {
  Message,
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import 'dotenv/config';

export const pendingHoneypotBans = new Map<string, NodeJS.Timeout>();

export class HoneypotListener extends Listener {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, {
      ...options,
      event: Events.MessageCreate,
    });
  }

  public async run(message: Message) {
    if (message.author.bot || !message.guild) return;

    const honeypotChannelId = process.env.HONEYPOT_CHANNEL;
    if (!honeypotChannelId) return;

    if (message.channelId === honeypotChannelId) {
      if (!message.member?.bannable) return;

      try {
        try {
          await message.delete();
        } catch (error) {
          console.error('[Honeypot Error] Failed to delete message:', error);
        }

        const member = message.member;
        const memberRoleId = process.env.ROLE_MEMBER;

        if (memberRoleId && member.roles.cache.has(memberRoleId)) {
          await member.roles.remove(memberRoleId).catch(() => {});
        }

        const timeoutDuration = 3 * 60 * 60 * 1000;
        await member
          .timeout(timeoutDuration, 'Caught by Honeypot system (Under Review)')
          .catch(() => {});

        const embed = new EmbedBuilder()
          .setTitle('🛡️ Security Notice: Action Required')
          .setDescription(
            `You have been temporarily restricted in **${message.guild.name}** for sending a message in a restricted honeypot channel.\n\n` +
              'Your member role has been temporarily removed and your account is muted. If you believe this was a mistake, please click the button below to submit an appeal immediately.\n\n' +
              '*(Note: If no appeal is submitted, you will be automatically banned after 3 hours.)*',
          )
          .setColor(0xffa500)
          .setTimestamp();

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(
              `honeypot_appeal_${message.author.id}_${message.guild.id}`,
            )
            .setLabel('Appeal Restriction')
            .setStyle(ButtonStyle.Danger),
        );

        try {
          await message.author.send({ embeds: [embed], components: [row] });
        } catch (dmError) {
          console.log(
            `[Honeypot] Gagal kirim DM ke ${message.author.tag} (kemungkinan DM ditutup/di-block).`,
          );
        }

        const existingTimer = pendingHoneypotBans.get(message.author.id);
        if (existingTimer) clearTimeout(existingTimer);

        const banTimeout = setTimeout(async () => {
          try {
            const guild = await message.client.guilds
              .fetch(message.guild!.id)
              .catch(() => null);
            if (guild) {
              await guild.members.ban(message.author.id, {
                reason:
                  'Ignored Honeypot restriction / Failed to appeal in time',
              });
              console.log(
                `[Honeypot] Auto-banned ${message.author.tag} after appeal timeout.`,
              );
            }
          } catch (err) {
            console.error(
              `[Honeypot Error] Failed to auto-ban ${message.author.tag}:`,
              err,
            );
          } finally {
            if (pendingHoneypotBans.get(message.author.id) === banTimeout) {
              pendingHoneypotBans.delete(message.author.id);
            }
          }
        }, timeoutDuration);

        pendingHoneypotBans.set(message.author.id, banTimeout);

        console.log(
          `[Honeypot] Restricted ${message.author.tag} and scheduled auto-ban in 3 hours.`,
        );
      } catch (error) {
        console.error('[Honeypot Error] Failed to action member:', error);
      }
    }
  }
}
