/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { Listener } from '@sapphire/framework';
import type { VoiceState } from 'discord.js';
import { activeParties } from '../lib/party-data.js';

const deletingParties = new Set<string>();

export class PartyVoiceCleanup extends Listener {
  public constructor(
    context: Listener.LoaderContext,
    options: Listener.Options,
  ) {
    super(context, { ...options, event: 'voiceStateUpdate' });
  }

  public override async run(oldState: VoiceState) {
    const channel = oldState.channel;
    if (
      !channel ||
      !activeParties.has(channel.id) ||
      deletingParties.has(channel.id)
    )
      return;
    if (channel.members.some((member) => !member.user.bot)) return;

    deletingParties.add(channel.id);
    try {
      await channel.delete();
      activeParties.delete(channel.id);
    } finally {
      deletingParties.delete(channel.id);
    }
  }
}
