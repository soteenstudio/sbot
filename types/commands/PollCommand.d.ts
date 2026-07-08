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
export declare class PollCommand extends Subcommand {
    constructor(context: Subcommand.LoaderContext, options: Subcommand.Options);
    registerApplicationCommands(registry: Subcommand.Registry): void;
    create(interaction: ChatInputCommandInteraction): Promise<void>;
    results(interaction: ChatInputCommandInteraction): Promise<void>;
    close(interaction: ChatInputCommandInteraction): Promise<void>;
}
