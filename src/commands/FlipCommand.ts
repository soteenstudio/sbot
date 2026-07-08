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

export class FlipCommand extends Subcommand {
  public constructor(
    context: Subcommand.LoaderContext,
    options: Subcommand.Options,
  ) {
    super(context, { ...options, name: 'flip' });
  }

  public override registerApplicationCommands(registry: Subcommand.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName('flip')
        .setDescription('Flip a coin')
        .setDMPermission(false),
    );
  }

  public async chatInputRun(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const result = Math.random() < 0.5 ? 'Heads' : 'Tails';

    await interaction.reply({
      content: `🪙 **${interaction.user.username}** flipped a coin and got **${result}**!`,
    });
    return;
  }
}
