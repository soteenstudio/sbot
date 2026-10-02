/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { Client } from 'discord.js';
import { subscriptionStore } from './subscriptionStore.js';

export function setupSubscriptionExpiryChecker(client: Client) {
  setInterval(
    async () => {
      try {
        const allRecords = await subscriptionStore.getAll();
        const now = Date.now();

        for (const record of allRecords) {
          if (now >= record.expiresAt) {
            const guild = client.guilds.cache.get(record.guildId);
            if (!guild) {
              await subscriptionStore.delete(record.guildId, record.userId);
              continue;
            }

            const member = await guild.members
              .fetch(record.userId)
              .catch(() => null);
            if (member) {
              await member.roles
                .remove(record.roleId, 'Subscription expired')
                .catch(() => {});
            }

            await subscriptionStore.delete(record.guildId, record.userId);
            console.log(
              `[Subscription] Expired and removed role for user ${record.userId} in guild ${record.guildId}`,
            );
          }
        }
      } catch (error) {
        console.error(
          '[Subscription Error] Failed to check expired subscriptions:',
          error,
        );
      }
    },
    60 * 60 * 1000,
  );
}
