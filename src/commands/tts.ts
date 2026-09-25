import { Command } from '@sapphire/framework';
import { ApplicationCommandRegistry } from '@sapphire/framework';
import { GuildMember, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { Roles } from '../config.js';

const ROLE_LIMITS: Record<keyof typeof Roles, number> = {
  MEMBER: 4,
  DONATUR: 8,
  BILLION: 15,
  RICHMAN: 30,
  DEPUTY: 50,
  FOUNDER: 9999,
};

const usageTracker = new Map<string, { count: number; lastReset: number }>();
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

  public override registerApplicationCommands(registry: ApplicationCommandRegistry) {
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

    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    let userUsage = usageTracker.get(userId);

    if (!userUsage || now - userUsage.lastReset > twentyFourHours) {
      userUsage = { count: 0, lastReset: now };
      usageTracker.set(userId, userUsage);
    }

    if (userUsage.count >= userLimit) {
      return interaction.reply({
        content: `❌ You have reached the daily speech generation limit for the **${matchedRoleName}** role (${userUsage.count}/${userLimit}). Please try again after your limit resets.`,
        ephemeral: true,
      });
    }

    userUsage.count++;
    let refunded = false;
    const refundUsage = () => {
      if (!refunded) {
        userUsage.count--;
        refunded = true;
      }
    };

    const textInput = interaction.options.getString('text', true);

    await interaction.deferReply();

    try {
      // 1. Cek konten pakai LLM OpenRouter untuk mendeteksi kata jorok/kasar/toksik
      const moderationResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
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

      if (!moderationResponse.ok) {
        throw new Error(`Moderation HTTP error! status: ${moderationResponse.status}`);
      }

      const modData = await moderationResponse.json();
      const modContent = modData.choices?.[0]?.message?.content;
      const modResult = typeof modContent === 'string' ? modContent.trim().toUpperCase() : '';

      if (modResult === 'UNSAFE') {
        refundUsage(); // Balikin kuota karena ditolak
        return await interaction.editReply({
          content: '❌ This text cannot be converted to speech because it violates the content guidelines. Please revise it and try again.',
        });
      }

      if (modResult !== 'SAFE') {
        throw new Error(`Unexpected moderation result`);
      }

      // 2. Kalau aman, lanjut proses ke API Text-to-Speech (Fish Audio)
      const response = await fetch('https://openrouter.ai/api/v1/audio/speech', {
        method: 'POST',
        signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
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
        .setTitle('🗣️ Speech Generated')
        .setDescription(textInput)
        .setColor(0x00ff9d)
        .addFields(
          { name: 'Requested by', value: `${interaction.user}`, inline: true },
          { name: 'Role', value: `\`${matchedRoleName}\``, inline: true },
          { name: 'Generations remaining today', value: `\`${remainingLimit}/${userLimit}\``, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'Powered by SBot Engine' });

      return await interaction.editReply({ embeds: [embed], files: [attachment] });
    } catch (error) {
      console.error(error);
      refundUsage();
      return interaction.editReply('❌ The speech service is unavailable. Please try again later.');
    }
  }
}
