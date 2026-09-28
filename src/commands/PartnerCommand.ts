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
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
} from 'discord.js';

import { RARITY_TIERS } from '../config/rarities.js';
import { EmbedFactory } from '../engine/SEmbed.js';

type PartnerMode = 'fic' | 'user';

function rarityEmoji(tierName: string): string {
  const tier = tierName.toLowerCase();

  if (tier.includes('legendary') || tier.includes('mythic')) return '🌟';
  if (tier.includes('epic')) return '💜';
  if (tier.includes('rare')) return '💙';
  if (tier.includes('uncommon')) return '💚';

  return '⚪';
}

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
        { name: 'fic', chatInputRun: 'fic' },
        { name: 'user', chatInputRun: 'user' },
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

  private createPartnerEmbed(
    userId: string,
    partner: string,
    category: string,
    details: string,
  ): EmbedBuilder {
    return EmbedFactory.createFlexible({
      title: '🎲 Partner Selection',
      description: 'A partner has been selected.',
      fields: [
        { name: 'Partner', value: partner, inline: true },
        { name: 'Category', value: category, inline: true },
        { name: 'Details', value: details, inline: false },
      ],
    }).setFooter({
      text: `SoTeen Studio | Session ID: ${userId.slice(-4)}`,
    });
  }

  private generateFicEmbed(userId: string): EmbedBuilder {
    const totalWeight = RARITY_TIERS.reduce(
      (sum, tier) => sum + tier.weight,
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

    return this.createPartnerEmbed(
      userId,
      selectedChar.name,
      `${rarityEmoji(selectedTier.tier)} Fiction · ${selectedTier.tier}`,
      `${selectedChar.desc}\n\nDraw rate: ${rate}%\nSuggestions? Select Feedback below.`,
    );
  }

  private generateUserEmbed(
    userId: string,
    member: GuildMember,
  ): EmbedBuilder {
    return this.createPartnerEmbed(
      userId,
      member.user.username,
      '👤 Server member',
      `Selected for <@${userId}>.`,
    );
  }

  private createButtons(mode: PartnerMode): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`roll_again_${mode}`)
        .setLabel('🎲 Roll Again')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('partner_feedback_btn')
        .setLabel('💡 Feedback')
        .setStyle(ButtonStyle.Primary),
    );
  }

  private async startSession(
    interaction: ChatInputCommandInteraction,
    mode: PartnerMode,
    generateEmbed: () => EmbedBuilder,
  ): Promise<void> {
    const row = this.createButtons(mode);
    const response = await interaction.editReply({
      embeds: [generateEmbed()],
      components: [row],
    });

    const collector = response.createMessageComponentCollector({
      filter: (button) => button.customId === `roll_again_${mode}`,
      time: 60_000,
    });

    collector.on('collect', async (button: ButtonInteraction) => {
      if (button.user.id !== interaction.user.id) {
        await button.reply({
          content: '❌ This partner session belongs to another user.',
          ephemeral: true,
        });
        return;
      }

      await button.update({
        embeds: [generateEmbed()],
        components: [row],
      });
    });

    collector.on('end', async () => {
      await interaction.editReply({ components: [] }).catch(() => {});
    });
  }

  public async fic(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    try {
      await this.startSession(interaction, 'fic', () =>
        this.generateFicEmbed(interaction.user.id),
      );
    } catch (error) {
      await interaction.editReply({
        content: '❌ Could not select a partner. Please try again.',
        embeds: [],
        components: [],
      });
    }
  }

  public async user(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    try {
      const members = await interaction.guild?.members.fetch();
      if (!members) {
        await interaction.editReply({
          content: '❌ Could not fetch server members. Please try again.',
        });
        return;
      }

      const eligibleMembers = Array.from(members.values()).filter(
        (member) => !member.user.bot,
      );
      if (eligibleMembers.length === 0) {
        await interaction.editReply({
          content: '❌ No eligible server members are available.',
        });
        return;
      }

      await this.startSession(interaction, 'user', () => {
        const member =
          eligibleMembers[Math.floor(Math.random() * eligibleMembers.length)];
        return this.generateUserEmbed(interaction.user.id, member);
      });
    } catch (error) {
      await interaction.editReply({
        content: '❌ Could not select a partner. Please try again.',
        embeds: [],
        components: [],
      });
    }
  }
}
