import { Command } from '@sapphire/framework';
import { ApplicationCommandRegistry } from '@sapphire/framework';
import { GuildMember, EmbedBuilder } from 'discord.js';
import { Roles } from '../config.js';

const ROLE_LIMITS: Record<string, number> = {
  [Roles.MEMBER.id]: 4,
  [Roles.DONATUR.id]: 8,
  [Roles.BILLION.id]: 15,
  [Roles.RICHMAN.id]: 30,
  [Roles.DEPUTY.id]: 50,
  [Roles.FOUNDER.id]: 9999,
};

const usageTracker = new Map<string, { count: number; lastReset: number }>();

export class ChatCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'chat',
      description: 'Chat with AI via OpenRouter powered by SoTeen Bot (SBot Engine)',
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
        ),
    );
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ) {
    const member = interaction.member as GuildMember;
    const userId = interaction.user.id;

    let userLimit = ROLE_LIMITS[Roles.MEMBER.id];
    let matchedRoleName = 'MEMBER';

    const sortedRoles = [
      { key: 'FOUNDER', data: Roles.FOUNDER },
      { key: 'DEPUTY', data: Roles.DEPUTY },
      { key: 'RICHMAN', data: Roles.RICHMAN },
      { key: 'BILLION', data: Roles.BILLION },
      { key: 'DONATUR', data: Roles.DONATUR },
      { key: 'MEMBER', data: Roles.MEMBER },
    ];

    for (const r of sortedRoles) {
      if (r.data.id && member.roles.cache.has(r.data.id)) {
        userLimit = ROLE_LIMITS[r.data.id] ?? userLimit;
        matchedRoleName = r.key;
        break;
      }
    }

    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    let userUsage = usageTracker.get(userId);

    if (!userUsage || now - userUsage.lastReset > twentyFourHours) {
      userUsage = { count: 0, lastReset: now };
      usageTracker.set(userId, userUsage);
    }

    if (userUsage.count >= userLimit) {
      return interaction.reply({
        content: `❌ You have reached your daily AI usage limit for the **${matchedRoleName}** role (${userUsage.count}/${userLimit}). Please try again tomorrow!`,
        ephemeral: true,
      });
    }

    userUsage.count++;

    const prompt = interaction.options.getString('message', true);

    await interaction.deferReply();

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://discord.com',
          'X-Title': 'SoTeen Bot',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'inclusionai/ling-3.0-flash-fin:free',
          messages: [
            {
              role: 'system',
              content: 'You are SoTeen Bot, an AI assistant powered by SBot Engine (AI powered by inclusionai/ling-3.0-flash-fin:free) and developed by SoTeen Studio.',
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

      const remainingLimit = userLimit - userUsage.count;

      const embed = new EmbedBuilder()
        .setTitle('🤖 SoTeen Bot Assistant')
        .setDescription(replyMessage)
        .setColor(0x00ff9d)
        .addFields(
          { name: '👤 Prompt by', value: `${interaction.user}`, inline: true },
          { name: '🛡️ Role Tier', value: `\`${matchedRoleName}\``, inline: true },
          { name: '⚡ Remaining Limit', value: `\`${remainingLimit}/${userLimit}\``, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'Powered by SBot Engine & SoTeen Studio' });

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      userUsage.count--;
      return interaction.editReply('An error occurred while connecting to the AI server. Please try again later!');
    }
  }
}
