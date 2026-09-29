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
import { Games } from '../games.js';

export const activeParties = new Map<
  string,
  { hostId: string; gameKey: string }
>();

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
