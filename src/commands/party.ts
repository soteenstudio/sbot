/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { Command } from '@sapphire/framework';
import { ChannelType, EmbedBuilder, PermissionsBitField } from 'discord.js';
import { activeParties, Games } from '../lib/party-data.js';

export class PartyCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'party',
      description: 'Create a private voice channel for a game.',
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .setDMPermission(false)
        .addStringOption((option) =>
          option
            .setName('game')
            .setDescription('Game to play')
            .setRequired(true)
            .addChoices(
              ...Object.entries(Games).map(([key, game]) => ({
                name: game.label,
                value: key,
              })),
            ),
        ),
    );
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ) {
    const gameKey = interaction.options.getString('game', true);
    const game = Object.hasOwn(Games, gameKey) ? Games[gameKey] : undefined;
    if (!game) {
      return interaction.reply({
        content: '❌ That game is not configured.',
        ephemeral: true,
      });
    }

    if (!interaction.guild || !game.roleId) {
      return interaction.reply({
        content:
          '❌ This party game is missing its server or role configuration.',
        ephemeral: true,
      });
    }

    await interaction.deferReply();
    const guild = interaction.guild;
    let channel;
    try {
      channel = await guild.channels.create({
        name: `${game.label}-${interaction.user.username}`,
        type: ChannelType.GuildVoice,
        userLimit: game.maxPlayers,
        permissionOverwrites: [
          { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          {
            id: game.roleId,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.Connect,
            ],
          },
          {
            id: interaction.user.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.Connect,
            ],
          },
        ],
      });
    } catch (error) {
      console.error('Could not create party channel:', error);
      return interaction.editReply(
        '❌ Could not create the party voice channel. Please try again later.',
      );
    }

    activeParties.set(channel.id, { hostId: interaction.user.id, gameKey });

    const embed = new EmbedBuilder()
      .setTitle('🎮 Party voice channel')
      .setColor(0x5865f2)
      .addFields(
        { name: 'Game', value: game.label, inline: true },
        { name: 'Player limit', value: String(game.maxPlayers), inline: true },
        { name: 'Voice channel', value: channel.toString() },
      );

    return interaction.editReply({
      content: `<@&${game.roleId}>`,
      embeds: [embed],
      allowedMentions: { roles: [game.roleId] },
    });
  }
}
