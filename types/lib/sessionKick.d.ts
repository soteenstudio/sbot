/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
import type { GuildMember, VoiceChannel } from 'discord.js';
/** Deny this member access to one voice channel, then disconnect them from it. */
export declare function kickFromSession(channel: VoiceChannel, member: GuildMember): Promise<void>;
