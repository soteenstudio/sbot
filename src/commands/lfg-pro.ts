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
  ComponentType,
  ChannelType,
} from 'discord.js';
import { Games } from '../games.js';
import { activeLFG, type ActiveLFGSession } from '../lib/lfg-data.js';
import { isUnknownChannel } from '../lib/party-data.js';
import { meetsRoleLevel } from '../lib/role-utils.js';
import { kickFromSession } from '../lib/session-kick.js';
import {
  deleteLFGSession,
  getAllLFGSessions,
  saveLFGSession,
} from '../lib/lfgSession.js';

export class LFGCommand extends Subcommand {
  public constructor(
    context: Subcommand.LoaderContext,
    options: Subcommand.Options,
  ) {
    super(context, {
      ...options,
      name: 'lfg-pro',
      description: 'Create and manage premium looking-for-group sessions.',
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
        {
          name: 'kick',
          chatInputRun: 'kick',
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
            .setDescription('Create a premium looking-for-group session.')
            .addStringOption((o) =>
              o
                .setName('game')
                .setDescription('Name of the game')
                .addChoices(
                  ...Object.entries(Games).map(([key, game]) => ({
                    name: game.label,
                    value: key,
                  })),
                )
                .setRequired(true),
            )
            .addStringOption((o) =>
              o
                .setName('rank')
                .setDescription('Rank required to join')
                .setMaxLength(1000)
                .setRequired(true),
            )
            .addIntegerOption((o) =>
              o
                .setName('max_players')
                .setDescription('Maximum number of players')
                .setMinValue(2)
                .setMaxValue(10),
            ),
        )
        .addSubcommand((sub) =>
          sub.setName('close').setDescription('Close your active session.'),
        )
        .addSubcommand((sub) =>
          sub
            .setName('kick')
            .setDescription('Remove a participant from your active session.')
            .addUserOption((option) =>
              option
                .setName('participant')
                .setDescription('Participant to remove')
                .setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('list')
            .setDescription('View all active premium sessions.'),
        ),
    );
  }

  public async create(interaction: ChatInputCommandInteraction) {
    if (activeLFG.has(interaction.user.id)) {
      return interaction.reply({
        content:
          '❌ You already have an active session. Close it before creating another.',
        ephemeral: true,
      });
    }

    const gameKey = interaction.options.getString('game', true);
    const game = Games[gameKey]?.label ?? gameKey;
    const rank = interaction.options.getString('rank', true);
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
    const maxPlayers = maxPlayersOption ?? 2;

    const embed = new EmbedBuilder()
      .setTitle('🎮 Premium Looking-for-Group Session')
      .setDescription(
        `**Host:** ${interaction.user}\n**Game:** ${game}\n**Required rank:** ${rank}\n**Players:** 1/${maxPlayers}`,
      )
      .setColor(0x00ff9d)
      .setFooter({ text: 'Session ID: ' + interaction.user.id.slice(-4) });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`lfg_pro_join_${interaction.user.id}`)
        .setLabel('Request to Join')
        .setStyle(ButtonStyle.Success),
    );

    const response = await interaction.reply({
      embeds: [embed],
      components: [row],
      fetchReply: true,
    });

    const session: ActiveLFGSession = {
      game,
      rank,
      maxPlayers,
      author: interaction.user.tag,
      authorId: interaction.user.id,
      channelId: interaction.channelId!,
      messageId: response.id,
      vcId: '',
      participantIds: new Set(),
      kickedIds: new Set(),
    };
    await saveLFGSession(session);
    activeLFG.set(interaction.user.id, session);
  }

  public async close(interaction: ChatInputCommandInteraction) {
    const session = activeLFG.get(interaction.user.id);

    if (!session) {
      return interaction.reply({
        content: '❌ You do not have an active session to close.',
        ephemeral: true,
      });
    }

    if (session.vcId) {
      try {
        if (!interaction.guild)
          throw new Error('Session server is unavailable.');
        const channel = await interaction.guild.channels.fetch(session.vcId);
        if (channel) await channel.delete();
      } catch (error) {
        if (!isUnknownChannel(error)) {
          console.error('Could not close LFG voice channel:', error);
          return interaction.reply({
            content:
              '❌ Could not close the session voice channel. Please try again.',
            ephemeral: true,
          });
        }
      }
    }

    const channel = await interaction.client.channels
      .fetch(session.channelId)
      .catch(() => null);
    if (channel && channel.isTextBased()) {
      const message = await channel.messages
        .fetch(session.messageId)
        .catch(() => null);

      if (message) {
        const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId('disabled')
            .setLabel('Session Closed')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        );

        await message.edit({ components: [disabledRow] }).catch(() => null);
      }
    }

    await deleteLFGSession(interaction.user.id);
    activeLFG.delete(interaction.user.id);

    return interaction.reply({
      content: '✅ Your session has been closed.',
      ephemeral: true,
    });
  }

  public async kick(interaction: ChatInputCommandInteraction) {
    const session = activeLFG.get(interaction.user.id);
    if (!session || !session.vcId || !interaction.guild) {
      return interaction.reply({
        content:
          '❌ You do not have an active session voice channel to manage.',
        ephemeral: true,
      });
    }

    const participant = interaction.options.getUser('participant', true);
    if (
      participant.id === interaction.user.id ||
      participant.bot ||
      !session.participantIds.has(participant.id)
    ) {
      return interaction.reply({
        content: '❌ That user is not an eligible participant in your session.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });
    try {
      const channel = await interaction.guild.channels.fetch(session.vcId);
      if (
        channel?.type !== ChannelType.GuildVoice ||
        channel.guild.id !== interaction.guild.id
      ) {
        return interaction.editReply({
          content: '❌ Your session voice channel is unavailable.',
        });
      }
      const member = await interaction.guild.members.fetch(participant.id);
      await kickFromSession(channel, member);
      session.participantIds.delete(participant.id);
      session.kickedIds.add(participant.id);
      await saveLFGSession(session);

      try {
        const origin = await interaction.client.channels.fetch(
          session.channelId,
        );
        if (origin?.isTextBased()) {
          const message = await origin.messages.fetch(session.messageId);
          if (message?.embeds[0]) {
            const count = session.participantIds.size + 1;
            const embed = EmbedBuilder.from(message.embeds[0]);
            const description = embed.data.description?.replace(
              /\d+\/\d+/,
              `${count}/${session.maxPlayers}`,
            );
            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(`lfg_pro_join_${interaction.user.id}`)
                .setLabel('Request to Join')
                .setStyle(ButtonStyle.Success),
            );
            await message.edit({
              embeds: [embed.setDescription(description ?? null)],
              components: [row],
            });
          }
        }
      } catch (error) {
        console.error('Could not refresh LFG session message:', error);
      }

      return interaction.editReply({
        content: `✅ <@${participant.id}> has been removed from this session.`,
        allowedMentions: { users: [] },
      });
    } catch (error) {
      console.error('Could not kick LFG participant:', error);
      return interaction.editReply({
        content: '❌ Could not remove that participant. Please try again.',
      });
    }
  }

  public async list(interaction: ChatInputCommandInteraction) {
    const sessions = await getAllLFGSessions();
    if (sessions.length === 0) {
      return interaction.reply({
        content: 'No premium sessions are currently active.',
        ephemeral: true,
      });
    }

    const lines = sessions.map(
      (session) =>
        `• ${session.game} | Required rank: ${session.rank} | Host: ${session.author}`,
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
        ? `\n${omitted} more ${omitted === 1 ? 'session' : 'sessions'} not shown.`
        : '');
    const embed = new EmbedBuilder()
      .setTitle('Active Premium Sessions')
      .setDescription(list)
      .setColor(0x2f3136);

    return interaction.reply({ embeds: [embed] });
  }
}
