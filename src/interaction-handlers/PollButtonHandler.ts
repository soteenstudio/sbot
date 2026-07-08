/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import {
  InteractionHandler,
  InteractionHandlerTypes,
} from '@sapphire/framework';
import { ButtonInteraction } from 'discord.js';
import { activePolls } from '../lib/pollData.js';

export class PollButtonHandler extends InteractionHandler {
  public constructor(
    context: InteractionHandler.LoaderContext,
    options: InteractionHandler.Options,
  ) {
    super(context, {
      ...options,
      interactionHandlerType: InteractionHandlerTypes.Button,
    });
  }

  public override parse(interaction: ButtonInteraction) {
    if (!interaction.customId.startsWith('poll_')) return this.none();
    return this.some();
  }

  public async run(interaction: ButtonInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const [_, authorId, indexStr] = interaction.customId.split('_');
    const index = parseInt(indexStr, 10);
    const poll = activePolls.get(authorId);

    if (!poll) {
      return interaction.editReply({
        content: '❌ This poll is no longer active.',
      });
    }

    poll.voters ??= new Set<string>();

    if (poll.voters.has(interaction.user.id)) {
      return interaction.editReply({
        content: '⚠️ You already voted on this poll.',
      });
    }

    poll.voters.add(interaction.user.id);
    const currentVotes = poll.votes.get(index) || 0;
    poll.votes.set(index, currentVotes + 1);

    await interaction.editReply({ content: `✅ Voted for option ${index}` });
  }
}
