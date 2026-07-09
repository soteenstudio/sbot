/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { Subcommand } from '@sapphire/plugin-subcommands';
import { EmbedBuilder, ChatInputCommandInteraction } from 'discord.js';
import axios from 'axios';

export class MemeCommand extends Subcommand {
  public constructor(
    context: Subcommand.LoaderContext,
    options: Subcommand.Options,
  ) {
    super(context, {
      ...options,
      name: 'meme',
      description: 'Fetch a fresh meme from the internet.',
      subcommands: [
        { name: 'random', chatInputRun: 'random' },
        { name: 'hot', chatInputRun: 'hot' },
        { name: 'wholesome', chatInputRun: 'wholesome' },
      ],
    });
  }

  public override registerApplicationCommands(registry: Subcommand.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addSubcommand((sub) =>
          sub.setName('random').setDescription('Get a random meme'),
        )
        .addSubcommand((sub) =>
          sub.setName('hot').setDescription('Get hot memes'),
        )
        .addSubcommand((sub) =>
          sub.setName('wholesome').setDescription('Get wholesome memes'),
        ),
    );
  }

  public async fetchMeme(
    interaction: ChatInputCommandInteraction,
    subreddit?: string,
  ) {
    await interaction.deferReply();
    try {
      const url = subreddit
        ? `https://meme-api.com/gimme/${subreddit}`
        : 'https://meme-api.com/gimme';
      const response = await axios.get(url);
      const { title, url: imageUrl, postLink, author } = response.data;

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setURL(postLink)
        .setImage(imageUrl)
        .setColor(0x00ff9d)
        .setFooter({
          text: `Subreddit: r/${subreddit || 'random'} | u/${author}`,
        });

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      return interaction.editReply({ content: '❌ Failed to fetch meme.' });
    }
  }

  public async random(interaction: ChatInputCommandInteraction) {
    return this.fetchMeme(interaction);
  }
  public async hot(interaction: ChatInputCommandInteraction) {
    return this.fetchMeme(interaction, 'dankmemes');
  }
  public async wholesome(interaction: ChatInputCommandInteraction) {
    return this.fetchMeme(interaction, 'wholesomememes');
  }
}
