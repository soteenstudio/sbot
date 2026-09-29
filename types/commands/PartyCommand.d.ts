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
export declare class PartyCommand extends Subcommand {
    constructor(context: Subcommand.LoaderContext, options: Subcommand.Options);
    registerApplicationCommands(registry: Subcommand.Registry): void;
    create(interaction: Subcommand.ChatInputCommandInteraction): Promise<import("discord.js").Message<boolean> | import("discord.js").InteractionResponse<boolean>>;
    close(interaction: Subcommand.ChatInputCommandInteraction): Promise<import("discord.js").InteractionResponse<boolean>>;
    kick(interaction: Subcommand.ChatInputCommandInteraction): Promise<import("discord.js").Message<boolean> | import("discord.js").InteractionResponse<boolean>>;
    list(interaction: Subcommand.ChatInputCommandInteraction): Promise<import("discord.js").InteractionResponse<boolean>>;
}
