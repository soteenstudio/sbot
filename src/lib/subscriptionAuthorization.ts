/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import type { GuildMember } from 'discord.js';
import { Roles } from '../config.js';
export function canVerifySubscription(member: GuildMember): boolean {
  return [Roles.FOUNDER.id, Roles.DEPUTY_SUBSCRIPTION.id].some((id) =>
    Boolean(id && member.roles.cache.has(id)),
  );
}
