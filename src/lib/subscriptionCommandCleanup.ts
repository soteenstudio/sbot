/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { ApplicationCommandType, type Client } from 'discord.js';

/** Remove retired global commands during the subscription command migration. */
export async function removeLegacySubscriptionCommands(
  client: Client,
): Promise<void> {
  try {
    if (!client.application) return;
    const commands = await client.application.commands.fetch();
    for (const command of commands.values()) {
      if (
        command.type === ApplicationCommandType.ChatInput &&
        ['buy', 'renew', 'refund'].includes(command.name)
      ) {
        await command.delete();
      }
    }
  } catch (error) {
    console.error(
      'Failed to remove legacy subscription commands; retry on next startup:',
      error,
    );
  }
}
