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
import {
  Message,
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Client,
} from 'discord.js';
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import {
  getAllHoneypotRecords,
  updateHoneypotRecord,
  type HoneypotRecord,
} from '../lib/honeypotStore.js';

export const pendingHoneypotBans = new Map<string, NodeJS.Timeout>();
const banKey = (guildId: string, userId: string) => `${guildId}:${userId}`;
const BAN_DELAY = 3 * 60 * 60 * 1000;

export function cancelHoneypotBan(guildId: string, userId: string): void {
  const key = banKey(guildId, userId);
  const timer = pendingHoneypotBans.get(key);
  if (timer) clearTimeout(timer);
  pendingHoneypotBans.delete(key);
}

export function scheduleHoneypotBan(
  client: Client,
  record: HoneypotRecord,
): void {
  if (record.status !== 'pending' || record.deadline === null) return;
  const key = banKey(record.guildId, record.userId);
  cancelHoneypotBan(record.guildId, record.userId);
  const timer = setTimeout(
    async () => {
      try {
        await updateHoneypotRecord(
          record.guildId,
          record.userId,
          async (current) => {
            if (
              !current ||
              current.status !== 'pending' ||
              current.deadline === null ||
              current.token !== record.token ||
              current.deadline !== record.deadline ||
              Date.now() < current.deadline
            )
              return [current, false];
            const guild = await client.guilds.fetch(record.guildId);
            await guild.members.ban(record.userId, {
              reason: 'Honeypot appeal not submitted within 3 hours',
            });
            return [
              { ...current, status: 'banned', deadline: null, challenge: null },
              true,
            ];
          },
        );
      } catch (error) {
        console.error(
          `[Honeypot Error] Failed to auto-ban ${record.userId}:`,
          error,
        );
        if (pendingHoneypotBans.get(key) === timer) {
          pendingHoneypotBans.delete(key);
          const retry = setTimeout(
            () => scheduleHoneypotBan(client, record),
            60_000,
          );
          retry.unref();
          pendingHoneypotBans.set(key, retry);
        }
        return;
      }
      if (pendingHoneypotBans.get(key) === timer)
        pendingHoneypotBans.delete(key);
    },
    Math.max(0, record.deadline - Date.now()),
  );
  timer.unref();
  pendingHoneypotBans.set(key, timer);
}

export async function restoreHoneypotBans(client: Client): Promise<void> {
  for (const record of await getAllHoneypotRecords())
    scheduleHoneypotBan(client, record);
}

export class HoneypotListener extends Listener {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, {
      ...options,
      event: Events.MessageCreate,
    });
  }

  public async run(message: Message) {
    if (message.author.bot || !message.guild) return;

    const honeypotChannelId = process.env.HONEYPOT_CHANNEL;
    if (!honeypotChannelId) return;

    if (message.channelId === honeypotChannelId) {
      if (!message.member?.bannable) return;

      try {
        const record = await updateHoneypotRecord(
          message.guild.id,
          message.author.id,
          (current) => {
            if (current && current.status !== 'pending') return [current, null];
            const next: HoneypotRecord = {
              guildId: message.guild!.id,
              userId: message.author.id,
              deadline: Date.now() + BAN_DELAY,
              token: randomUUID(),
              status: 'pending',
              challenge: null,
            };
            return [next, next];
          },
        );
        if (!record) return;
        scheduleHoneypotBan(message.client, record);
        try {
          await message.delete();
        } catch (error) {
          console.error('[Honeypot Error] Failed to delete message:', error);
        }

        const member = message.member;
        const memberRoleId = process.env.ROLE_MEMBER;

        if (memberRoleId && member.roles.cache.has(memberRoleId)) {
          await member.roles.remove(memberRoleId).catch(() => {});
        }

        const timeoutDuration = BAN_DELAY;
        await member
          .timeout(timeoutDuration, 'Honeypot restriction pending appeal')
          .catch(() => {});

        const embed = new EmbedBuilder()
          .setTitle('⚠️ Honeypot Restriction')
          .setDescription(
            `You were temporarily restricted in **${message.guild.name}** for posting in a honeypot channel. Your member role was removed and you were timed out.\n\n` +
              'If this was a mistake, use the button below to appeal. You will be banned in 3 hours if you do not submit an appeal.',
          )
          .setColor(0xffa500)
          .setFooter({ text: 'Submit an appeal within 3 hours.' })
          .setTimestamp();

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(
              `honeypot_appeal_${message.author.id}_${message.guild.id}`,
            )
            .setLabel('Appeal Restriction')
            .setStyle(ButtonStyle.Primary),
        );

        try {
          await message.author.send({ embeds: [embed], components: [row] });
        } catch {
          console.log(
            `[Honeypot] Could not DM ${message.author.tag}; direct messages may be closed.`,
          );
        }

        console.log(
          `[Honeypot] Restricted ${message.author.tag} and scheduled auto-ban in 3 hours.`,
        );
      } catch (error) {
        console.error('[Honeypot Error] Failed to action member:', error);
      }
    }
  }
}
