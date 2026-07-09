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

const client = new SapphireClient({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  loadMessageCommandListeners: true,
  baseUserDirectory: join(process.cwd(), 'dist'),
});

// Di index.ts, setelah inisialisasi client
client.stores.get('listeners').registerPath(join(process.cwd(), 'dist', 'listeners'));

async function main() {
  try {
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
