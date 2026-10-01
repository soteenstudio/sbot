/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { Listener, Events as SapphireEvents } from '@sapphire/framework';
import { ChannelType, Client, TextChannel, EmbedBuilder } from 'discord.js';
import { Games } from '../games.js';
import { EMBED_COLORS } from '../engine/SEmbed.js';
import 'dotenv/config';
import { emojiMap } from '../config/emojiMap.js';

const EMBED_TITLE = '🎮 Select Your Favorite Games!';
const EMBED_COLOR = EMBED_COLORS.SUCCESS;
const EMBED_FOOTER = 'SoTeen Studio • Interests';

export class GameEmbedSetupListener extends Listener {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, {
      ...options,
      event: SapphireEvents.ClientReady,
      once: true,
    });
  }

  public async run(client: Client) {
    const channelId = process.env.INTERESTS_CHANNEL;
    if (!channelId) {
      console.warn('[Game Setup] INTERESTS_CHANNEL is not defined in .env');
      return;
    }

    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText) {
        console.warn(
          '[Game Setup] Target channel is not a valid text channel.',
        );
        return;
      }

      const textChannel = channel as TextChannel;
      const messages = await textChannel.messages.fetch({ limit: 10 });

      const existingMessage = messages.find(
        (msg) =>
          msg.author.id === client.user?.id &&
          msg.embeds[0]?.title === EMBED_TITLE,
      );

      const description = Object.entries(emojiMap)
        .map(([emoji, key]) => {
          const game = Games[key];
          return game ? `(${emoji})---|\u00A0\u00A0**${game.label}**` : null;
        })
        .filter(Boolean)
        .join('\n\n');

      const expectedDescription = `React below to automatically get your favorite game roles!\n\n${description}`;

      const embed = new EmbedBuilder()
        .setTitle(EMBED_TITLE)
        .setDescription(expectedDescription)
        .setColor(EMBED_COLOR)
        .setFooter({ text: EMBED_FOOTER })
        .setTimestamp();

      if (existingMessage) {
        const currentEmbed = existingMessage.embeds[0];

        if (
          currentEmbed &&
          currentEmbed.title === EMBED_TITLE &&
          currentEmbed.description === expectedDescription
        ) {
          console.log(
            '[Game Setup] Game selection message is already up to date. Skipping.',
          );
          return;
        }

        try {
          await existingMessage.edit({ embeds: [embed] });
          console.log(
            '[Game Setup] Updated the existing game selection message.',
          );
        } catch (editError) {
          console.error(
            '[Game Setup Error] Failed to update existing message:',
            editError,
          );
        }
        return;
      }

      const sentMessage = await textChannel.send({ embeds: [embed] });
      for (const emoji of Object.keys(emojiMap)) {
        await sentMessage.react(emoji);
      }

      console.log(
        '[Game Setup] Posted a fresh game selection embed and added reactions.',
      );
    } catch (error) {
      console.error(
        '[Game Setup Error] Could not post or update game embed:',
        error,
      );
    }
  }
}
