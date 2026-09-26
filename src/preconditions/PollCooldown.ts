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
import { checkAndRecordPollCooldown } from '../lib/pollSession.js';

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

    const remainingMs = await checkAndRecordPollCooldown(
      interaction.user.id,
      now,
      COOLDOWN_TIME,
    );
    if (remainingMs > 0) {
      const remaining = Math.ceil(remainingMs / 60000);
      await interaction.reply({
        content: `⏳ You can create another poll in **${remaining} ${remaining === 1 ? 'minute' : 'minutes'}**.`,
        ephemeral: true,
      });
      return this.error({
        message: `You can create another poll in ${remaining} ${remaining === 1 ? 'minute' : 'minutes'}.`,
      });
    }

    return this.ok();
  }
}
