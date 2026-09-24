import { Command } from '@sapphire/framework';
import { ApplicationCommandRegistry } from '@sapphire/framework';
import { GuildMember, EmbedBuilder, AttachmentBuilder } from 'discord.js';
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

export class TssCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'tss',
      description: 'Generate AI speech audio via OpenRouter powered by SoTeen Bot (SBot Engine)',
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
            .setName('text')
            .setDescription('The text you want to convert into speech')
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
        content: `❌ You have reached your daily TTS generation limit for the **${matchedRoleName}** role (${userUsage.count}/${userLimit}). Please try again tomorrow!`,
        ephemeral: true,
      });
    }

    userUsage.count++;

    const textInput = interaction.options.getString('text', true);

    await interaction.deferReply();

    try {
      // 1. Cek konten pakai LLM OpenRouter untuk mendeteksi kata jorok/kasar/toksik
      const moderationResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
              content: 'You are a strict content moderator. Analyze if the given text contains profanity, slurs, explicit sexual content, or harsh insults (in any language, including Indonesian/slang). Reply with ONLY the word "SAFE" if it is clean, or "UNSAFE" if it contains inappropriate content.',
            },
            {
              role: 'user',
              content: textInput,
            },
          ],
        }),
      });

      if (moderationResponse.ok) {
        const modData = await moderationResponse.json();
        const modResult = modData.choices?.[0]?.message?.content?.trim().toUpperCase() || 'SAFE';

        if (modResult.includes('UNSAFE')) {
          userUsage.count--; // Balikin kuota karena ditolak
          return interaction.editReply({
            content: `❌ **Text rejected!** The content you provided contains prohibited, harsh, or inappropriate words. Please keep it clean!`,
          });
        }
      }

      // 2. Kalau aman, lanjut proses ke API Text-to-Speech (Fish Audio)
      const response = await fetch('https://openrouter.ai/api/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
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
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const attachment = new AttachmentBuilder(buffer, { name: 'speech.mp3' });
      const remainingLimit = userLimit - userUsage.count;

      const embed = new EmbedBuilder()
        .setTitle('🗣️ SoTeen Bot Text-to-Speech')
        .setDescription(`**Text:** ${textInput}`)
        .setColor(0x00ff9d)
        .addFields(
          { name: '👤 Requested by', value: `${interaction.user}`, inline: true },
          { name: '🛡️ Role Tier', value: `\`${matchedRoleName}\``, inline: true },
          { name: '⚡ Remaining Limit', value: `\`${remainingLimit}/${userLimit}\``, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'Powered by SBot Engine & SoTeen Studio' });

      return interaction.editReply({ embeds: [embed], files: [attachment] });
    } catch (error) {
      console.error(error);
      userUsage.count--;
      return interaction.editReply('An error occurred while connecting to the TTS server. Please try again later!');
    }
  }
}