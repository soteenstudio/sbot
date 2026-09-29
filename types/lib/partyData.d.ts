/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
import 'dotenv/config';
import { type GuildChannel } from 'discord.js';
export declare const activeParties: Map<string, {
    hostId: string;
    gameKey: string;
}>;
export declare function findHostedParty(hostId: string): [string, {
    hostId: string;
    gameKey: string;
}] | undefined;
export declare function getPartyChannelName(gameKey: string, hostId: string): string;
export declare function getMarkedParty(channel: GuildChannel): {
    hostId: string;
    gameKey: string;
} | undefined;
export declare function isUnknownChannel(error: unknown): boolean;
