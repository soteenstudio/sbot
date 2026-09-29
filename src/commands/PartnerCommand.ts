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
  EmbedBuilder,
  ChatInputCommandInteraction,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ButtonInteraction,
} from 'discord.js';

import { EMBED_COLORS } from '../engine/SEmbed.js';
import { RARITY_TIERS } from '../config/rarities.js';

function getRarityStyle(tierName: string) {
  const lower = tierName.toLowerCase();

  if (lower.includes('legendary') || lower.includes('mythic')) {
    return { color: 0xf59e0b, emoji: '🌟' };
  }
  if (lower.includes('epic')) {
    return { color: 0xa855f7, emoji: '💜' };
  }
  if (lower.includes('rare')) {
    return { color: 0x3b82f6, emoji: '💙' };
  }
  if (lower.includes('uncommon')) {
    return { color: 0x10b981, emoji: '💚' };
  }

  return { color: 0x6b7280, emoji: '⚪' };
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

  private generateFicEmbed(userId: string) {
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
    const style = getRarityStyle(selectedTier.tier);

    const embed = new EmbedBuilder()
      .setTitle(`${style.emoji} Partner Fiction Registry`)
      .setDescription(
        `**Partner:** ${selectedChar.name}\n` +
          `**Rarity:** ${selectedTier.tier.toUpperCase()}\n` +
          `**Rate:** ${rate}%\n\n` +
          `> ${selectedChar.desc}`,
      )
      .setColor(style.color)
      .setFooter({
        text: `Session ID: ${userId.slice(-4)} | Fun gacha to appreciate Indonesian culture, no disrespect intended. Click feedback for suggestions.`,
      })
      .setTimestamp();

    return embed;
  }

  public async fic(interaction: ChatInputCommandInteraction) {
    const embed = this.generateFicEmbed(interaction.user.id);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('roll_again_fic')
        .setLabel('🎲 Roll Again')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('partner_feedback_btn')
        .setLabel('💡 Feedback')
        .setStyle(ButtonStyle.Primary),
    );

    const response = await interaction.reply({
      embeds: [embed],
      components: [row],
    });

    const collector = response.createMessageComponentCollector({
      filter: (i) => i.customId === 'roll_again_fic',
      time: 60000,
    });

    collector.on('collect', async (i: ButtonInteraction) => {
      if (i.user.id !== interaction.user.id) {
        await i.reply({
          content: "❌ This isn't your gacha session!",
          ephemeral: true,
        });
        return;
      }

      if (i.customId === 'roll_again_fic') {
        const newEmbed = this.generateFicEmbed(i.user.id);
        await i.update({ embeds: [newEmbed], components: [row] });
      }
    });

    collector.on('end', async () => {
      await interaction.editReply({ components: [] }).catch(() => {});
    });
  }

  /** Replace a public "thinking" placeholder with an ephemeral error. */
  private async replyPrivateError(
    interaction: ChatInputCommandInteraction,
    content: string,
  ) {
    await interaction.deleteReply().catch(() => null);
    return interaction.followUp({ content, ephemeral: true });
  }

  public async user(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();
    let published = false;
    try {
      const members = await interaction.guild?.members.fetch();
      if (!members) {
        return this.replyPrivateError(
          interaction,
          '❌ Could not read the member list. Please try again in a moment.',
        );
      }

      const memberArray = Array.from(members.values()).filter(
        (m) => !m.user.bot,
      );
      if (memberArray.length === 0) {
        return this.replyPrivateError(
          interaction,
          '❌ This server has no members to pick from yet.',
        );
      }

      const randomMember =
        memberArray[Math.floor(Math.random() * memberArray.length)];

      const embed = new EmbedBuilder()
        .setTitle('👤 Partner User Selection')
        .setDescription(
          `Today's selected partner for ${interaction.user} is: **${randomMember.user.username}**`,
        )
        .setColor(EMBED_COLORS.SUCCESS)
        .setFooter({ text: 'Session ID: ' + interaction.user.id.slice(-4) })
        .setTimestamp();

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('roll_again_user')
          .setLabel('🎲 Spin Again')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('partner_feedback_btn')
          .setLabel('💡 Feedback')
          .setStyle(ButtonStyle.Primary),
      );

      const response = await interaction.editReply({
        embeds: [embed],
        components: [row],
      });
      published = true;

      const collector = response.createMessageComponentCollector({
        filter: (i) => i.customId === 'roll_again_user',
        time: 60000,
      });

      collector.on('collect', async (i: ButtonInteraction) => {
        if (i.user.id !== interaction.user.id) {
          await i.reply({
            content: "❌ This isn't your session!",
            ephemeral: true,
          });
          return;
        }

        if (i.customId === 'roll_again_user') {
          const freshMember =
            memberArray[Math.floor(Math.random() * memberArray.length)];
          const newEmbed = new EmbedBuilder()
            .setTitle('👤 Partner User Selection')
            .setDescription(
              `Today's selected partner for ${i.user} is: **${freshMember.user.username}**`,
            )
            .setColor(EMBED_COLORS.SUCCESS)
            .setFooter({
              text: 'Session ID: ' + interaction.user.id.slice(-4),
            })
            .setTimestamp();

          await i.update({ embeds: [newEmbed], components: [row] });
        }
      });

      collector.on('end', async () => {
        await interaction.editReply({ components: [] }).catch(() => {});
      });
    } catch (error) {
      if (published) throw error;
      console.error('Could not select a partner user:', error);
      return this.replyPrivateError(
        interaction,
        '❌ Could not select a partner right now. Please try again in a moment.',
      );
    }
  }
}
