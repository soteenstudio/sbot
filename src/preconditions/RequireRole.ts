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

export class RequireRole extends Precondition {
  public async chatInputRun(
    interaction: CommandInteraction,
    _command: any,
    context: { level: keyof typeof Roles },
  ) {
    const member = interaction.member as GuildMember;
    if (!member) return this.error({ message: 'User not found.' });

    const targetRole = Roles[context.level];

    const hasSufficientAccess = member.roles.cache.some((role) => {
      const userRoleConfig = Object.values(Roles).find((r) => r.id === role.id);
      return userRoleConfig && userRoleConfig.weight >= targetRole.weight;
    });

    if (hasSufficientAccess) {
      return this.ok();
    } else {
      const formattedLevel =
        context.level.charAt(0).toUpperCase() +
        context.level.slice(1).toLowerCase();

      await interaction.reply({
        content: `🚫 **Access Denied**: This action is reserved for **${formattedLevel}** rank and above.`,
        ephemeral: true,
      });

      return this.error({ message: 'Access Denied' });
    }
  }
}
