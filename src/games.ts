/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

type Game = { label: string; roleId: string | undefined; maxPlayers: number };

export const Games: Record<string, Game> = {
  minecraft: {
    label: 'Minecraft',
    roleId: process.env.PARTY_ROLE_MINECRAFT,
    maxPlayers: 8,
  },
  growtopia: {
    label: 'Growtopia',
    roleId: process.env.PARTY_ROLE_GROWTOPIA,
    maxPlayers: 8,
  },
  roblox: {
    label: 'Roblox',
    roleId: process.env.PARTY_ROLE_ROBLOX,
    maxPlayers: 8,
  },
  freefire: {
    label: 'Free Fire',
    roleId: process.env.PARTY_ROLE_FREEFIRE,
    maxPlayers: 4,
  },
  mobilelegends: {
    label: 'Mobile Legends',
    roleId: process.env.PARTY_ROLE_MOBILELEGENDS,
    maxPlayers: 5,
  },
  genshinimpact: {
    label: 'Genshin Impact',
    roleId: process.env.PARTY_ROLE_GENSHINIMPACT,
    maxPlayers: 4,
  },
  valorant: {
    label: 'Valorant',
    roleId: process.env.PARTY_ROLE_VALORANT,
    maxPlayers: 5,
  },
  neverland: {
    label: 'Neverland',
    roleId: process.env.PARTY_ROLE_NEVERLAND,
    maxPlayers: 8,
  },
};
