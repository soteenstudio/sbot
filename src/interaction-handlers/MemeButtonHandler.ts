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
import type { ButtonInteraction } from 'discord.js';
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import axios from 'axios';
import { EMBED_COLORS } from '../engine/SEmbed.js';
import { memeHistory, cleanupMemeHistory } from '../lib/memeStorage.js';

export class MemeButtonHandler extends InteractionHandler {
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
    if (!interaction.customId.startsWith('meme_')) return this.none();

    const parts = interaction.customId.split('_');
    const action = parts[1];
    const messageId = parts.slice(2).join('_');

    return this.some({ action, messageId });
  }

  public async run(
    interaction: ButtonInteraction,
    parsed: { action: string; messageId: string },
  ) {
    const session = await memeHistory.get(parsed.messageId);
    if (!session) {
      await interaction.reply({
        content:
          '❌ This meme session has expired or the data was cleared from memory.',
        ephemeral: true,
      });
      return;
    }

    if (interaction.user.id !== session.userId) {
      await interaction.reply({
        content:
          '❌ Only the user who requested this meme can use these buttons.',
        ephemeral: true,
      });
      return;
    }

    if (parsed.action === 'close') {
      await cleanupMemeHistory(parsed.messageId);

      const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`meme_prev_${parsed.messageId}`)
          .setLabel('Previous')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('⬅️')
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`meme_next_${parsed.messageId}`)
          .setLabel('Next')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('➡️')
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`meme_close_${parsed.messageId}`)
          .setLabel('Close')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🔒')
          .setDisabled(true),
      );

      await interaction.update({ components: [disabledRow] });
      return;
    }

    await interaction.deferUpdate();

    try {
      let targetMeme;

      if (parsed.action === 'prev') {
        if (session.currentIndex > 0) {
          session.currentIndex--;
        }
        targetMeme = session.history[session.currentIndex];
      } else {
        session.currentIndex++;
        if (session.currentIndex < session.history.length) {
          targetMeme = session.history[session.currentIndex];
        } else {
          const currentSub = session.history[0].subreddit;
          const actualSub = currentSub === 'random' ? undefined : currentSub;
          const url = actualSub
            ? `https://meme-api.com/gimme/${actualSub}`
            : 'https://meme-api.com/gimme';

          const response = await axios.get(url, { timeout: 10000 });
          const { title, url: imageUrl, postLink, author } = response.data;

          targetMeme = {
            title,
            imageUrl,
            postLink,
            author,
            subreddit: currentSub,
          };

          session.history.push(targetMeme);

          if (session.history.length > 20) {
            session.history.shift();
            session.currentIndex--;
          }
        }
      }

      await memeHistory.set(parsed.messageId, session);

      const embed = new EmbedBuilder()
        .setTitle(`😂 ${targetMeme.title}`)
        .setURL(targetMeme.postLink)
        .setImage(targetMeme.imageUrl)
        .setColor(EMBED_COLORS.SUCCESS)
        .setFooter({
          text: `Subreddit: r/${targetMeme.subreddit} | u/${targetMeme.author}`,
        })
        .setTimestamp();

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`meme_prev_${parsed.messageId}`)
          .setLabel('Previous')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('⬅️')
          .setDisabled(session.currentIndex === 0),
        new ButtonBuilder()
          .setCustomId(`meme_next_${parsed.messageId}`)
          .setLabel('Next')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('➡️'),
        new ButtonBuilder()
          .setCustomId(`meme_close_${parsed.messageId}`)
          .setLabel('Close')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🔒'),
      );

      await interaction.editReply({ embeds: [embed], components: [row] });
    } catch (error) {
      console.error('Could not fetch a meme via button:', error);
      await interaction.followUp({
        content: '❌ Could not fetch a new meme right now. Try again!',
        ephemeral: true,
      });
    }
  }
}
