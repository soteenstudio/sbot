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
import { Events, type Client } from 'discord.js';
import { setupSubscriptionExpiryChecker } from '../lib/subscriptionExpiryChecker.js';

import { removeLegacySubscriptionCommands } from '../lib/subscriptionCommandCleanup.js';

export class BuyReadyListener extends Listener {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, {
      ...options,
      once: true,
      event: Events.ClientReady,
    });
  }

  public run(client: Client) {
    console.log(`Logged in as ${client.user?.tag}!`);

    setupSubscriptionExpiryChecker(client);
    void removeLegacySubscriptionCommands(client);
  }
}
