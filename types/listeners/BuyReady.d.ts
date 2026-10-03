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
import { type Client } from 'discord.js';
export declare class BuyReadyListener extends Listener {
    constructor(context: Listener.Context, options: Listener.Options);
    run(client: Client): void;
}
