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
import { ChatInputCommandInteraction } from 'discord.js';
export declare class PollCooldown extends Precondition {
    chatInputRun(interaction: ChatInputCommandInteraction): Promise<import("@sapphire/result").Result<unknown, import("@sapphire/framework").UserError, boolean>>;
}
