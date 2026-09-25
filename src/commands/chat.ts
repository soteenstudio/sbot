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

const contentMsg = `
You are an AI-powered Discord bot.
Your name: SoTeen Bot
Creator: SoTeen Studio (Indonesia, Bali)
Models used: Ling 3.0 Flash Fin (inclusionai/ling-3.0-flash-fin:free, LLM model, from OpenRouter) and Fish Audio S2.1 Pro (fish-audio/s2.1-pro-free:free, TTS model, from OpenRouter)
Your version: v0.1.0
`;

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
      description: 'Ask the AI assistant a question.',
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
            .setDescription('Your message or question for the AI assistant')
            .setRequired(true),
        )
        .addBooleanOption((option) =>
          option
            .setName('tts')
            .setDescription('Include spoken audio (Richman, Deputy, or Founder roles)')
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
        content: `❌ Audio replies require the Richman, Deputy, or Founder role. Your current role is **${matchedRoleName}**.`,
        ephemeral: true,
      });
    }

    const now = Date.now();
    let userUsage: Awaited<ReturnType<typeof getChatUsage>>;
    try {
      userUsage = await getChatUsage(userId, now);
    } catch (error) {
      console.error(error);
      return interaction.reply({
        content: '❌ Your AI usage could not be checked. Please try again later.',
        ephemeral: true,
      });
    }

    if (userUsage.count >= userLimit) {
      return interaction.reply({
        content: `❌ You have reached the daily AI request limit for the **${matchedRoleName}** role (${userUsage.count}/${userLimit}). Please try again after your limit resets.`,
        ephemeral: true,
      });
    }

    const prompt = interaction.options.getString('message', true);

    await interaction.deferReply();

    let consumedUsage: typeof userUsage | undefined;
    try {
      const result = await consumeChatUsage(userId, now, userLimit);
      if (!result.consumed) {
        return interaction.editReply(`❌ You have reached the daily AI request limit for the **${matchedRoleName}** role (${result.usage.count}/${userLimit}). Please try again after your limit resets.`);
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
              content: contentMsg,
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
      let replyMessage = data.choices?.[0]?.message?.content || 'The AI assistant did not return a response. Please try again.';

      if (replyMessage.length > 4000) {
        replyMessage = replyMessage.substring(0, 3997) + '...';
      }

      const remainingLimit = userLimit - consumedUsage.count;

      const embed = new EmbedBuilder()
        .setTitle('🤖 AI Response')
        .setDescription(replyMessage)
        .setColor(0x00ff9d)
        .addFields(
          { name: 'Requested by', value: `${interaction.user}`, inline: true },
          { name: 'Role', value: `\`${matchedRoleName}\``, inline: true },
          { name: 'Requests remaining today', value: `\`${remainingLimit}/${userLimit}\``, inline: true }
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
          content: '⚠️ Audio generation was unavailable. Your AI response is shown below.',
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
      return interaction.editReply('❌ The AI service is unavailable. Please try again later.');
    }
  }
}
