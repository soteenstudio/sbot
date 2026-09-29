/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { SapphireClient, RegisterBehavior } from '@sapphire/framework';
import { GatewayIntentBits } from 'discord.js';
import 'dotenv/config';
import { join } from 'path';
import { createRequire } from 'module';
import { restoreLFGSessions } from './lib/lfgSession.js';
import { restorePolls } from './lib/pollSession.js';
import { restoreHoneypotBans } from './listeners/HoneypotListener.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const client = new SapphireClient({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
  loadMessageCommandListeners: true,
  baseUserDirectory: join(process.cwd(), 'dist'),
});

client.stores
  .get('listeners')
  .registerPath(join(process.cwd(), 'dist', 'listeners'));

async function main() {
  try {
    await restoreLFGSessions();
    await restorePolls();
    client.once('ready', () => {
      const guild = client.guilds.cache.get(process.env.GUILD_ID as string);
      const memberCount = guild ? guild.memberCount : 0;

      client.user?.setActivity('Custom Status', {
        type: 4,
        state: `v${version} | Listening to ${memberCount} members`,
      });

      void restoreHoneypotBans(client).catch((error) =>
        console.error('Failed to restore honeypot bans:', error as string),
      );
    });
    await client.login(process.env.TOKEN);
    console.log('The bot is online! Ready to execute.');

    client.on('ready', () => {
      console.log('--- Pieces Loaded ---');
      console.log('Commands:', client.stores.get('commands').size);
      console.log('Preconditions:', client.stores.get('preconditions').size);
    });
  } catch (error) {
    console.error('Login failed:', error);
    client.destroy();
    process.exit(1);
  }
}

main();
