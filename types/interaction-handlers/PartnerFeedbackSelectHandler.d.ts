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
import { StringSelectMenuInteraction } from 'discord.js';
export declare class PartnerFeedbackSelectHandler extends InteractionHandler {
    constructor(context: InteractionHandler.LoaderContext, options: InteractionHandler.Options);
    parse(interaction: StringSelectMenuInteraction): import("@sapphire/result").Option.None<any> | import("@sapphire/result").Option.Some<never>;
    run(interaction: StringSelectMenuInteraction): Promise<void>;
}
