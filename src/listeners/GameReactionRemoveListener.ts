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
import type { MessageReaction, User } from 'discord.js';
import { Games } from '../games.js';

const emojiMap: Record<string, string> = {
  '🧱': 'minecraft',
  '🌱': 'growtopia',
  '🟥': 'roblox',
  '🔥': 'freefire',
  '🗡️': 'mobilelegends',
  '✨': 'genshinimpact',
  '🎯': 'valorant',
  '⚓': 'neverland',
};

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

  public async run(reaction: MessageReaction, user: User) {
    if (user.bot) return;

    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch (error) {
        console.error('Failed to fetch reaction data:', error);
        return;
      }
    }

    if (reaction.message.channelId !== INTERESTS_CHANNEL) return;

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
  }
}
