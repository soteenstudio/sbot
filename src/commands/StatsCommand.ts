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
  version as djsVersion,
} from 'discord.js';
import { createRequire } from 'module';
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
      description: 'View current system and bot performance.',
    });
  }

  public override registerApplicationCommands(registry: Subcommand.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder.setName(this.name).setDescription(this.description),
    );
  }

  public async chatInputRun(interaction: ChatInputCommandInteraction) {
    const { client } = interaction;

    const totalSeconds = Math.floor(client.uptime! / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    const guild = interaction.guild!;

    const memberCount = guild.memberCount;
    const serverName = guild.name;
    const ownerId = guild.ownerId;
    const timestamp = Math.floor(guild.createdTimestamp / 1000);

    const embed = new EmbedBuilder()
      .setTitle('📊 System Performance')
      .setColor(0x00ff9d)
      .addFields(
        {
          name: 'Server Stats',
          value: `**Name:** ${serverName}\n**Guilds:** ${client.guilds.cache.size}\n**Member Count:** ${memberCount}\n**Created At:** <t:${timestamp}:D> (<t:${timestamp}:R>)\n**Latency:** ${client.ws.ping}ms`,
          inline: true,
        },
        {
          name: 'Bot Stats',
          value: `**Uptime:** ${days}d ${hours}h ${minutes}m\n**Library:** Discord.js ${djsVersion}\n**Framework:** Sapphire ${pkg.dependencies['@sapphire/framework'].replace(/\v/g, '')}\n**Language:** TypeScript ${pkg.devDependencies['typescript'].replace(/\v/g, '')}\n**Engine:** SBot Engine ${pkg.version}`,
          inline: true,
        },
      )
      .setFooter({ text: 'SoTeen Studio | Node.js ' + process.version });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('SBot Engine (GitHub)')
        .setStyle(ButtonStyle.Link)
        .setURL('https://github.com/soteenstudio/sbot'),
    );

    return interaction.reply({ embeds: [embed], components: [row] });
  }
}
