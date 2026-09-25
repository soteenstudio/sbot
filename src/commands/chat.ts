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
import { EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { Roles } from '../config.js';
import { consumeChatUsage, getChatUsage, refundChatUsage } from '../lib/chatUsage.js';

const ROLE_LIMITS: Record<keyof typeof Roles, number> = {
  MEMBER: 4,
  DONATUR: 8,
  BILLION: 15,
  RICHMAN: 30,
  DEPUTY: 50,
  FOUNDER: 9999,
};

const OPENROUTER_TIMEOUT_MS = 60_000;

export class ChatCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'chat',
      description: 'Chat with AI via OpenRouter powered by SBot Engine',
      preconditions: [
        { name: 'RequireRole', context: { level: 'MEMBER' } } as any,
      ],
    });
  }

  public override registerApplicationCommands(registry: ApplicationCommandRegistry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .setDMPermission(false)
        .addStringOption((option) =>
          option
            .setName('message')
            .setDescription('The message or question for the AI')
            .setRequired(true),
        )
        .addBooleanOption((option) =>
          option
            .setName('tts')
            .setDescription('Enable Text-to-Speech audio output (Exclusive for high-tier roles)')
            .setRequired(false),
        ),
    );
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ) {
    const member = interaction.member;
    const memberRoleIds = member
      ? Array.isArray(member.roles) ? member.roles : [...member.roles.cache.keys()]
      : [];
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
      if (r.data.id && memberRoleIds.includes(r.data.id)) {
        userLimit = ROLE_LIMITS[r.key];
        matchedRoleName = r.key;
        break;
      }
    }

    const requestedTts = interaction.options.getBoolean('tts') ?? false;

    const allowedTtsRoles = ['RICHMAN', 'DEPUTY', 'FOUNDER'];
    if (requestedTts && !allowedTtsRoles.includes(matchedRoleName)) {
      return interaction.reply({
        content: `❌ The **TTS** feature is exclusive to high-tier roles (**Richman, Deputy, Founder**). Your current role is **${matchedRoleName}**.`,
        ephemeral: true,
      });
    }

    const now = Date.now();
    const userUsage = await getChatUsage(userId, now);

    if (userUsage.count >= userLimit) {
      return interaction.reply({
        content: `❌ You have reached your daily AI usage limit for the **${matchedRoleName}** role (${userUsage.count}/${userLimit}). Please try again tomorrow!`,
        ephemeral: true,
      });
    }

    const prompt = interaction.options.getString('message', true);

    await interaction.deferReply();

    let consumedUsage: typeof userUsage | undefined;
    try {
      const result = await consumeChatUsage(userId, now, userLimit);
      if (!result.consumed) {
        return interaction.editReply(`❌ You have reached your daily AI usage limit for the **${matchedRoleName}** role (${result.usage.count}/${userLimit}). Please try again tomorrow!`);
      }
      consumedUsage = result.usage;

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://discord.com',
          'X-Title': 'SBot Engine',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'inclusionai/ling-3.0-flash-fin:free',
          messages: [
            {
              role: 'system',
              content: 'You are an AI assistant powered by SBot Engine (AI powered by inclusionai/ling-3.0-flash-fin:free).',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      let replyMessage = data.choices?.[0]?.message?.content || 'Oops, received no response from the AI.';

      if (replyMessage.length > 4000) {
        replyMessage = replyMessage.substring(0, 3997) + '...';
      }

      const remainingLimit = userLimit - consumedUsage.count;

      const embed = new EmbedBuilder()
        .setTitle('🤖 AI Assistant')
        .setDescription(replyMessage)
        .setColor(0x00ff9d)
        .addFields(
          { name: '👤 Prompt by', value: `${interaction.user}`, inline: true },
          { name: '🛡️ Role Tier', value: `\`${matchedRoleName}\``, inline: true },
          { name: '⚡ Remaining Limit', value: `\`${remainingLimit}/${userLimit}\``, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'Powered by SBot Engine' });

      if (requestedTts) {
        const ttsResponse = await fetch('https://openrouter.ai/api/v1/audio/speech', {
          method: 'POST',
          signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
          headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'HTTP-Referer': 'https://discord.com',
            'X-Title': 'SBot Engine',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'fish-audio/s2.1-pro-free:free',
            input: replyMessage,
            voice: 'b347db033a6549378b48d00acb0d06cd',
            response_format: 'mp3',
          }),
        });

        if (ttsResponse.ok) {
          const arrayBuffer = await ttsResponse.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const attachment = new AttachmentBuilder(buffer, { name: 'speech.mp3' });

          return interaction.editReply({ 
            embeds: [embed], 
            files: [attachment] 
          });
        }

        return interaction.editReply({
          content: '⚠️ Audio generation failed. Here is your chat reply:',
          embeds: [embed],
        });
      }

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      if (consumedUsage) {
        try {
          await refundChatUsage(userId, consumedUsage.lastReset);
        } catch (refundError) {
          console.error(refundError);
        }
      }
      return interaction.editReply('An error occurred while connecting to the AI server. Please try again later!');
    }
  }
}
