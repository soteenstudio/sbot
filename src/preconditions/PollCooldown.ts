/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { Precondition } from '@sapphire/framework';
import { CommandInteraction, GuildMember } from 'discord.js';
import { Roles } from '../config.js';

const cooldowns = new Map<string, number>();

export class PollCooldown extends Precondition {
  public async chatInputRun(interaction: CommandInteraction) {
    const member = (interaction.member as GuildMember) ?? 0;
    const now = Date.now();
    const COOLDOWN_TIME = 3600000;

    const isAdminOrAbove = member.roles.cache.some((role) => {
      const roleConfig = Object.values(Roles).find((r) => r.id === role.id);

      return roleConfig ? roleConfig.weight >= Roles.DEPUTY.weight : false;
    });

    if (isAdminOrAbove) return this.ok();

    const lastUsed = cooldowns.get(interaction.user.id);
    if (lastUsed && now - lastUsed < COOLDOWN_TIME) {
      const remaining = Math.ceil((COOLDOWN_TIME - (now - lastUsed)) / 60000);
      await interaction.reply({
        content: `⏳ You can create another poll in **${remaining} ${remaining === 1 ? 'minute' : 'minutes'}**.`,
        ephemeral: true,
      });
      return this.error({
        message: `You can create another poll in ${remaining} ${remaining === 1 ? 'minute' : 'minutes'}.`,
      });
    }

    cooldowns.set(interaction.user.id, now);
    return this.ok();
  }
}
