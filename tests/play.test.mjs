import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { getTrack, MissingAudioToolError, streamTrack } from '../dist/lib/playAudio.js';
import { consumePlay, refundPlay } from '../dist/lib/playUsage.js';

const fixtureDirectory = mkdtempSync(join(tmpdir(), 'play-test-'));
const downloader = join(fixtureDirectory, 'yt-dlp');
const transcoder = join(fixtureDirectory, 'ffmpeg');
writeFileSync(downloader, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
if (process.argv.includes('--dump-single-json')) {
  if (process.argv.at(-1).includes('broken')) process.exit(1);
  const track = { title: 'Test song', duration: 125, webpage_url: 'https://example.com/song' };
  console.log(JSON.stringify(process.argv.at(-1).startsWith('ytsearch1:') ? { entries: [track] } : track));
} else {
  process.on('SIGTERM', () => { writeFileSync(process.env.PLAY_TEST_MARKER, 'stopped'); process.exit(0); });
  if (process.argv.at(-1).includes('broken')) {
    process.stdout.write(Buffer.alloc(3840));
    setTimeout(() => process.exit(2), 50);
  } else {
    setInterval(() => process.stdout.write(Buffer.alloc(3840)), 20);
  }
}
`);
writeFileSync(transcoder, `#!/usr/bin/env node
process.stdin.pipe(process.stdout);
`);
chmodSync(downloader, 0o755);
chmodSync(transcoder, 0o755);
test.after(() => rmSync(fixtureDirectory, { recursive: true, force: true }));

test('metadata extracts a search result, and extraction failure never consumes usage', async () => {
  assert.deepEqual(await getTrack('test song', downloader), {
    title: 'Test song', duration: 125, url: 'https://example.com/song',
  });
  assert.equal((await getTrack('https://example.com/song', downloader)).url, 'https://example.com/song');
  const usage = { count: 2, lastReset: Date.now() };
  await assert.rejects(getTrack('broken song', downloader));
  assert.equal(usage.count, 2);
  await assert.rejects(getTrack('song', join(fixtureDirectory, 'missing')), MissingAudioToolError);
});

test('missing ffmpeg reports setup guidance and stops yt-dlp', async () => {
  const marker = join(fixtureDirectory, 'missing-ffmpeg-stopped');
  process.env.PLAY_TEST_MARKER = marker;
  let playback;
  const failure = new Promise((resolve) => {
    playback = streamTrack('https://example.com/song', (error) => {
      playback.stop();
      resolve(error);
    }, { downloader, transcoder: join(fixtureDirectory, 'missing-ffmpeg') });
  });
  assert.match((await failure).message, /Missing ffmpeg.*pkg install python ffmpeg/);
  assert.equal(await playback.completed, false);
});

test('subprocesses stop when playback is cancelled', async () => {
  const marker = join(fixtureDirectory, 'stopped');
  process.env.PLAY_TEST_MARKER = marker;
  const failures = [];
  const playback = streamTrack('https://example.com/song', (error) => failures.push(error), { downloader, transcoder });
  await new Promise((resolve) => playback.stream.once('data', resolve));
  playback.stop();
  assert.equal(await playback.completed, false);
  assert.equal(readFileSync(marker, 'utf8'), 'stopped');
  assert.deepEqual(failures, []);
});

test('download failure stops playback and refunds the consumed play', async () => {
  const usage = { count: 0, lastReset: Date.now() };
  const saved = [];
  const save = () => saved.push(usage.count);
  assert.equal(consumePlay(usage, 1, save), true);
  assert.equal(consumePlay(usage, 1, save), false);
  let playback;
  const failure = new Promise((resolve) => {
    playback = streamTrack('https://example.com/broken', (error) => {
      refundPlay(usage, save);
      playback.stop();
      resolve(error);
    }, { downloader, transcoder });
  });
  assert.match((await failure).message, /yt-dlp failed/);
  assert.equal(await playback.completed, false);
  assert.deepEqual(saved, [1, 0]);
  assert.equal(usage.count, 0);
});

test('failed persistence does not consume a play', () => {
  const usage = { count: 0, lastReset: Date.now() };
  assert.throws(() => consumePlay(usage, 10, () => { throw new Error('disk error'); }));
  assert.equal(usage.count, 0);
});
