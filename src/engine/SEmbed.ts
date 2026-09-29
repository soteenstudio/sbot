/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { EmbedBuilder, EmbedField } from 'discord.js';

/** Contextual embed border colours shared by every response embed. */
export const EMBED_COLORS = {
  /** Green/teal used for successful and branded result embeds. */
  SUCCESS: 0x00ff9d,
  /** Solid green used to confirm an action completed. */
  CONFIRMED: 0x00ff00,
  /** Yellow/orange reserved for warnings and pending states. */
  WARNING: 0xffa500,
  /** Red reserved for failures, rejections and destructive outcomes. */
  ERROR: 0xff0000,
  /** Blurple used for neutral informational notices. */
  INFO: 0x5865f2,
  /** Discord surface grey used for plain listings. */
  NEUTRAL: 0x2f3136,
} as const;

/** Standard footer applied to informational and result embeds. */
export const EMBED_FOOTER = 'SoTeen Studio';

/** Status prefixes every response message must start with. */
export const STATUS_EMOJI = {
  SUCCESS: '✅',
  ERROR: '❌',
  WARNING: '⚠️',
  LOADING: '⏳',
} as const;

export class EmbedFactory {
  private static readonly COLOR = EMBED_COLORS.SUCCESS;
  private static readonly FOOTER = EMBED_FOOTER;

  public static create(color: number = this.COLOR): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(color)
      .setFooter({ text: this.FOOTER })
      .setTimestamp();
  }

  public static createFlexible(data: {
    title?: string;
    description?: string;
    thumbnail?: string;
    image?: string;
    url?: string;
    author?: { name: string; iconURL?: string };
    fields?: EmbedField[];
    color?: number;
  }): EmbedBuilder {
    const embed = this.create(data.color);

    if (data.title) embed.setTitle(data.title);
    if (data.description) embed.setDescription(data.description);
    if (data.thumbnail) embed.setThumbnail(data.thumbnail);
    if (data.image) embed.setImage(data.image);
    if (data.url) embed.setURL(data.url);
    if (data.fields) embed.addFields(data.fields);
    if (data.author) embed.setAuthor(data.author);

    return embed;
  }
}
