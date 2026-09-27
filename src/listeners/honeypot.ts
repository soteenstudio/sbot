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
          .timeout(timeoutDuration, 'Honeypot restriction pending appeal')
          .catch(() => {});

        const embed = new EmbedBuilder()
          .setTitle('⚠️ Honeypot Restriction')
          .setDescription(
            `You were temporarily restricted in **${message.guild.name}** for posting in a honeypot channel. Your member role was removed and you were timed out.\n\n` +
              'If this was a mistake, use the button below to appeal. You will be banned in 3 hours if you do not submit an appeal.',
          )
          .setColor(0xffa500)
          .setFooter({ text: 'Submit an appeal within 3 hours.' })
          .setTimestamp();

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(
              `honeypot_appeal_${message.author.id}_${message.guild.id}`,
            )
            .setLabel('Appeal Restriction')
            .setStyle(ButtonStyle.Primary),
        );

        try {
          await message.author.send({ embeds: [embed], components: [row] });
        } catch {
          console.log(
            `[Honeypot] Could not DM ${message.author.tag}; direct messages may be closed.`,
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
                reason: 'Honeypot appeal not submitted within 3 hours',
              });
              console.log(
                `[Honeypot] Banned ${message.author.tag} after the 3-hour appeal deadline.`,
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
