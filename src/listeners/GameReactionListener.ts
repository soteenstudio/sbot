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
import { Games } from '../games.js';
import { emojiMap } from '../config/emojiMap.js';

const INTERESTS_CHANNEL = process.env.INTERESTS_CHANNEL;

export class GameReactionListener extends Listener {
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
        console.error('Failed to fetch reaction data:', error);
        return;
      }
    }

    if (user.partial) {
      try {
        user = await user.fetch();
      } catch (error) {
        console.error('Failed to fetch user data:', error);
        return;
      }
    }

    if (reaction.message.channelId !== INTERESTS_CHANNEL) return;

    const emojiName = reaction.emoji.name;
    if (!emojiName || !emojiMap[emojiName]) return;

    const gameKey = emojiMap[emojiName];
    const gameData = Games[gameKey];

    if (!gameData || !gameData.roleId) {
      console.warn(
        `[Game Warning] Role ID for game "${gameKey}" is undefined in Games configuration.`,
      );
      return;
    }

    const guild = reaction.message.guild;
    if (!guild) return;

    try {
      const member = await guild.members.fetch(user.id);
      if (!member.roles.cache.has(gameData.roleId)) {
        await member.roles.add(gameData.roleId);
        console.log(
          `[Role Added] Successfully assigned ${gameData.label} role to ${user.tag}`,
        );
      }
    } catch (error) {
      console.error(
        `[Role Error] Failed to assign role for ${gameData.label}:`,
        error,
      );
    }
  }
}
