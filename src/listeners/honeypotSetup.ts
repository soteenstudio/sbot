/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { Listener, Events as SapphireEvents } from '@sapphire/framework';
import { Client, TextChannel, EmbedBuilder } from 'discord.js';
import 'dotenv/config';

export class HoneypotSetupListener extends Listener {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, {
      ...options,
      event: SapphireEvents.ClientReady,
      once: true,
    });
  }

  public async run(client: Client) {
    const honeypotChannelId = process.env.HONEYPOT_CHANNEL;
    if (!honeypotChannelId) return;

    try {
      const channel = await client.channels
        .fetch(honeypotChannelId)
        .catch(() => null);
      if (!channel || channel.type !== 0) return;

      const textChannel = channel as TextChannel;

      const messages = await textChannel.messages
        .fetch({ limit: 10 })
        .catch(() => null);

      const botAlreadySent = messages?.some(
        (msg) => msg.author.id === client.user?.id,
      );

      if (botAlreadySent) {
        console.log(
          '[Honeypot Setup] Pesan peringatan/peringkat sudah ada di channel, melewati pengiriman ulang.',
        );
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('⚠️ Restricted Area / Honeypot')
        .setDescription(
          'Dilarang keras mengirim pesan apa pun di channel ini!\n' +
            'Kirim pesan di sini akan mengakibatkan role member kamu dicabut dan akunmu di-timeout secara otomatis.',
        )
        .setColor(0xff0000)
        .setTimestamp();

      await textChannel.send({ embeds: [embed] });
      console.log(
        '[Honeypot Setup] Berhasil mengirim pesan peringatan ke channel honeypot.',
      );
    } catch (error) {
      console.error(
        '[Honeypot Setup Error] Gagal mengecek atau mengirim pesan ke channel honeypot:',
        error,
      );
    }
  }
}
