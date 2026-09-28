/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
import { InteractionHandler } from '@sapphire/framework';
import { ModalSubmitInteraction } from 'discord.js';
import 'dotenv/config';
export declare class HoneypotAppealHandler extends InteractionHandler {
    constructor(context: InteractionHandler.LoaderContext, options: InteractionHandler.Options);
    parse(interaction: ModalSubmitInteraction): import("@sapphire/result").Option.Some<never> | import("@sapphire/result").Option.None<any>;
    run(interaction: ModalSubmitInteraction): Promise<import("discord.js").InteractionResponse<boolean> | undefined>;
}
