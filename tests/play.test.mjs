import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SabrStream } from 'googlevideo/sabr-stream';
import { getTrack, MissingAudioToolError, streamTrack, TrackExtractionError } from '../dist/lib/playAudio.js';
import { consumePlay, refundPlay } from '../dist/lib/playUsage.js';
import { chooseFormat } from '../node_modules/youtubei.js/dist/src/utils/FormatUtils.js';
import Player from '../node_modules/youtubei.js/dist/src/core/Player.js';

const videoId = 'abcdefghijk';
const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
const fixtureDirectory = mkdtempSync(join(tmpdir(), 'play-test-'));
const transcoder = join(fixtureDirectory, 'ffmpeg');
const failingTranscoder = join(fixtureDirectory, 'failing-ffmpeg');
writeFileSync(transcoder, `#!/usr/bin/env node
process.stdin.pipe(process.stdout);
`);
writeFileSync(failingTranscoder, `#!/usr/bin/env node
process.stdin.once('data', () => process.exit(2));
`);
chmodSync(transcoder, 0o755);
chmodSync(failingTranscoder, 0o755);
test.after(() => rmSync(fixtureDirectory, { recursive: true, force: true }));

const defaultFormats = [{ itag: 140, url: 'https://example.com/audio', bitrate: 128000, mime_type: 'audio/mp4', has_audio: true, has_video: false, has_text: false, is_original: true }];
const sabrFormats = [
  { ...defaultFormats[0], url: undefined, last_modified_ms: '123', approx_duration_ms: 125000, audio_quality: 'AUDIO_QUALITY_MEDIUM' },
  { itag: 137, bitrate: 1000000, mime_type: 'video/mp4', has_audio: false, has_video: true, last_modified_ms: '124', approx_duration_ms: 125000 },
];
const sabrFields = {
  streaming_data: { adaptive_formats: sabrFormats, server_abr_streaming_url: 'https://example.com/sabr' },
  player_config: { media_common_config: { media_ustreamer_request_config: { video_playback_ustreamer_config: 'dGVzdA==' } } },
};

function makeSabrExtractor(fields = sabrFields) {
  const extractor = makeExtractor({ formats: sabrFormats });
  return {
    ...extractor,
    session: { context: { client: { clientName: 'WEB', clientVersion: '1.0' } }, po_token: 'dG9rZW4=' },
    async getBasicInfo(id) { return { ...await extractor.getBasicInfo(id), ...fields }; },
  };
}

function makeSabrStream({ onAbort = () => {}, startError, streamError, stallStart = false, stallAudio = false, finish = false, onStart = () => {} } = {}) {
  let controller;
  let aborted = false;
  const audioStream = new ReadableStream({ start(value) { controller = value; } });
  return (config) => {
    assert.equal(config.serverAbrStreamingUrl, 'https://example.com/sabr');
    assert.equal(config.videoPlaybackUstreamerConfig, 'dGVzdA==');
    assert.equal(config.poToken, 'dG9rZW4=');
    assert.deepEqual(config.clientInfo, { clientName: 1, clientVersion: '1.0' });
    assert.equal(config.formats.length, 2);
    return {
      abort() {
        if (aborted) return;
        aborted = true;
        onAbort();
        try { controller.error(new Error('aborted')); } catch {}
      },
      async start(options) {
        assert.equal(options.enabledTrackTypes, 1);
        assert.equal(options.maxRetries, 0);
        onStart();
        if (startError) throw new Error(typeof startError === 'string' ? startError : 'SABR startup failed');
        if (stallStart) return new Promise(() => {});
        if (stallAudio) return { audioStream };
        queueMicrotask(() => {
          if (aborted) return;
          if (streamError === 'startup') controller.error(new Error('SABR unavailable'));
          else {
            controller.enqueue(new Uint8Array(3840));
            if (finish) controller.close();
            if (streamError === 'late') setTimeout(() => controller.error(new Error('SABR interrupted')), 40);
          }
        });
        return { audioStream };
      },
    };
  };
}

function makeExtractor({ failLookup = false, failDownload = false, streamError = false, maxChunks = Infinity, onCancel = () => {}, onDownload = () => {}, formats = defaultFormats } = {}) {
  return {
    async search(query, filters) {
      assert.deepEqual(filters, { type: 'video' });
      return { videos: query === 'missing' ? [] : [{ video_id: videoId }] };
    },
    async getBasicInfo(id) {
      assert.equal(id, videoId);
      if (failLookup) throw new Error('lookup failed');
      return {
        basic_info: { title: 'Test song', duration: 125 },
        streaming_data: { adaptive_formats: formats },
        async download(options) {
          onDownload(options);
          assert.equal(options.type, 'audio');
          assert.equal(options.quality, 'best');
          const selected = chooseFormat(options, this.streaming_data);
          if (!selected.url && !selected.signature_cipher && !selected.cipher) throw new Error('No valid URL to decipher');
          if (failDownload) throw new Error('audio unavailable');
          let timer;
          let emitted = 0;
          return new ReadableStream({
            start(controller) {
              timer = setInterval(() => {
                if (streamError) {
                  clearInterval(timer);
                  controller.error(new Error('download interrupted'));
                } else {
                  controller.enqueue(new Uint8Array(3840));
                  if (++emitted === maxChunks) {
                    clearInterval(timer);
                    controller.close();
                  }
                }
              }, 40);
            },
            cancel() {
              clearInterval(timer);
              onCancel();
            },
          });
        },
      };
    },
  };
}

test('n-parameterized URLs are deciphered through the evaluator', async () => {
  const player = await Player.fromSource('test-player', {
    signature_timestamp: 0,
    data: {
      output: `class NTransformer {
  constructor(n) { this.n = n; }
  transform() { this.n = this.n.split('').reverse().join(''); }
  get(name) { return this[name]; }
}
const exportedVars = { nsigFunction: (url) => new NTransformer(url.slice(url.indexOf('n=') + 2)) };`,
      exported: ['nsigFunction'],
    },
  });
  assert.equal(await player.decipher('https://example.com/audio?n=abc'), 'https://example.com/audio?n=cba');
});

test('search and YouTube links resolve to metadata without consuming usage on extraction failure', async () => {
  const extractor = makeExtractor();
  assert.deepEqual(await getTrack('test song', extractor), {
    title: 'Test song', duration: 125, url: videoUrl,
  });
  assert.equal((await getTrack(`https://youtu.be/${videoId}`, extractor)).url, videoUrl);
  const usage = { count: 2, lastReset: Date.now() };
  await assert.rejects(getTrack('missing', extractor), TrackExtractionError);
  await assert.rejects(getTrack('test song', makeExtractor({ failLookup: true })), TrackExtractionError);
  await assert.rejects(getTrack('https://example.com/song', extractor), /Only YouTube video links/);
  assert.equal(usage.count, 2);
});

test('audio extraction fails before playback and no play is consumed', async () => {
  const usage = { count: 0, lastReset: Date.now() };
  await assert.rejects(streamTrack(videoUrl, () => assert.fail('unexpected stream failure'), {
    extractor: makeExtractor({ failDownload: true }), transcoder,
  }), TrackExtractionError);
  assert.equal(usage.count, 0);
});

test('falls back from a higher-bitrate URL-less format to downloadable audio', async () => {
  const formats = [
    { ...defaultFormats[0], itag: 141, url: undefined, bitrate: 256000 },
    { ...defaultFormats[0], itag: 140, bitrate: 128000 },
  ];
  assert.equal(chooseFormat({ type: 'audio', quality: 'best' }, { adaptive_formats: formats }).itag, 141);
  const extractor = makeExtractor({ formats, maxChunks: 2 });
  await assert.rejects((await extractor.getBasicInfo(videoId)).download({ type: 'audio', quality: 'best' }), /No valid URL to decipher/);
  const downloadOptions = [];
  const failures = [];
  const playback = await streamTrack(videoUrl, (error) => failures.push(error), {
    extractor: makeExtractor({ formats, onDownload: (options) => downloadOptions.push(options), maxChunks: 2 }), transcoder,
  });
  playback.stream.resume();
  assert.equal(await playback.completed, true);
  assert.deepEqual(downloadOptions, [{ type: 'audio', quality: 'best', itag: 140 }]);
  assert.deepEqual(failures, []);
});

test('URL-less audio fails clearly before spawning ffmpeg or consuming a play', async () => {
  const usage = { count: 0, lastReset: Date.now() };
  const saved = [];
  let downloads = 0;
  let failures = 0;
  const marker = join(fixtureDirectory, 'unexpected-start');
  const unexpectedTranscoder = join(fixtureDirectory, 'unexpected-ffmpeg');
  writeFileSync(unexpectedTranscoder, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started');\n`);
  chmodSync(unexpectedTranscoder, 0o755);
  const formats = [
    { ...defaultFormats[0], url: undefined },
    { ...defaultFormats[0], itag: 141, url: undefined, bitrate: 256000 },
  ];
  const startPlayback = async () => {
    const playback = await streamTrack(videoUrl, () => { failures++; }, {
      extractor: makeExtractor({ formats, onDownload: () => { downloads++; } }), transcoder: unexpectedTranscoder,
    });
    consumePlay(usage, 1, () => saved.push(usage.count));
    return playback;
  };
  await assert.rejects(startPlayback(), (error) => error instanceof TrackExtractionError && /No downloadable audio format/.test(error.message));
  assert.equal(downloads, 0);
  assert.equal(failures, 0);
  assert.equal(existsSync(marker), false);
  assert.equal(usage.count, 0);
  assert.deepEqual(saved, []);
});

test('SABR audio feeds ffmpeg without invoking the downloadable path', async () => {
  let downloads = 0;
  const extractor = makeSabrExtractor();
  const playback = await streamTrack(videoUrl, (error) => assert.fail(error.message), {
    extractor: { ...extractor, async getBasicInfo(id) {
      const info = await extractor.getBasicInfo(id);
      return { ...info, download() { downloads++; throw new Error('unexpected download'); } };
    } },
    sabrStream: makeSabrStream({ finish: true }), transcoder,
  });
  playback.stream.resume();
  assert.equal(await playback.completed, true);
  assert.equal(downloads, 0);
});

test('missing SABR URL, configuration, video format, or client info fails before ffmpeg starts', async () => {
  const marker = join(fixtureDirectory, 'sabr-unexpected-start');
  const unexpectedTranscoder = join(fixtureDirectory, 'sabr-unexpected-ffmpeg');
  writeFileSync(unexpectedTranscoder, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started');\n`);
  chmodSync(unexpectedTranscoder, 0o755);
  const incomplete = [
    { ...sabrFields, streaming_data: { adaptive_formats: sabrFormats } },
    { ...sabrFields, player_config: undefined },
    { ...sabrFields, streaming_data: { ...sabrFields.streaming_data, adaptive_formats: sabrFormats.slice(0, 1) } },
  ];
  for (const fields of incomplete) {
    await assert.rejects(streamTrack(videoUrl, () => assert.fail('unexpected failure'), {
      extractor: makeSabrExtractor(fields),
      sabrStream: () => assert.fail('SABR should not start'), transcoder: unexpectedTranscoder,
    }), /No downloadable audio format/);
  }
  await assert.rejects(streamTrack(videoUrl, () => assert.fail('unexpected failure'), {
    extractor: makeExtractor({ formats: sabrFormats }), sabrStream: () => assert.fail('SABR should not start'), transcoder: unexpectedTranscoder,
  }), /No downloadable audio format/);
  assert.equal(existsSync(marker), false);
});

test('SABR startup errors and empty audio do not consume plays or start ffmpeg', async () => {
  const usage = { count: 0, lastReset: Date.now() };
  for (const failure of [{ startError: true }, { streamError: 'startup' }]) {
    let aborted = 0;
    await assert.rejects(async () => {
      const playback = await streamTrack(videoUrl, () => assert.fail('unexpected failure'), {
        extractor: makeSabrExtractor(),
        sabrStream: makeSabrStream({ ...failure, onAbort: () => aborted++ }),
        transcoder,
      });
      consumePlay(usage, 10, () => {});
      return playback;
    }, TrackExtractionError);
    assert.equal(aborted, 1);
    assert.equal(usage.count, 0);
  }
});

test('stalled SABR setup and first audio chunk abort promptly without charging or starting ffmpeg', async () => {
  const marker = join(fixtureDirectory, 'stalled-sabr-ffmpeg-started');
  const unexpectedTranscoder = join(fixtureDirectory, 'stalled-sabr-ffmpeg');
  writeFileSync(unexpectedTranscoder, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started');\n`);
  chmodSync(unexpectedTranscoder, 0o755);
  const usage = { count: 0, lastReset: Date.now() };
  for (const stalled of [{ stallStart: true }, { stallAudio: true }]) {
    let aborted = 0;
    await assert.rejects(async () => {
      const playback = await streamTrack(videoUrl, () => assert.fail('unexpected failure'), {
        extractor: makeSabrExtractor(),
        sabrStream: makeSabrStream({ ...stalled, onAbort: () => aborted++ }),
        sabrStartupTimeoutMs: 25,
        transcoder: unexpectedTranscoder,
      });
      consumePlay(usage, 10, () => {});
      return playback;
    }, (error) => error instanceof TrackExtractionError && /SABR audio startup stalled/.test(error.message));
    assert.equal(aborted, 1);
    assert.equal(usage.count, 0);
    assert.equal(existsSync(marker), false);
  }
});

test('SABR authorization failure reports token-free guidance instead of timing out', async () => {
  let aborted = 0;
  const secret = 'private-session-token';
  await assert.rejects(streamTrack(videoUrl, () => assert.fail('unexpected failure'), {
    extractor: makeSabrExtractor(),
    sabrStream: makeSabrStream({ streamError: 'startup', onAbort: () => aborted++ }),
    transcoder,
  }), TrackExtractionError);
  await assert.rejects(streamTrack(videoUrl, () => assert.fail('unexpected failure'), {
    extractor: makeSabrExtractor(),
    sabrStream: makeSabrStream({ startError: `Server returned 403 Forbidden: ${secret}`, onAbort: () => aborted++ }),
    transcoder,
  }), (error) => error instanceof TrackExtractionError && /SABR audio access was denied/.test(error.message) &&
    /PLAY_PO_TOKEN is valid/.test(error.message) && !error.message.includes(secret) && !error.cause);
  assert.equal(aborted, 2);
});

test('the SABR client surfaces a server denial without retrying past startup', async () => {
  let requests = 0;
  let aborted = 0;
  await assert.rejects(streamTrack(videoUrl, () => assert.fail('unexpected failure'), {
    extractor: makeSabrExtractor(),
    sabrStream: (config) => {
      const sabr = new SabrStream({ ...config, fetch: async () => {
        requests++;
        return { ok: false, status: 403, statusText: 'Forbidden' };
      } });
      const originalAbort = sabr.abort.bind(sabr);
      sabr.abort = () => { aborted++; originalAbort(); };
      return sabr;
    },
    sabrStartupTimeoutMs: 1000,
    transcoder,
  }), (error) => error instanceof TrackExtractionError && /SABR audio access was denied/.test(error.message));
  assert.equal(requests, 1);
  assert.equal(aborted, 1);
});

test('stopping SABR audio aborts it once and does not report failure', async () => {
  let aborted = 0;
  const failures = [];
  const playback = await streamTrack(videoUrl, (error) => failures.push(error), {
    extractor: makeSabrExtractor(), sabrStream: makeSabrStream({ onAbort: () => aborted++ }), transcoder,
  });
  await new Promise((resolve) => playback.stream.once('data', resolve));
  playback.stop();
  playback.stop();
  assert.equal(await playback.completed, false);
  assert.equal(aborted, 1);
  assert.deepEqual(failures, []);
});

test('SABR stream failure aborts playback and refunds a consumed play', async () => {
  const usage = { count: 0, lastReset: Date.now() };
  const saved = [];
  let aborted = 0;
  let failure;
  const failed = new Promise((resolve) => { failure = resolve; });
  const playback = await streamTrack(videoUrl, (error) => {
    refundPlay(usage, () => saved.push(usage.count));
    failure(error);
  }, {
    extractor: makeSabrExtractor(),
    sabrStream: makeSabrStream({ streamError: 'late', onAbort: () => aborted++ }), transcoder,
  });
  playback.stream.resume();
  assert.equal(consumePlay(usage, 10, () => saved.push(usage.count)), true);
  assert.ok(await failed instanceof TrackExtractionError);
  assert.equal(await playback.completed, false);
  assert.equal(aborted, 1);
  assert.deepEqual(saved, [1, 0]);
});

test('ffmpeg failure on SABR aborts the source and refunds a consumed play', async () => {
  const usage = { count: 0, lastReset: Date.now() };
  const saved = [];
  let aborted = 0;
  let failure;
  const failed = new Promise((resolve) => { failure = resolve; });
  const playback = await streamTrack(videoUrl, (error) => {
    refundPlay(usage, () => saved.push(usage.count));
    failure(error);
  }, {
    extractor: makeSabrExtractor(),
    sabrStream: makeSabrStream({ onAbort: () => aborted++ }), transcoder: failingTranscoder,
  });
  playback.stream.resume();
  assert.equal(consumePlay(usage, 1, () => saved.push(usage.count)), true);
  assert.match((await failed).message, /ffmpeg failed/);
  assert.equal(await playback.completed, false);
  assert.equal(aborted, 1);
  assert.deepEqual(saved, [1, 0]);
});

test('the play command releases its voice connection and keeps usage unchanged on extraction failure', async (context) => {
  const usageFile = join(fixtureDirectory, 'command-usage.json');
  const previousUsageFile = process.env.PLAY_USAGE_FILE;
  process.env.PLAY_USAGE_FILE = usageFile;
  const audioModule = `
    export class TrackExtractionError extends Error {}
    export class MissingAudioToolError extends Error {}
    export async function getTrack() { return { title: 'Test song', duration: 125, url: 'https://www.youtube.com/watch?v=abcdefghijk' }; }
    export async function streamTrack(url, onFailure) {
      if (!globalThis.playTestStartPlayback) throw new TrackExtractionError('No downloadable audio format is available for this track.');
      globalThis.playTestFail = onFailure;
      return { stream: {}, completed: new Promise(() => {}), stop() { globalThis.playTestStops++; } };
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
      options: { getString: () => videoUrl },
      deferReply: async () => {},
      editReply: async (reply) => { replies.push(reply); },
    };
    await PlayCommand.prototype.chatInputRun.call({}, interaction);
    assert.equal(globalThis.playTestConnection.state.status, 'destroyed');
    assert.match(replies[0].content, /No downloadable audio format/);
    const savedUsage = JSON.parse(readFileSync(usageFile, 'utf8'));
    assert.deepEqual(Object.keys(savedUsage), ['user']);
    assert.equal(savedUsage.user.count, 0);
    globalThis.playTestStartPlayback = true;
    replies.length = 0;
    await PlayCommand.prototype.chatInputRun.call({}, interaction);
    assert.equal(JSON.parse(readFileSync(usageFile, 'utf8')).user.count, 1);
    assert.equal(globalThis.playTestConnection.state.status, 'ready');
    await globalThis.playTestFail(new TrackExtractionError('SABR audio stream interrupted'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(globalThis.playTestConnection.state.status, 'destroyed');
    assert.equal(globalThis.playTestStops, 1);
    assert.equal(JSON.parse(readFileSync(usageFile, 'utf8')).user.count, 0);
    assert.match(replies.at(-1).content, /Music playback failed/);
  } finally {
    hooks.deregister();
    delete globalThis.playTestConnection;
    delete globalThis.playTestStartPlayback;
    delete globalThis.playTestFail;
    delete globalThis.playTestStops;
    if (previousUsageFile === undefined) delete process.env.PLAY_USAGE_FILE;
    else process.env.PLAY_USAGE_FILE = previousUsageFile;
  }
});

test('missing ffmpeg reports Termux guidance and cancels the Node stream', async () => {
  let cancelled = 0;
  const failures = [];
  const playback = await streamTrack(videoUrl, (error) => failures.push(error), {
    extractor: makeExtractor({ onCancel: () => cancelled++ }),
    transcoder: join(fixtureDirectory, 'missing-ffmpeg'),
  });
  assert.equal(await playback.completed, false);
  assert.equal(cancelled, 1);
  assert.equal(failures.length, 1);
  assert.ok(failures[0] instanceof MissingAudioToolError);
  assert.match(failures[0].message, /pkg install ffmpeg/);
});

test('stopping playback cancels the source and ffmpeg without reporting failure', async () => {
  let cancelled = 0;
  const failures = [];
  const playback = await streamTrack(videoUrl, (error) => failures.push(error), {
    extractor: makeExtractor({ onCancel: () => cancelled++ }), transcoder,
  });
  await new Promise((resolve) => playback.stream.once('data', resolve));
  playback.stop();
  assert.equal(await playback.completed, false);
  assert.equal(cancelled, 1);
  assert.deepEqual(failures, []);
});

test('a completed audio stream exits cleanly', async () => {
  const failures = [];
  const playback = await streamTrack(videoUrl, (error) => failures.push(error), {
    extractor: makeExtractor({ maxChunks: 2 }), transcoder,
  });
  playback.stream.resume();
  assert.equal(await playback.completed, true);
  assert.deepEqual(failures, []);
});

test('ffmpeg failure cancels the source and refunds the consumed play', async () => {
  const usage = { count: 0, lastReset: Date.now() };
  const saved = [];
  const save = () => saved.push(usage.count);
  let cancelled = 0;
  assert.equal(consumePlay(usage, 1, save), true);
  let failure;
  const failed = new Promise((resolve) => { failure = resolve; });
  const playback = await streamTrack(videoUrl, (error) => {
    refundPlay(usage, save);
    failure(error);
  }, { extractor: makeExtractor({ onCancel: () => cancelled++ }), transcoder: failingTranscoder });
  assert.match((await failed).message, /ffmpeg failed/);
  assert.equal(await playback.completed, false);
  assert.equal(cancelled, 1);
  assert.deepEqual(saved, [1, 0]);
});

test('stream failure cancels playback and refunds exactly one consumed play', async () => {
  const usage = { count: 0, lastReset: Date.now() };
  const saved = [];
  const save = () => saved.push(usage.count);
  assert.equal(consumePlay(usage, 1, save), true);
  assert.equal(consumePlay(usage, 1, save), false);
  let failure;
  const failed = new Promise((resolve) => { failure = resolve; });
  const playback = await streamTrack(videoUrl, (error) => {
    refundPlay(usage, save);
    failure(error);
  }, { extractor: makeExtractor({ streamError: true }), transcoder });
  assert.ok(await failed instanceof TrackExtractionError);
  assert.equal(await playback.completed, false);
  assert.deepEqual(saved, [1, 0]);
  assert.equal(usage.count, 0);
});

test('failed persistence does not consume a play', () => {
  const usage = { count: 0, lastReset: Date.now() };
  assert.throws(() => consumePlay(usage, 10, () => { throw new Error('disk error'); }));
  assert.equal(usage.count, 0);
});
