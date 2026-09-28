/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { REST, Routes } from 'discord.js';
import 'dotenv/config';

async function clearCommands() {
  const token = process.env.TOKEN;
  const clientId = process.env.CLIENT_ID; // Pastikan CLIENT_ID ada di .env lu, atau ganti langsung dengan string ID bot lu

  if (!token || !clientId) {
    console.error('❌ Error: TOKEN atau CLIENT_ID tidak ditemukan di file .env!');
    process.exit(1);
  }

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    console.log('🧹 Sedang menghapus semua Global Application (Slash) Commands...');
    await rest.put(Routes.applicationCommands(clientId), { body: [] });
    console.log('✅ Berhasil menghapus semua Global Commands!');

    // Kalau bot lu juga pakai Guild Commands (command khusus server tertentu), uncomment baris di bawah ini:
    /*
    const guildId = process.env.GUILD_ID;
    if (guildId) {
      console.log(`🧹 Sedang menghapus Guild Commands untuk server: ${guildId}...`);
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });
      console.log('✅ Berhasil menghapus semua Guild Commands!');
    }
    */

    console.log('🎉 Semua command berhasil dibersihkan dari Discord!');
  } catch (error) {
    console.error('❌ Gagal membersihkan commands:', error);
  } finally {
    process.exit(0);
  }
}

clearCommands();