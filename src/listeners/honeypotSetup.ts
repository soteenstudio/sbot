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
import { ChannelType, Client, TextChannel, EmbedBuilder } from 'discord.js';
import 'dotenv/config';

const WARNING_TITLE = '⚠️ Honeypot Channel';
const LEGACY_WARNING_TITLE = '⚠️ Restricted Area / Honeypot';
const WARNING_DESCRIPTION =
  'Do not send messages in this channel. Posting here will remove your member role and time you out. If you do not submit an appeal, you will be banned after 3 hours.';
const WARNING_COLOR = 0xff0000;
const WARNING_FOOTER = 'SoTeen Studio • Honeypot';

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
      if (!channel || channel.type !== ChannelType.GuildText) return;

      const textChannel = channel as TextChannel;

      const messages = await textChannel.messages
        .fetch({ limit: 10 })
        .catch(() => null);

      const warning = messages?.find(
        (msg) =>
          msg.author.id === client.user?.id &&
          (msg.embeds[0]?.title === WARNING_TITLE ||
            msg.embeds[0]?.title === LEGACY_WARNING_TITLE),
      );

      const embed = new EmbedBuilder()
        .setTitle(WARNING_TITLE)
        .setDescription(WARNING_DESCRIPTION)
        .setColor(WARNING_COLOR)
        .setFooter({ text: WARNING_FOOTER })
        .setTimestamp();

      if (warning) {
        const current = warning.embeds[0];
        if (
          current.title !== WARNING_TITLE ||
          current.description !== WARNING_DESCRIPTION ||
          current.color !== WARNING_COLOR ||
          current.footer?.text !== WARNING_FOOTER
        ) {
          await warning.edit({ embeds: [embed] });
          console.log('[Honeypot Setup] Updated the honeypot warning.');
        }
        return;
      }

      await textChannel.send({ embeds: [embed] });
      console.log('[Honeypot Setup] Posted the honeypot warning.');
    } catch (error) {
      console.error(
        '[Honeypot Setup Error] Could not check or post the honeypot warning:',
        error,
      );
    }
  }
}
