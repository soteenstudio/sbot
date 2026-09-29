/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import type { APIInteractionGuildMember, GuildMember } from 'discord.js';
import { Roles } from '../config.js';

/** Return the highest configured role weight held by a guild member. */
function getHighestRoleWeight(
  member: GuildMember | APIInteractionGuildMember,
): number {
  const memberRoleIds = Array.isArray(member.roles)
    ? member.roles
    : Array.from(member.roles.cache.keys());

  let highestWeight = 0;
  for (const roleId of memberRoleIds) {
    const matchedRole = Object.values(Roles).find((role) => role.id === roleId);
    if (matchedRole && matchedRole.weight > highestWeight) {
      highestWeight = matchedRole.weight;
    }
  }

  return highestWeight;
}

/** Check whether a guild member meets or exceeds a configured role level. */
export function meetsRoleLevel(
  member: GuildMember | APIInteractionGuildMember | null | undefined,
  level: keyof typeof Roles,
): boolean {
  if (!member) return false;
  return getHighestRoleWeight(member) >= Roles[level].weight;
}
