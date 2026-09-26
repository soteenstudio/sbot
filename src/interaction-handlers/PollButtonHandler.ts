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
import { recordVote } from '../lib/pollSession.js';

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
    const result = await recordVote(
      authorId,
      interaction.message.id,
      index,
      interaction.user.id,
    );

    if (result === 'closed') {
      return interaction.editReply({
        content: '❌ This poll is no longer accepting votes.',
      });
    }

    if (result === 'invalid') {
      return interaction.editReply({
        content: '❌ This poll option is invalid.',
      });
    }

    if (result === 'duplicate') {
      return interaction.editReply({
        content: '⚠️ You have already voted in this poll.',
      });
    }

    await interaction.editReply({
      content: `✅ Your vote for option ${index} has been recorded.`,
    });
  }
}
