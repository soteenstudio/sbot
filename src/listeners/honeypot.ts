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
      try {
        await message.delete();

        const embed = new EmbedBuilder()
          .setTitle('🛡️ You Have Been Banned')
          .setDescription(
            `You were automatically banned from **${message.guild.name}** for sending a message in a restricted honeypot channel.\n\n` +
              'If you believe this was a mistake or you entered the channel by accident, please click the button below to submit an appeal to the staff.',
          )
          .setColor(0xff0000)
          .setTimestamp();

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(
              `honeypot_appeal_${message.author.id}_${message.guild.id}`,
            )
            .setLabel('Appeal Ban')
            .setStyle(ButtonStyle.Danger),
        );

        try {
          await message.author.send({ embeds: [embed], components: [row] });
        } catch (dmError) {
          console.log(
            `[Honeypot] Gagal kirim DM ke ${message.author.tag} (kemungkinan DM ditutup/di-block).`,
          );
        }

        await message.guild.members.ban(message.author.id, {
          reason: 'Caught by Honeypot system (Spammer/Bot Detected)',
        });

        console.log(
          `[Honeypot] Successfully banned ${message.author.tag} after sending appeal DM.`,
        );
      } catch (error) {
        console.error('[Honeypot Error] Failed to action member:', error);
      }
    }
  }
}
