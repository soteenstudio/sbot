import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { getTrack, MissingAudioToolError, streamTrack, TrackExtractionError } from '../dist/lib/playAudio.js';
import { consumePlay, refundPlay } from '../dist/lib/playUsage.js';

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

function makeExtractor({ failLookup = false, failDownload = false, streamError = false, maxChunks = Infinity, onCancel = () => {} } = {}) {
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
        async download(options) {
          assert.deepEqual(options, { type: 'audio', quality: 'best' });
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
