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

import { RARITY_TIERS } from '../config/rarities.js';

export class PartnerCommand extends Subcommand {
  public constructor(
    context: Subcommand.LoaderContext,
    options: Subcommand.Options,
  ) {
    super(context, {
      ...options,
      name: 'partner',
      description: 'SoTeen partner management system.',
      subcommands: [
        {
          name: 'fic',
          chatInputRun: 'fic',
        },
        {
          name: 'user',
          chatInputRun: 'user',
        },
      ],
    });
  }

  public override registerApplicationCommands(registry: Subcommand.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .setDMPermission(false)
        .addSubcommand((sub) =>
          sub
            .setName('fic')
            .setDescription('Draw a random partner from the fiction registry'),
        )
        .addSubcommand((sub) =>
          sub
            .setName('user')
            .setDescription('Select a random user from this server'),
        ),
    );
  }

  public async fic(interaction: ChatInputCommandInteraction) {
    const totalWeight = RARITY_TIERS.reduce(
      (sum, item) => sum + item.weight,
      0,
    );
    let random = Math.random() * totalWeight;

    let selectedTier = RARITY_TIERS[0];
    for (const tier of RARITY_TIERS) {
      random -= tier.weight;
      if (random <= 0) {
        selectedTier = tier;
        break;
      }
    }

    const selectedChar =
      selectedTier.chars[Math.floor(Math.random() * selectedTier.chars.length)];
    const rate = ((selectedTier.weight / totalWeight) * 100).toFixed(1);

    const embed = new EmbedBuilder()
      .setTitle('🤝 Partner Fiction Registry')
      .setDescription(
        `**Partner:** ${selectedChar.name}\n` +
          `**Rarity:** ${selectedTier.tier.toUpperCase()}\n` +
          `**Rate:** ${rate}%\n\n` +
          `> ${selectedChar.desc}`,
      )
      .setColor(0x00ff9d)
      .setFooter({ text: 'Session ID: ' + interaction.user.id.slice(-4) });

    return interaction.reply({ embeds: [embed] });
  }

  public async user(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();
    try {
      const members = await interaction.guild?.members.fetch();
      if (!members) {
        return interaction.editReply({
          content: '❌ Could not fetch members.',
        });
      }

      const memberArray = Array.from(members.values()).filter((m) => !m.user.bot);
      if (memberArray.length === 0) {
        return interaction.editReply({ content: '❌ No non-bot members found.' });
      }

      const randomMember =
        memberArray[Math.floor(Math.random() * memberArray.length)];

      const embed = new EmbedBuilder()
        .setTitle('👤 Partner User Selection')
        .setDescription(
          `Today's selected partner for ${interaction.user} is: **${randomMember.user.username}**`,
        )
        .setColor(0x00ff9d)
        .setFooter({ text: 'Session ID: ' + interaction.user.id.slice(-4) });

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      return interaction.editReply({ content: '❌ Failed to select a partner.' });
    }
  }
}
