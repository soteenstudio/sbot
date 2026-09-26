/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { Command } from '@sapphire/framework';
import { ApplicationCommandRegistry } from '@sapphire/framework';
import { GuildMember, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { Roles } from '../config.js';
import { finishTTSUsage, reserveTTSUsage } from '../lib/ttsUsage.js';

const ROLE_LIMITS: Record<keyof typeof Roles, number> = {
  MEMBER: 4,
  DONATUR: 8,
  BILLION: 15,
  RICHMAN: 30,
  DEPUTY: 50,
  FOUNDER: 9999,
};

const OPENROUTER_TIMEOUT_MS = 60_000;

export class TssCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'tts',
      description: 'Convert text to speech audio.',
      preconditions: [
        { name: 'RequireRole', context: { level: 'MEMBER' } } as any,
      ],
    });
  }

  public override registerApplicationCommands(
    registry: ApplicationCommandRegistry,
  ) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .setDMPermission(false)
        .addStringOption((option) =>
          option
            .setName('text')
            .setDescription('Text to convert into speech')
            .setMaxLength(4086)
            .setRequired(true),
        ),
    );
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ) {
    const member = interaction.member as GuildMember;
    const userId = interaction.user.id;

    let userLimit = ROLE_LIMITS.MEMBER;
    let matchedRoleName = 'MEMBER';

    const sortedRoles = [
      { key: 'FOUNDER', data: Roles.FOUNDER },
      { key: 'DEPUTY', data: Roles.DEPUTY },
      { key: 'RICHMAN', data: Roles.RICHMAN },
      { key: 'BILLION', data: Roles.BILLION },
      { key: 'DONATUR', data: Roles.DONATUR },
      { key: 'MEMBER', data: Roles.MEMBER },
    ] as const;

    for (const r of sortedRoles) {
      if (r.data.id && member.roles.cache.has(r.data.id)) {
        userLimit = ROLE_LIMITS[r.key];
        matchedRoleName = r.key;
        break;
      }
    }

    let reservation;
    try {
      reservation = await reserveTTSUsage(userId, Date.now(), userLimit);
    } catch (error) {
      console.error(error);
      return interaction.reply({
        content:
          '❌ The speech service is unavailable. Please try again later.',
        ephemeral: true,
      });
    }

    if (!reservation.reservationId) {
      return interaction.reply({
        content: `❌ You have reached the daily speech generation limit for the **${matchedRoleName}** role (${reservation.usage.count}/${userLimit}). Please try again after your limit resets.`,
        ephemeral: true,
      });
    }

    const reservationId = reservation.reservationId;
    let finished = false;
    let deferred = false;

    try {
      const textInput = interaction.options.getString('text', true);
      await interaction.deferReply();
      deferred = true;
      const moderationResponse = await fetch(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          method: 'POST',
          signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'HTTP-Referer': 'https://discord.com',
            'X-Title': 'SoTeen Bot',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'inclusionai/ling-3.0-flash-fin:free',
            messages: [
              {
                role: 'system',
                content:
                  'You are a strict content moderator. Analyze if the given text contains profanity, slurs, explicit sexual content, or harsh insults (in any language, including Indonesian/slang). Reply with ONLY the word "SAFE" if it is clean, or "UNSAFE" if it contains inappropriate content.',
              },
              {
                role: 'user',
                content: textInput,
              },
            ],
          }),
        },
      );

      if (!moderationResponse.ok) {
        throw new Error(
          `Moderation HTTP error! status: ${moderationResponse.status}`,
        );
      }

      const modData = await moderationResponse.json();
      const modContent = modData.choices?.[0]?.message?.content;
      const modResult =
        typeof modContent === 'string' ? modContent.trim().toUpperCase() : '';

      if (modResult === 'UNSAFE') {
        await finishTTSUsage(
          userId,
          reservation.usage.lastReset,
          reservationId,
          true,
        );
        finished = true;
        return await interaction.editReply({
          content:
            '❌ This text cannot be converted to speech because it violates the content guidelines. Please revise it and try again.',
        });
      }

      if (modResult !== 'SAFE') {
        throw new Error(`Unexpected moderation result`);
      }

      const response = await fetch(
        'https://openrouter.ai/api/v1/audio/speech',
        {
          method: 'POST',
          signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'HTTP-Referer': 'https://discord.com',
            'X-Title': 'SoTeen Bot',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'fish-audio/s2.1-pro-free:free',
            input: textInput,
            voice: 'b347db033a6549378b48d00acb0d06cd',
            response_format: 'mp3',
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Commit before delivering audio. A failed storage write must not deliver
      // a generation whose quota cannot be tracked.
      await finishTTSUsage(
        userId,
        reservation.usage.lastReset,
        reservationId,
        false,
      );
      finished = true;
      const attachment = new AttachmentBuilder(buffer, { name: 'speech.mp3' });
      const remainingLimit = userLimit - reservation.usage.count;

      const embed = new EmbedBuilder()
        .setTitle('🗣️ Speech Generated')
        .setDescription(textInput)
        .setColor(0x00ff9d)
        .addFields(
          { name: 'Requested by', value: `${interaction.user}`, inline: true },
          { name: 'Role', value: `\`${matchedRoleName}\``, inline: true },
          {
            name: 'Generations remaining today',
            value: `\`${remainingLimit}/${userLimit}\``,
            inline: true,
          },
        )
        .setTimestamp()
        .setFooter({ text: 'Powered by SBot Engine' });

      return await interaction.editReply({
        embeds: [embed],
        files: [attachment],
      });
    } catch (error) {
      console.error(error);
      if (!finished) {
        try {
          await finishTTSUsage(
            userId,
            reservation.usage.lastReset,
            reservationId,
            true,
          );
        } catch (refundError) {
          // The pending reservation expires automatically if storage is unavailable.
          console.error(refundError);
        }
      }
      const message =
        '❌ The speech service is unavailable. Please try again later.';
      return deferred
        ? interaction.editReply(message)
        : interaction.reply({ content: message, ephemeral: true });
    }
  }
}
