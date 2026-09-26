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
import { ChannelType, EmbedBuilder, PermissionsBitField } from 'discord.js';
import {
  activeParties,
  deleteEmptyParty,
  findHostedParty,
  Games,
  getPartyChannelName,
  isUnknownChannel,
} from '../lib/party-data.js';
import { meetsRoleLevel } from '../lib/role-utils.js';

const pendingCreations = new Set<string>();

export class PartyCommand extends Subcommand {
  public constructor(
    context: Subcommand.LoaderContext,
    options: Subcommand.Options,
  ) {
    super(context, {
      ...options,
      name: 'party',
      description: 'Create and manage private voice party channels.',
      subcommands: [
        {
          name: 'create',
          chatInputRun: 'create',
          preconditions: [
            { name: 'RequireRole', context: { level: 'BILLION' } } as any,
          ],
        },
        {
          name: 'close',
          chatInputRun: 'close',
          preconditions: [
            { name: 'RequireRole', context: { level: 'BILLION' } } as any,
          ],
        },
        { name: 'list', chatInputRun: 'list' },
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
            .setName('create')
            .setDescription('Create a private voice channel for a game.')
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
            )
            .addIntegerOption((option) =>
              option
                .setName('max_players')
                .setDescription('Override the player limit (1-10).')
                .setMinValue(1)
                .setMaxValue(10)
                .setRequired(false),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('close')
            .setDescription('Close your active party voice channel.'),
        )
        .addSubcommand((sub) =>
          sub
            .setName('list')
            .setDescription('View all active party voice channels.'),
        ),
    );
  }

  public async create(interaction: Subcommand.ChatInputCommandInteraction) {
    const gameKey = interaction.options.getString('game', true);
    const maxPlayersOption = interaction.options.getInteger('max_players');
    if (
      maxPlayersOption !== null &&
      !meetsRoleLevel(interaction.member, 'RICHMAN')
    ) {
      return interaction.reply({
        content:
          '🚫 Only the **Richman** role or higher can set `max_players`. Send the command again without this option.',
        ephemeral: true,
      });
    }

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

    const hostId = interaction.user.id;
    if (pendingCreations.has(hostId) || findHostedParty(hostId)) {
      return interaction.reply({
        content:
          '❌ You already have an active party or one being created. Wait for creation to finish or close it with `/party close` first.',
        ephemeral: true,
      });
    }

    const maxPlayers = maxPlayersOption ?? game.maxPlayers;

    pendingCreations.add(hostId);
    try {
      await interaction.deferReply();
      const guild = interaction.guild;
      let channel;
      try {
        channel = await guild.channels.create({
          name: getPartyChannelName(gameKey, interaction.user.id),
          type: ChannelType.GuildVoice,
          userLimit: maxPlayers,
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
        return await interaction.editReply(
          '❌ Could not create the party voice channel. Please try again later.',
        );
      }

      activeParties.set(channel.id, { hostId: interaction.user.id, gameKey });

      const channelId = channel.id;
      setTimeout(
        async () => {
          if (!activeParties.has(channelId)) return;
          try {
            const fresh = await guild.channels.fetch(channelId, {
              force: true,
            });
            if (fresh?.isVoiceBased()) await deleteEmptyParty(fresh);
          } catch (error) {
            console.error('Could not fetch party channel for cleanup:', error);
            if (isUnknownChannel(error)) activeParties.delete(channelId);
          }
        },
        5 * 60 * 1000,
      ).unref();

      const embed = new EmbedBuilder()
        .setTitle('🎮 Party voice channel')
        .setColor(0x5865f2)
        .addFields(
          { name: 'Game', value: game.label, inline: true },
          {
            name: 'Player limit',
            value: String(maxPlayers),
            inline: true,
          },
          { name: 'Voice channel', value: channel.toString() },
        );

      return await interaction.editReply({
        content: `<@&${game.roleId}>`,
        embeds: [embed],
        allowedMentions: { roles: [game.roleId] },
      });
    } finally {
      pendingCreations.delete(hostId);
    }
  }

  public async close(interaction: Subcommand.ChatInputCommandInteraction) {
    const found = findHostedParty(interaction.user.id);
    if (!found) {
      return interaction.reply({
        content: '❌ You do not have an active party to close.',
        ephemeral: true,
      });
    }

    const [channelId] = found;
    try {
      if (!interaction.guild) throw new Error('Party server is unavailable.');
      const channel = await interaction.guild.channels.fetch(channelId);
      if (channel) await channel.delete();
    } catch (error) {
      if (!isUnknownChannel(error)) {
        console.error('Could not close party channel:', error);
        return interaction.reply({
          content:
            '❌ Could not close your party voice channel. Please try again later.',
          ephemeral: true,
        });
      }
    }

    activeParties.delete(channelId);

    return interaction.reply({
      content: '✅ Your party voice channel has been closed.',
      ephemeral: true,
    });
  }

  public async list(interaction: Subcommand.ChatInputCommandInteraction) {
    if (activeParties.size === 0) {
      return interaction.reply({
        content: 'No party voice channels are currently active.',
        ephemeral: true,
      });
    }

    const lines = Array.from(activeParties.entries()).map(
      ([channelId, party]) =>
        `• ${Games[party.gameKey]?.label ?? party.gameKey} | Host: <@${party.hostId}> | Channel: <#${channelId}>`,
    );
    const visibleLines: string[] = [];
    for (const line of lines) {
      if (visibleLines.join('\n').length + line.length + 1 > 4000) break;
      visibleLines.push(line);
    }
    const omitted = lines.length - visibleLines.length;
    const list =
      visibleLines.join('\n') +
      (omitted
        ? `\n${omitted} more ${omitted === 1 ? 'party' : 'parties'} not shown.`
        : '');
    const embed = new EmbedBuilder()
      .setTitle('Active Party Voice Channels')
      .setDescription(list)
      .setColor(0x2f3136);

    return interaction.reply({ embeds: [embed] });
  }
}
