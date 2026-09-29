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
import { Message, type Client } from 'discord.js';
import 'dotenv/config';
import { type HoneypotRecord } from '../lib/honeypotStore.js';
export declare const pendingHoneypotBans: Map<string, NodeJS.Timeout>;
export declare function cancelHoneypotBan(guildId: string, userId: string): void;
export declare function scheduleHoneypotBan(client: Client, record: HoneypotRecord): void;
export declare function restoreHoneypotBans(client: Client): Promise<void>;
export declare class HoneypotListener extends Listener {
    constructor(context: Listener.Context, options: Listener.Options);
    run(message: Message): Promise<void>;
}
