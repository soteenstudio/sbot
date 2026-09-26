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
import { deleteEmptyParty } from '../lib/party-data.js';

export class PartyVoiceCleanup extends Listener {
  public constructor(
    context: Listener.LoaderContext,
    options: Listener.Options,
  ) {
    super(context, { ...options, event: 'voiceStateUpdate' });
  }

  public override async run(oldState: VoiceState) {
    const channel = oldState.channel;
    if (channel) await deleteEmptyParty(channel);
  }
}
