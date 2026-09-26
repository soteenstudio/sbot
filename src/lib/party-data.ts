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

type Game = { label: string; roleId: string | undefined; maxPlayers: number };

export const Games: Record<string, Game> = {
  minecraft: {
    label: 'Minecraft',
    roleId: process.env.PARTY_ROLE_MINECRAFT,
    maxPlayers: 8,
  },
  valorant: {
    label: 'Valorant',
    roleId: process.env.PARTY_ROLE_VALORANT,
    maxPlayers: 5,
  },
  fortnite: {
    label: 'Fortnite',
    roleId: process.env.PARTY_ROLE_FORTNITE,
    maxPlayers: 4,
  },
};

export const activeParties = new Map<
  string,
  { hostId: string; gameKey: string }
>();
