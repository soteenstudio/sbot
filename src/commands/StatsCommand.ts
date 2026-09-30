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
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  version as djsVersion,
} from 'discord.js';
import { createRequire } from 'module';
import os from 'os';
import { EMBED_COLORS } from '../engine/SEmbed.js';
import { cleanVersion } from '../utils/cleanVersion.js';
import { getHumanFriendlyOS } from '../utils/getHumanFriendlyOS.js';
import { getRAMUsage } from '../utils/getRAMUsage.js';
import { getCPUUsage } from '../utils/getCPUUsage.js';
import { getDiskUsage } from '../utils/getDiskUsage.js';
import { getLoadAvg } from '../utils/getLoadAvg.js';
const require = createRequire(import.meta.url);
const pkg = require('../../package.json');

export class StatsCommand extends Subcommand {
  public constructor(
    context: Subcommand.LoaderContext,
    options: Subcommand.Options,
  ) {
    super(context, {
      ...options,
      name: 'stats',
      description: 'View server information and bot performance.',
    });
  }

  public override registerApplicationCommands(registry: Subcommand.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .setDMPermission(false)
        .addStringOption((o) =>
          o
            .setName('show')
            .setDescription('Show specific stats')
            .addChoices(
              { name: 'Server', value: 'server' },
              { name: 'Bot', value: 'bot' },
              { name: 'VPS (Hosting)', value: 'vps' },
            ),
        ),
    );
  }

  public async chatInputRun(interaction: ChatInputCommandInteraction) {
    const { client } = interaction;
    const show = interaction.options.getString('show', false);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const totalSeconds = Math.floor(client.uptime! / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    const vpsTotalSeconds = Math.floor(os.uptime());
    const vpsDays = Math.floor(vpsTotalSeconds / 86400);
    const vpsHours = Math.floor((vpsTotalSeconds % 86400) / 3600);
    const vpsMinutes = Math.floor((vpsTotalSeconds % 3600) / 60);

    const cpuUsage = !show || show === 'vps' ? await getCPUUsage() : 'N/A';
    const ramUsage = getRAMUsage();
    const diskUsage = getDiskUsage();
    const loadAvg = getLoadAvg();

    const guild = interaction.guild!;

    const serverName = guild.name;
    const categoryCount = guild.channels.cache.filter(
      (channel) => channel.type === 4,
    ).size;
    const textChannelCount = guild.channels.cache.filter(
      (channel) => channel.type === 0,
    ).size;
    const voiceChannelCount = guild.channels.cache.filter(
      (channel) => channel.type === 2,
    ).size;
    const announcementChannelCount = guild.channels.cache.filter(
      (channel) => channel.type === 5,
    ).size;
    const stageVoiceChannelCount = guild.channels.cache.filter(
      (channel) => channel.type === 13,
    ).size;
    const forumChannelCount = guild.channels.cache.filter(
      (channel) => channel.type === 15,
    ).size;
    if (!show || show === 'server') {
      await guild.members.fetch();
    }
    const botCount = guild.members.cache.filter(
      (member) => member.user.bot,
    ).size;
    const memberCount = guild.memberCount - botCount;
    const totalBans =
      (!show || show === 'server') &&
      interaction.appPermissions?.has(PermissionFlagsBits.BanMembers)
        ? (await guild.bans.fetch()).size
        : 'N/A';
    const activeTimeouts = interaction.guild!.members.cache.filter(
      (member) =>
        member.communicationDisabledUntilTimestamp &&
        member.communicationDisabledUntilTimestamp > Date.now(),
    ).size;
    const ownerId = guild.ownerId;
    const timestamp = Math.floor(guild.createdTimestamp / 1000);

    const totalCommands = client.stores.get('commands').size;
    const totalListeners = client.stores.get('listeners').size;
    const totalInteractionHandlers = client.stores.get(
      'interaction-handlers',
    ).size;

    const loadAvgText =
      loadAvg?.oneMin && loadAvg.fiveMin && loadAvg.fifteenMin
        ? `\n**Load Average:**\n- **One Minute:** ${loadAvg?.oneMin}\n- **Five Minutes:** ${loadAvg.fiveMin}\n- **Fifteen Minutes:** ${loadAvg.fifteenMin}\n- **Percentage:** ${loadAvg.percentage}`
        : `\n**Load Average:** Unsupported`;

    const techStack = `\n**Technology Stack:**\n- **Library:** Discord.js ${djsVersion}\n- **Framework:** Sapphire ${cleanVersion(pkg.dependencies['@sapphire/framework'])}\n- **Language:** TypeScript ${cleanVersion(pkg.devDependencies['typescript'])}\n- **Engine :** SBot Engine ${pkg.version}`;

    const channels = `\n**Channels:**\n- **Texts:** ${textChannelCount}\n- **Voices:** ${voiceChannelCount}\n- **Announcements:** ${announcementChannelCount}\n- **Stage voices:** ${stageVoiceChannelCount}\n- **Forums:** ${forumChannelCount}`;
    const serverField = {
      name: 'Server',
      value: `**Name:** ${serverName}\n**Categories:** ${categoryCount}${channels}\n**Members:** ${memberCount}\n**Bots:** ${botCount}\n**Total bans:** ${totalBans}\n**Active timeouts:** ${activeTimeouts}\n**Created:** <t:${timestamp}:D> (<t:${timestamp}:R>)`,
      inline: true,
    };
    const botField = {
      name: 'Bot',
      value: `**Uptime:** ${days}d ${hours}h ${minutes}m\n**Servers served:** ${client.guilds.cache.size}\n**Gateway latency:** ${client.ws.ping} ms\n**Total commands:** ${totalCommands}\n**Total listeners:** ${totalListeners}\n**Total interaction handlers:** ${totalInteractionHandlers}${techStack}`,
      inline: true,
    };
    const vpsField = {
      name: 'VPS (Hosting)',
      value: `**Uptime:** ${vpsDays}d ${vpsHours}h ${vpsMinutes}m\n**Operating System:** ${getHumanFriendlyOS()}\n**CPU Usage:** ${cpuUsage}\n**RAM Usage:** ${ramUsage.used}/${ramUsage.total} (${ramUsage.percentage})\n**Disk Space:** ${diskUsage ? `${diskUsage.used}/${diskUsage.total} (${diskUsage.percentage})` : 'Unavailable'}${loadAvgText}`,
      inline: true,
    };

    let selectedFields = [serverField, botField, vpsField];

    if (show === 'server') {
      selectedFields = [serverField];
    } else if (show === 'bot') {
      selectedFields = [botField];
    } else if (show === 'vps') {
      selectedFields = [vpsField];
    }

    const embed = new EmbedBuilder()
      .setTitle('📊 Server and Bot Statistics')
      .setColor(EMBED_COLORS.SUCCESS)
      .addFields(selectedFields)
      .setFooter({ text: 'SoTeen Studio | Node.js ' + process.version })
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setEmoji('🔗')
        .setLabel('SBot Engine (GitHub)')
        .setStyle(ButtonStyle.Link)
        .setURL('https://github.com/soteenstudio/sbot'),
    );

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  }
}
