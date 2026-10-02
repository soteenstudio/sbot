/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
import { Listener } from '@sapphire/framework';
import type { MessageReaction, User, PartialMessageReaction, PartialUser } from 'discord.js';
export declare class GameReactionListener extends Listener {
    constructor(context: Listener.LoaderContext, options: Listener.Options);
    run(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser): Promise<void>;
}
