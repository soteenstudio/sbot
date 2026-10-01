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
import type {
  MessageReaction,
  User,
  PartialMessageReaction,
  PartialUser,
} from 'discord.js';
import { allowedEmojis } from '../config/allowedEmojis.js'

const INTERESTS_CHANNEL = process.env.INTERESTS_CHANNEL;
const EMBED_TITLE = '🎮 Select Your Favorite Games!';

export class GameReactionCleanupListener extends Listener {
  public constructor(
    context: Listener.LoaderContext,
    options: Listener.Options,
  ) {
    super(context, {
      ...options,
      event: 'messageReactionAdd',
    });
  }

  public async run(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
  ) {
    if (user.bot) return;

    if (reaction.partial) {
      try {
        reaction = await reaction.fetch();
      } catch (error) {
        console.error('Failed to fetch reaction data for cleanup:', error);
        return;
      }
    }

    if (reaction.message.channelId !== INTERESTS_CHANNEL) return;

    const message = reaction.message;
    if (message.embeds[0]?.title !== EMBED_TITLE) return;

    const emojiName = reaction.emoji.name;

    if (!emojiName || !allowedEmojis.includes(emojiName)) {
      try {
        await reaction.users.remove(user.id);
        console.log(
          `[Reaction Cleanup] Removed unauthorized emoji "${emojiName}" from ${user.tag}`,
        );
      } catch (error) {
        console.error(
          '[Reaction Cleanup Error] Failed to remove unauthorized reaction:',
          error,
        );
      }
    }
  }
}
