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
import 'dotenv/config';
export declare class SubscriptionCommand extends Subcommand {
    static commandName: string;
    static commandDescription: string;
    constructor(context: Subcommand.LoaderContext, options: Subcommand.Options);
    registerApplicationCommands(registry: Subcommand.Registry): void;
    chatInputBuy(interaction: ChatInputCommandInteraction): Promise<void>;
    chatInputRenew(interaction: ChatInputCommandInteraction): Promise<void>;
    chatInputRefund(interaction: ChatInputCommandInteraction): Promise<void>;
    chatInputUpgrade(interaction: ChatInputCommandInteraction): Promise<void>;
    chatInputDowngrade(interaction: ChatInputCommandInteraction): Promise<void>;
    private submitPlanChange;
}
