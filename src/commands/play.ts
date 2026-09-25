import { Command } from '@sapphire/framework';
import { ApplicationCommandRegistry } from '@sapphire/framework';
import { GuildMember, EmbedBuilder } from 'discord.js';
import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } from '@discordjs/voice';
import ytdl from '@distube/ytdl-core';
import YouTube from 'youtube-sr';
import { Roles } from '../config.js';

const ROLE_LIMITS: Record<string, number> = {
  [Roles.MEMBER.id]: 10,
  [Roles.DONATUR.id]: 20,
  [Roles.BILLION.id]: 40,
  [Roles.RICHMAN.id]: 80,
  [Roles.DEPUTY.id]: 150,
  [Roles.FOUNDER.id]: 9999,
};

const usageTracker = new Map<string, { count: number; lastReset: number }>();

export class PlayCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'play',
      description: 'Stream music directly in RAM by typing titles (No links, No downloads!)',
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
            .setName('query')
            .setDescription('Type any song title (Awam-friendly, no links needed!)')
            .setRequired(true),
        ),
    );
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ) {
    const userId = interaction.user.id;
    
    const member = await interaction.guild?.members.fetch(userId).catch(() => null) as GuildMember | null;
    const voiceChannel = member?.voice?.channel;

    if (!voiceChannel) {
      return interaction.reply({
        content: `❌ You must be connected to a voice channel to play music!`,
        ephemeral: true,
      });
    }

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
        content: `❌ You have reached your daily music playback limit for the **${matchedRoleName}** role (${userUsage.count}/${userLimit}). Please try again tomorrow!`,
        ephemeral: true,
      });
    }

    const searchQuery = interaction.options.getString('query', true);
    userUsage.count++;

    await interaction.deferReply();

    try {
      let targetUrl = searchQuery;

      // Kalau bukan link, cari video pakai youtube-sr secara akurat
      if (!searchQuery.startsWith('http://') && !searchQuery.startsWith('https://')) {
        const searchResult = await YouTube.searchOne(searchQuery).catch(() => null);
        
        if (!searchResult || !searchResult.url) {
          userUsage.count--;
          return interaction.editReply('❌ No songs found matching your keywords. Try a different title!');
        }
        targetUrl = searchResult.url;
      }

      if (!ytdl.validateURL(targetUrl)) {
        userUsage.count--;
        return interaction.editReply('❌ Invalid track source URL generated!');
      }

      const songInfo = await ytdl.getInfo(targetUrl);
      const songTitle = songInfo.videoDetails.title;
      const durationSec = Number(songInfo.videoDetails.lengthSeconds);
      const songDuration = Math.floor(durationSec / 60) + ':' + (durationSec % 60).toString().padStart(2, '0');

      const stream = ytdl(targetUrl, {
        filter: 'audioonly',
        quality: 'highestaudio',
        highWaterMark: 1 << 25,
      });

      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      });

      const player = createAudioPlayer();
      const resource = createAudioResource(stream, { 
        inlineVolume: true 
      });

      connection.subscribe(player);
      player.play(resource);

      player.on(AudioPlayerStatus.Idle, () => {
        connection.destroy();
      });

      player.on('error', (error) => {
        console.error('Audio Player Error:', error);
        connection.destroy();
      });

      const remainingLimit = userLimit - userUsage.count;

      const embed = new EmbedBuilder()
        .setTitle('🎵 SBot RAM Music Player')
        .setDescription(`Now playing: **[${songTitle}](${targetUrl})**`)
        .setColor(0x00ff9d)
        .addFields(
          { name: '⏱️ Duration', value: `\`${songDuration}\``, inline: true },
          { name: '🛡️ Role Tier', value: `\`${matchedRoleName}\``, inline: true },
          { name: '⚡ Remaining Limit', value: `\`${remainingLimit}/${userLimit}\``, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'Powered by SBot Engine (Zero Storage Download)' });

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      userUsage.count--;
      return interaction.editReply('An error occurred while streaming the music directly into RAM. Please try another title!');
    }
  }
}
