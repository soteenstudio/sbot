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
import {
  ChannelType,
  Client,
  TextChannel,
  EmbedBuilder,
  Message,
} from 'discord.js';
import { Games } from '../games.js';
import { EMBED_COLORS } from '../engine/SEmbed.js';
import 'dotenv/config';
import { emojiMap } from '../config/emojiMap.js';
import {
  loadGameSelectionMessage,
  saveGameSelectionMessage,
} from '../lib/gameSelection.js';

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
      const isSelectionMessage = (message: Message) =>
        message.author.id === client.user?.id &&
        message.embeds[0]?.title === EMBED_TITLE;
      const savedId = await loadGameSelectionMessage(channelId);
      let existingMessage: Message | undefined;
      if (savedId) {
        try {
          const saved = await textChannel.messages.fetch(savedId);
          if (isSelectionMessage(saved)) existingMessage = saved;
        } catch (error) {
          if ((error as { code?: number }).code !== 10008) throw error;
        }
      }
      let before: string | undefined;
      while (!existingMessage) {
        const messages = await textChannel.messages.fetch({
          limit: 100,
          before,
        });
        existingMessage = messages.find(isSelectionMessage);
        if (existingMessage || messages.size === 0) break;
        before = messages.last()!.id;
      }

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
        await saveGameSelectionMessage(channelId, existingMessage.id);
        const currentEmbed = existingMessage.embeds[0];

        if (
          currentEmbed &&
          currentEmbed.title === EMBED_TITLE &&
          currentEmbed.description === expectedDescription
        ) {
          await ensureReactions(existingMessage);
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
        await ensureReactions(existingMessage);
        return;
      }

      const sentMessage = await textChannel.send({ embeds: [embed] });
      await saveGameSelectionMessage(channelId, sentMessage.id);
      await ensureReactions(sentMessage);

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

async function ensureReactions(message: Message) {
  for (const emoji of Object.keys(emojiMap)) {
    if (
      !message.reactions.cache.find(
        (reaction) => reaction.emoji.name === emoji && reaction.me,
      )
    ) {
      await message.react(emoji);
    }
  }
}
