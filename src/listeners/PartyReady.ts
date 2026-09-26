/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { Events, Listener } from '@sapphire/framework';
import type { Client } from 'discord.js';
import { activeParties, getMarkedParty } from '../lib/party-data.js';

export class PartyReady extends Listener<typeof Events.ClientReady> {
  public constructor(
    context: Listener.LoaderContext,
    options: Listener.Options,
  ) {
    super(context, { ...options, event: Events.ClientReady, once: true });
  }

  public override async run(client: Client<true>) {
    for (const guild of client.guilds.cache.values()) {
      try {
        const channels = await guild.channels.fetch();
        for (const channel of channels.values()) {
          if (!channel || activeParties.has(channel.id)) continue;
          const party = getMarkedParty(channel);
          if (!party) continue;

          activeParties.set(channel.id, party);
        }
      } catch (error) {
        console.error('Could not reconcile party channels:', error);
      }
    }
  }
}
