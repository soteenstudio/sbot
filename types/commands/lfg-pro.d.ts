/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
import { Subcommand } from '@sapphire/plugin-subcommands';
import { ChatInputCommandInteraction } from 'discord.js';
export declare class LFGCommand extends Subcommand {
    constructor(context: Subcommand.LoaderContext, options: Subcommand.Options);
    registerApplicationCommands(registry: Subcommand.Registry): void;
    create(interaction: ChatInputCommandInteraction): Promise<void>;
    close(interaction: ChatInputCommandInteraction): Promise<import("discord.js").InteractionResponse<boolean>>;
    list(interaction: ChatInputCommandInteraction): Promise<import("discord.js").InteractionResponse<boolean>>;
}
