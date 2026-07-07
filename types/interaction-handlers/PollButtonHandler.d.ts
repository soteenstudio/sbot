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
import { ButtonInteraction } from 'discord.js';
export declare class PollButtonHandler extends InteractionHandler {
    constructor(context: InteractionHandler.LoaderContext, options: InteractionHandler.Options);
    parse(interaction: ButtonInteraction): import("@sapphire/result").Option.Some<never> | import("@sapphire/result").Option.None<any>;
    run(interaction: ButtonInteraction): Promise<import("discord.js").Message<boolean> | undefined>;
}
