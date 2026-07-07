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
  PieceContext,
} from '@sapphire/framework';
import { ButtonInteraction } from 'discord.js';

export class EndSessionHandler extends InteractionHandler {
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
    return interaction.customId.startsWith('lfg_pro_end_')
      ? this.some()
      : this.none();
  }

  public async run(interaction: ButtonInteraction) {
    await interaction.deferUpdate();
    const channelId = interaction.customId.split('_')[3];
    const channel = interaction.guild?.channels.cache.get(channelId);

    if (channel) {
      await channel.delete().catch(() => null);
    }
  }
}
