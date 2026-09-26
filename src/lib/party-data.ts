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
import {
  ChannelType,
  OverwriteType,
  PermissionsBitField,
  RESTJSONErrorCodes,
  type GuildChannel,
} from 'discord.js';

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

export const activeParties = new Map<
  string,
  { hostId: string; gameKey: string }
>();

const deletingParties = new Set<string>();

export function findHostedParty(
  hostId: string,
): [string, { hostId: string; gameKey: string }] | undefined {
  for (const entry of activeParties.entries()) {
    if (entry[1].hostId === hostId) return entry;
  }
  return undefined;
}

export function getPartyChannelName(gameKey: string, hostId: string) {
  return `sbot-party-${gameKey}-${hostId}`;
}

export function getMarkedParty(channel: GuildChannel) {
  if (channel.type !== ChannelType.GuildVoice) return;
  const match = /^sbot-party-([a-z0-9_]+)-(\d{17,20})$/.exec(channel.name);
  if (!match) return;
  const [, gameKey, hostId] = match;
  const game = Object.hasOwn(Games, gameKey) ? Games[gameKey] : undefined;
  if (!game?.roleId) return;

  const everyone = channel.permissionOverwrites.cache.get(channel.guild.id);
  const role = channel.permissionOverwrites.cache.get(game.roleId);
  const host = channel.permissionOverwrites.cache.get(hostId);
  const access = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.Connect,
  ];
  if (
    everyone?.type !== OverwriteType.Role ||
    !everyone.deny.has(PermissionsBitField.Flags.ViewChannel) ||
    role?.type !== OverwriteType.Role ||
    !role.allow.has(access) ||
    host?.type !== OverwriteType.Member ||
    !host.allow.has(access)
  )
    return;

  return { hostId, gameKey };
}

export function isUnknownChannel(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === RESTJSONErrorCodes.UnknownChannel
  );
}

export async function deleteEmptyParty(channel: GuildChannel) {
  if (
    !activeParties.has(channel.id) ||
    deletingParties.has(channel.id) ||
    !channel.isVoiceBased() ||
    channel.members.some((member) => !member.user.bot)
  )
    return;

  deletingParties.add(channel.id);
  try {
    await channel.delete();
    activeParties.delete(channel.id);
  } catch (error) {
    console.error('Could not delete party channel:', error);
    if (isUnknownChannel(error)) activeParties.delete(channel.id);
  } finally {
    deletingParties.delete(channel.id);
  }
}
