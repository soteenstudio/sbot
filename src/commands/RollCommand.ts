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
import { ChatInputCommandInteraction } from 'discord.js';

export class RollCommand extends Subcommand {
  public constructor(
    context: Subcommand.LoaderContext,
    options: Subcommand.Options,
  ) {
    super(context, { ...options, name: 'roll' });
  }

  public override registerApplicationCommands(registry: Subcommand.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName('roll')
        .setDescription('Roll a random number')
        .setDMPermission(false)
        .addIntegerOption((o) =>
          o
            .setName('max')
            .setDescription('Max number (default 100)')
            .setMinValue(1),
        )
        .setDMPermission(false),
    );
  }

  public async chatInputRun(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const max = interaction.options.getInteger('max') || 100;
    const result = Math.floor(Math.random() * max) + 1;

    await interaction.reply({
      content: `🎲 **${interaction.user.username}** rolled a **${result}** (1-${max})`,
    });
    return;
  }
}
