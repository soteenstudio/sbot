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
import {
  enqueueGameRoleChange,
  isGameSelectionMessage,
} from '../lib/gameSelection.js';

const INTERESTS_CHANNEL = process.env.INTERESTS_CHANNEL;

export class GameReactionRemoveListener extends Listener {
  public constructor(
    context: Listener.LoaderContext,
    options: Listener.Options,
  ) {
    super(context, {
      ...options,
      event: 'messageReactionRemove',
    });
  }

  public async run(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
  ) {
    if (user.bot || reaction.message.channelId !== INTERESTS_CHANNEL) return;
    if (
      !isGameSelectionMessage(reaction.message.channelId, reaction.message.id)
    )
      return;
    const gameKey = reaction.emoji.name && emojiMap[reaction.emoji.name];
    if (!gameKey) return;

    const key = `${reaction.message.guildId}:${user.id}:${gameKey}`;
    return enqueueGameRoleChange(key, async () => {
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

      if (user.bot) return;
      if (
        !isGameSelectionMessage(reaction.message.channelId, reaction.message.id)
      )
        return;

      const emojiName = reaction.emoji.name;
      if (!emojiName || !emojiMap[emojiName]) return;

      const gameKey = emojiMap[emojiName];
      const gameData = Games[gameKey];

      if (!gameData || !gameData.roleId) return;

      const guild = reaction.message.guild;
      if (!guild) return;

      try {
        const member = await guild.members.fetch(user.id);

        await member.roles.remove(gameData.roleId);
        console.log(
          `[Role Removed] Successfully removed ${gameData.label} role from ${user.tag}`,
        );
      } catch (error) {
        console.error('Failed to remove role:', error);
      }
    });
  }
}
