import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { getTrack, MissingAudioToolError, streamTrack, TrackExtractionError } from '../dist/lib/playAudio.js';
import { consumePlay, refundPlay } from '../dist/lib/playUsage.js';

const fixtureDirectory = mkdtempSync(join(tmpdir(), 'play-test-'));
const transcoder = join(fixtureDirectory, 'ffmpeg');
const failingTranscoder = join(fixtureDirectory, 'failing-ffmpeg');
writeFileSync(transcoder, '#!/usr/bin/env node\nprocess.stdin.pipe(process.stdout);\n');
writeFileSync(failingTranscoder, '#!/usr/bin/env node\nprocess.stdin.once("data", () => process.exit(2));\n');
chmodSync(transcoder, 0o755);
chmodSync(failingTranscoder, 0o755);
test.after(() => rmSync(fixtureDirectory, { recursive: true, force: true }));

const track = { id: 'eJK6z', title: 'Test song', duration: 125, permalink: '/artist/test-song', is_streamable: true, access: { stream: true } };
const audioBytes = new Uint8Array(3840);

test('search selects an accessible Audius track and rejects links', async () => {
  let searches = 0;
  const request = async (url) => {
    searches++;
    assert.equal(url.origin, 'https://api.audius.co');
    assert.equal(url.pathname, '/v1/tracks/search');
    assert.equal(url.searchParams.get('query'), 'test song');
    return Response.json({ data: [
      { ...track, id: 'private', access: { stream: false } },
      { ...track, id: 'unavailable', is_streamable: false },
      track,
    ] });
  };
  assert.deepEqual(await getTrack('  test song  ', request), {
    id: 'eJK6z', title: 'Test song', duration: 125, url: 'https://audius.co/artist/test-song',
  });
  await assert.rejects(getTrack('https://youtu.be/abcdefghijk', request), /YouTube links.*not supported/);
  await assert.rejects(getTrack('youtu.be/abcdefghijk', request), /YouTube links.*not supported/);
  await assert.rejects(getTrack('https://audius.co/artist/test-song', request), /Links.*not supported/);
  assert.equal(searches, 1);
});

test('empty results and provider errors are explained without requesting audio', async () => {
  await assert.rejects(getTrack('missing', async () => Response.json({ data: [{ ...track, is_streamable: false }] })), /No streamable track/);
  await assert.rejects(getTrack('song', async () => new Response(null, { status: 429 })), /rate-limiting/);
  await assert.rejects(getTrack('song', async () => { throw new Error('offline'); }), TrackExtractionError);
  await assert.rejects(getTrack('   '), /Enter a song title/);
});

test('a provider audio stream is handed to ffmpeg without saving files', async () => {
  const urls = [];
  const playback = await streamTrack(track.id, (error) => assert.fail(error.message), {
    request: async (url) => {
      urls.push(url);
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(audioBytes);
        controller.close();
      } }), { headers: { 'content-type': 'audio/mpeg' } });
    },
    transcoder,
  });
  const chunks = [];
  for await (const chunk of playback.stream) chunks.push(chunk);
  assert.equal(await playback.completed, true);
  assert.deepEqual(Buffer.concat(chunks), Buffer.from(audioBytes));
  assert.deepEqual(urls, ['https://api.audius.co/v1/tracks/eJK6z/stream']);
});

test('unavailable streams fail before starting ffmpeg or consuming usage', async () => {
  const usage = { count: 0, lastReset: Date.now() };
  for (const response of [new Response(null, { status: 404 }), Response.json({ error: 'unavailable' })]) {
    await assert.rejects(async () => {
      const playback = await streamTrack(track.id, () => assert.fail('unexpected callback'), {
        request: async () => response,
        transcoder: join(fixtureDirectory, 'missing-tool'),
      });
      consumePlay(usage, 10, () => {});
      return playback;
    }, TrackExtractionError);
  }
  assert.equal(usage.count, 0);
});

test('stopping playback cancels the provider stream without reporting failure', async () => {
  let cancelled = 0;
  const failures = [];
  const playback = await streamTrack(track.id, (error) => failures.push(error), {
    request: async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(audioBytes); },
      cancel() { cancelled++; },
    }), { headers: { 'content-type': 'audio/mpeg' } }),
    transcoder,
  });
  await new Promise((resolve) => playback.stream.once('data', resolve));
  playback.stop();
  assert.equal(await playback.completed, false);
  assert.equal(cancelled, 1);
  assert.deepEqual(failures, []);
});

test('stream errors and ffmpeg errors stop playback and allow usage refunds', async () => {
  for (const failure of ['stream', 'transcoder']) {
    const usage = { count: 0, lastReset: Date.now() };
    const saved = [];
    let reportFailure;
    const failed = new Promise((resolve) => { reportFailure = resolve; });
    const playback = await streamTrack(track.id, (error) => {
      refundPlay(usage, () => saved.push(usage.count));
      reportFailure(error);
    }, {
      request: async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(audioBytes);
          if (failure === 'stream') setTimeout(() => controller.error(new Error('interrupted')), 40);
        },
      }), { headers: { 'content-type': 'audio/mpeg' } }),
      transcoder: failure === 'transcoder' ? failingTranscoder : transcoder,
    });
    playback.stream.resume();
    assert.equal(consumePlay(usage, 1, () => saved.push(usage.count)), true);
    assert.ok(await failed instanceof Error);
    assert.equal(await playback.completed, false);
    assert.deepEqual(saved, [1, 0]);
  }
});

test('missing ffmpeg reports setup guidance and cancels the stream', async () => {
  let cancelled = 0;
  const failures = [];
  const playback = await streamTrack(track.id, (error) => failures.push(error), {
    request: async () => new Response(new ReadableStream({
      cancel() { cancelled++; },
    }), { headers: { 'content-type': 'audio/mpeg' } }),
    transcoder: join(fixtureDirectory, 'missing-tool'),
  });
  assert.equal(await playback.completed, false);
  assert.equal(cancelled, 1);
  assert.ok(failures[0] instanceof MissingAudioToolError);
});

test('play command releases voice on provider failure and refunds interrupted playback', async (context) => {
  const usageFile = join(fixtureDirectory, 'command-usage.json');
  const previousUsageFile = process.env.PLAY_USAGE_FILE;
  process.env.PLAY_USAGE_FILE = usageFile;
  const audioModule = `
    export class TrackExtractionError extends Error {}
    export class MissingAudioToolError extends Error {}
    export async function getTrack() { return { id: 'eJK6z', title: 'Test song', duration: 125, url: 'https://audius.co/artist/test-song' }; }
    export async function streamTrack(id, onFailure) {
      globalThis.playTestTrackId = id;
      if (!globalThis.playTestStartPlayback) throw new TrackExtractionError('Audius track is unavailable');
      globalThis.playTestFail = onFailure;
      return { stream: {}, completed: globalThis.playTestCompleted ? Promise.resolve(true) : new Promise(() => {}), stop() { globalThis.playTestStops++; } };
    }
  `;
  const voiceModule = `
    import { EventEmitter } from 'node:events';
    export const VoiceConnectionStatus = { Ready: 'ready', Destroyed: 'destroyed' };
    export const AudioPlayerStatus = { Idle: 'idle', Playing: 'playing' };
    export const StreamType = { Raw: 'raw' };
    export function joinVoiceChannel() {
      const connection = new EventEmitter();
      connection.state = { status: VoiceConnectionStatus.Ready };
      connection.destroy = () => { connection.state.status = VoiceConnectionStatus.Destroyed; };
      connection.subscribe = () => true;
      globalThis.playTestConnection = connection;
      return connection;
    }
    export function createAudioPlayer() {
      const player = new EventEmitter();
      player.stop = () => {};
      player.play = () => { player.state = { status: AudioPlayerStatus.Playing }; };
      globalThis.playTestPlayer = player;
      return player;
    }
    export function createAudioResource() { return {}; }
    export async function entersState() {}
  `;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL && new URL(context.parentURL).pathname.endsWith('/dist/commands/play.js')) {
        if (specifier === '../lib/playAudio.js' || specifier === '@discordjs/voice') {
          const source = specifier === '@discordjs/voice' ? voiceModule : audioModule;
          return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
        }
      }
      return nextResolve(specifier, context);
    },
  });
  try {
    context.mock.method(console, 'error', () => {});
    globalThis.playTestStops = 0;
    const { PlayCommand } = await import('../dist/commands/play.js');
    const replies = [];
    const voiceChannel = { id: 'channel', guild: { id: 'guild', voiceAdapterCreator: () => {} } };
    const interaction = {
      user: { id: 'user' },
      guild: { members: { fetch: async () => ({ voice: { channel: voiceChannel }, roles: { cache: new Map() } }) } },
      options: { getString: () => 'Test song' },
      deferReply: async () => {},
      editReply: async (reply) => { replies.push(reply); },
    };
    await PlayCommand.prototype.chatInputRun.call({}, interaction);
    assert.equal(globalThis.playTestConnection.state.status, 'destroyed');
    assert.match(replies[0].content, /Audius track is unavailable/);
    assert.equal(JSON.parse(readFileSync(usageFile, 'utf8')).user.count, 0);
    globalThis.playTestStartPlayback = true;
    await PlayCommand.prototype.chatInputRun.call({}, interaction);
    assert.equal(globalThis.playTestTrackId, 'eJK6z');
    assert.equal(JSON.parse(readFileSync(usageFile, 'utf8')).user.count, 1);
    await globalThis.playTestFail(new TrackExtractionError('Audius audio stream interrupted'));
    assert.equal(globalThis.playTestConnection.state.status, 'destroyed');
    assert.equal(globalThis.playTestStops, 1);
    assert.equal(JSON.parse(readFileSync(usageFile, 'utf8')).user.count, 0);
    globalThis.playTestCompleted = true;
    await PlayCommand.prototype.chatInputRun.call({}, interaction);
    globalThis.playTestPlayer.emit('idle');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(globalThis.playTestConnection.state.status, 'destroyed');
    assert.equal(JSON.parse(readFileSync(usageFile, 'utf8')).user.count, 1);
  } finally {
    hooks.deregister();
    for (const key of ['playTestConnection', 'playTestStartPlayback', 'playTestFail', 'playTestStops', 'playTestTrackId', 'playTestCompleted', 'playTestPlayer']) delete globalThis[key];
    if (previousUsageFile === undefined) delete process.env.PLAY_USAGE_FILE;
    else process.env.PLAY_USAGE_FILE = previousUsageFile;
  }
});

test('failed persistence does not consume a play', () => {
  const usage = { count: 0, lastReset: Date.now() };
  assert.throws(() => consumePlay(usage, 10, () => { throw new Error('disk error'); }));
  assert.equal(usage.count, 0);
});
