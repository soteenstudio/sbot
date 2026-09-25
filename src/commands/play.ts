import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Command } from '@sapphire/framework';
import { ApplicationCommandRegistry } from '@sapphire/framework';
import { GuildMember, EmbedBuilder } from 'discord.js';
import { joinVoiceChannel, createAudioPlayer, createAudioResource, entersState, AudioPlayerStatus, VoiceConnectionStatus, StreamType } from '@discordjs/voice';
import { Roles } from '../config.js';
import { getTrack, MissingAudioToolError, streamTrack, TrackExtractionError } from '../lib/playAudio.js';
import { consumePlay, refundPlay, type PlayUsage } from '../lib/playUsage.js';

const ROLE_LIMITS: Record<keyof typeof Roles, number> = {
  MEMBER: 10,
  DONATUR: 20,
  BILLION: 40,
  RICHMAN: 80,
  DEPUTY: 150,
  FOUNDER: 9999,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const VOICE_TIMEOUT_MS = 10_000;
const usagePath = resolve(process.env.PLAY_USAGE_FILE ?? 'data/play-usage.json');

function loadUsage(): Map<string, PlayUsage> {
  let records: Record<string, PlayUsage>;
  try {
    records = JSON.parse(readFileSync(usagePath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
    throw error;
  }
  return new Map(Object.entries(records));
}

const usageTracker = loadUsage();

function saveUsage(): void {
  mkdirSync(dirname(usagePath), { recursive: true });
  const temporaryPath = `${usagePath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, JSON.stringify(Object.fromEntries(usageTracker)));
    renameSync(temporaryPath, usagePath);
  } finally {
    try {
      unlinkSync(temporaryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

const activePlaybacks = new Map<string, { stop: () => void }>();

export class PlayCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'play',
      description: 'Search and stream songs from Audius by title (no links)',
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
            .setDescription('Search for a song title on Audius (links not supported)')
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

    let userLimit = ROLE_LIMITS.MEMBER;
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
        userLimit = ROLE_LIMITS[r.key as keyof typeof Roles];
        matchedRoleName = r.key;
        break;
      }
    }

    const now = Date.now();
    let userUsage = usageTracker.get(userId);

    if (!userUsage || now - userUsage.lastReset > DAY_MS) {
      userUsage = { count: 0, lastReset: now };
      usageTracker.set(userId, userUsage);
      try {
        saveUsage();
      } catch (error) {
        console.error('Could not save play usage:', error);
        return interaction.reply({ content: '❌ Your music usage could not be checked. Please try again later.', ephemeral: true });
      }
    }

    if (userUsage.count >= userLimit) {
      return interaction.reply({
        content: `❌ You have reached your daily music playback limit for the **${matchedRoleName}** role (${userUsage.count}/${userLimit}). Please try again tomorrow!`,
        ephemeral: true,
      });
    }

    const searchQuery = interaction.options.getString('query', true);
    await interaction.deferReply();

    let audio: Awaited<ReturnType<typeof streamTrack>> | undefined;
    let failureHandler: ((error: unknown) => Promise<void>) | undefined;

    try {
      const track = await getTrack(searchQuery);
      const songTitle = track.title;
      const targetUrl = track.url;
      const durationSec = Math.floor(track.duration);
      const songDuration = Math.floor(durationSec / 60) + ':' + (durationSec % 60).toString().padStart(2, '0');

      const player = createAudioPlayer();
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      });
      const guildId = voiceChannel.guild.id;
      const abortController = new AbortController();
      let finished = false;
      let playingStarted = false;
      let usageConsumed = false;
      let successReply: Promise<unknown> | undefined;
      const playback = { stop: () => {} };

      const cleanup = () => {
        const ownsConnection = activePlaybacks.get(guildId) === playback;
        if (ownsConnection) activePlaybacks.delete(guildId);
        abortController.abort();
        connection.off('error', onConnectionError);
        player.off('error', onPlayerError);
        player.off(AudioPlayerStatus.Idle, onIdle);
        player.stop(true);
        audio?.stop();
        if (ownsConnection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
          connection.destroy();
        }
      };

      const failPlayback = async (error: unknown) => {
        if (finished) return;
        console.error('Music playback failed:', error);
        finished = true;
        cleanup();
        if (usageConsumed && usageTracker.get(userId) === userUsage) {
          try {
            refundPlay(userUsage, saveUsage);
          } catch (saveError) {
            console.error('Could not refund play usage:', saveError);
          }
        }
        await successReply?.catch(() => {});
        await interaction.editReply({
          content: error instanceof MissingAudioToolError || error instanceof TrackExtractionError ? `❌ ${error.message}` : '❌ Music playback failed. Please try another title!',
          embeds: [],
        }).catch((replyError) => console.error('Could not update play reply:', replyError));
      };
      failureHandler = failPlayback;
      const onConnectionError = (error: Error) => {
        if (activePlaybacks.get(guildId) === playback) void failPlayback(error);
      };
      const onPlayerError = (error: Error) => {
        if (activePlaybacks.get(guildId) === playback) void failPlayback(error);
      };
      const onIdle = async () => {
        if (activePlaybacks.get(guildId) !== playback || finished) return;
        if (!playingStarted) {
          void failPlayback(new Error('Audio player stopped before playback started'));
          return;
        }
        const completed = await Promise.race([
          audio?.completed,
          new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000)),
        ]);
        if (!completed || finished) {
          if (!finished) void failPlayback(new Error('Audio stream ended before extraction completed'));
          return;
        }
        finished = true;
        cleanup();
      };

      connection.on('error', onConnectionError);
      player.on('error', onPlayerError);
      player.on(AudioPlayerStatus.Idle, onIdle);
      playback.stop = () => {
        if (finished) return;
        if (!playingStarted) {
          void failPlayback(new Error('Playback was replaced before it started'));
          return;
        }
        finished = true;
        cleanup();
      };
      const previousPlayback = activePlaybacks.get(guildId);
      activePlaybacks.set(guildId, playback);
      previousPlayback?.stop();

      const readySignal = AbortSignal.any([AbortSignal.timeout(VOICE_TIMEOUT_MS), abortController.signal]);
      await entersState(connection, VoiceConnectionStatus.Ready, readySignal);
      if (finished || connection.state.status !== VoiceConnectionStatus.Ready) {
        throw new Error('Voice connection did not become ready');
      }
      audio = await streamTrack(track.id, (error) => void failPlayback(error));
      if (finished) {
        audio.stop();
        throw new Error('Playback stopped during audio extraction');
      }
      const resource = createAudioResource(audio.stream, { inputType: StreamType.Raw });
      if (!connection.subscribe(player)) throw new Error('Could not subscribe to voice connection');
      player.play(resource);
      const playingSignal = AbortSignal.any([AbortSignal.timeout(VOICE_TIMEOUT_MS), abortController.signal]);
      await entersState(player, AudioPlayerStatus.Playing, playingSignal);
      if (finished || connection.state.status !== VoiceConnectionStatus.Ready || player.state.status !== AudioPlayerStatus.Playing) {
        throw new Error('Audio player did not start');
      }
      playingStarted = true;

      if (!consumePlay(userUsage, userLimit, saveUsage)) {
        throw new Error('Daily music playback limit reached while starting');
      }
      usageConsumed = true;

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
        .setFooter({ text: 'Music from Audius • streamed without saving files' });

      successReply = interaction.editReply({ embeds: [embed] });
      return await successReply;
    } catch (error) {
      if (failureHandler) {
        await failureHandler(error);
        return;
      }
      console.error(error);
      audio?.stop();
      return interaction.editReply(error instanceof MissingAudioToolError || error instanceof TrackExtractionError
        ? `❌ ${error.message}`
        : '❌ Could not find or stream this track. Please try another title!');
    }
  }
}
