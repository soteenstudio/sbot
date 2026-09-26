/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

export type ActiveLFGSession = {
    game: string;
    rank: string;
    maxPlayers: number;
    author: string;
    authorId: string;
    channelId: string;
    messageId: string;
    vcId: string;
    participantIds: Set<string>;
    kickedIds: Set<string>;
};

/** Active sessions are keyed by their host's user ID. */
export const activeLFG = new Map<string, ActiveLFGSession>();
