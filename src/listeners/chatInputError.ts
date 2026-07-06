/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { Listener, UserError } from '@sapphire/framework';
import { ChatInputCommandInteraction } from 'discord.js';

export class ChatInputError extends Listener {
  public constructor(
    context: Listener.LoaderContext,
    options: Listener.Options,
  ) {
    super(context, {
      ...options,
      event: 'chatInputError',
    });
  }

  public override async run(
    error: Error,
    { interaction }: { interaction: ChatInputCommandInteraction },
  ) {
    if (error instanceof UserError) {
      return interaction
        .reply({
          content: error.message,
          ephemeral: true,
        })
        .catch(() => null);
    }

    console.error(error);
    return interaction
      .reply({
        content: '❌ Terjadi error saat memproses command ini.',
        ephemeral: true,
      })
      .catch(() => null);
  }
}
