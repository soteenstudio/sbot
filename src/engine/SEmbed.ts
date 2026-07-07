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

export class EmbedFactory {
  private static readonly COLOR = 0x0099ff;
  private static readonly FOOTER = 'SoTeen Studio System';

  public static create(): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(this.COLOR)
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
    const embed = this.create();

    if (data.title) embed.setTitle(data.title);
    if (data.description) embed.setDescription(data.description);
    if (data.thumbnail) embed.setThumbnail(data.thumbnail);
    if (data.image) embed.setImage(data.image);
    if (data.url) embed.setURL(data.url);
    if (data.color) embed.setColor(data.color);
    if (data.fields) embed.addFields(data.fields);
    if (data.author) embed.setAuthor(data.author);

    return embed;
  }
}
