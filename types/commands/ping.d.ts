/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
import { Command } from '@sapphire/framework';
export declare class PingCommand extends Command {
    constructor(context: Command.LoaderContext, options: Command.Options);
    registerApplicationCommands(registry: Command.Registry): void;
    chatInputRun(interaction: Command.ChatInputCommandInteraction): Promise<import("discord.js").Message<boolean>>;
}
