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
/** Check whether a guild member meets or exceeds a configured role level. */
export declare function meetsRoleLevel(member: GuildMember | APIInteractionGuildMember | null | undefined, level: keyof typeof Roles): boolean;
