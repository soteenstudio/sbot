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
import { CommandInteraction } from 'discord.js';
import { Roles } from '../config.js';
export declare class RequireRole extends Precondition {
    chatInputRun(interaction: CommandInteraction, _command: any, context: {
        level: keyof typeof Roles;
    }): Promise<import("@sapphire/result").Result<unknown, import("@sapphire/framework").UserError, boolean>>;
}
