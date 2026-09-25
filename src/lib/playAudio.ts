import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { runInNewContext } from 'node:vm';
import { Innertube, Platform } from 'youtubei.js';

export class MissingAudioToolError extends Error {
  constructor() {
    super('Missing ffmpeg. Install it (in Termux: pkg install ffmpeg) and ensure it is on PATH.');
  }
}

export class TrackExtractionError extends Error {}

type Extractor = Pick<Innertube, 'search' | 'getBasicInfo'>;
let extractorPromise: Promise<Innertube> | undefined;

Platform.shim.eval = (data, environment) => runInNewContext(data.output, environment, { timeout: 5_000 });

function getExtractor(): Promise<Innertube> {
  return extractorPromise ??= Innertube.create().catch((error) => {
    extractorPromise = undefined;
    throw error;
  });
}

function videoId(query: string): string {
  let url: URL;
  try {
    url = new URL(query);
  } catch {
    throw new TrackExtractionError('Only YouTube video links are supported.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new TrackExtractionError('Only HTTP(S) YouTube video links are supported.');
  }
  const host = url.hostname.toLowerCase();
  const id = host === 'youtu.be' ? url.pathname.slice(1) :
    (host === 'youtube.com' || host.endsWith('.youtube.com')) ?
      url.pathname === '/watch' ? url.searchParams.get('v') :
      /^\/(shorts|live|embed)\//.test(url.pathname) ? url.pathname.split('/')[2] : null : null;
  if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) {
    throw new TrackExtractionError('Only YouTube video links are supported.');
  }
  return id;
}

export async function getTrack(query: string, extractor?: Extractor) {
  try {
    const client = extractor ?? await getExtractor();
    let id: string | undefined;
    if (/^https?:\/\//i.test(query)) {
      id = videoId(query);
    } else {
      const results = await client.search(query, { type: 'video' });
      const video = results.videos.find((result) => 'video_id' in result);
      id = video && 'video_id' in video ? video.video_id : undefined;
    }
    if (!id) throw new TrackExtractionError('No playable track found. Try another title.');
    const info = await client.getBasicInfo(id);
    if (!info.basic_info.title) throw new TrackExtractionError('No playable track found. Try another title.');
    return { title: info.basic_info.title, duration: info.basic_info.duration ?? 0, url: `https://www.youtube.com/watch?v=${id}` };
  } catch (error) {
    if (error instanceof TrackExtractionError) throw error;
    throw new TrackExtractionError('Could not extract this track. Please try another title or YouTube link.', { cause: error });
  }
}

export async function streamTrack(
  url: string,
  onFailure: (error: Error) => void,
  options: { extractor?: Extractor; transcoder?: string } = {},
) {
  const id = videoId(url);
  let source: Readable;
  try {
    const client = options.extractor ?? await getExtractor();
    const info = await client.getBasicInfo(id);
    const seenItags = new Set<number>();
    const formats = [...(info.streaming_data?.formats ?? []), ...(info.streaming_data?.adaptive_formats ?? [])]
      .filter((format) => {
        if (seenItags.has(format.itag)) return false;
        seenItags.add(format.itag);
        return format.has_audio && (format.url || format.signature_cipher || format.cipher);
      });
    const audioOnly = formats.filter((format) => !format.has_video && !format.has_text);
    const candidates = audioOnly.length ? audioOnly : formats;
    const original = candidates.filter((format) => format.is_original);
    const selected = (original.length ? original : candidates).sort((first, second) => second.bitrate - first.bitrate)[0];
    if (!selected) throw new TrackExtractionError('No downloadable audio format is available for this track. Please try another title or YouTube link.');
    const webStream = await info.download({ type: 'audio', quality: 'best', itag: selected.itag });
    source = Readable.fromWeb(webStream as NodeReadableStream<Uint8Array>);
  } catch (error) {
    if (error instanceof TrackExtractionError) throw error;
    throw new TrackExtractionError('Could not extract audio from this track. Please try another title or YouTube link.', { cause: error });
  }

  const transcoder = spawn(options.transcoder ?? 'ffmpeg', [
    '-nostdin', '-loglevel', 'error', '-i', 'pipe:0',
    '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1',
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stopped = false;
  let failed = false;
  let bytesReceived = 0;
  let transcoderError = '';
  let complete!: (success: boolean) => void;
  const completed = new Promise<boolean>((resolve) => { complete = resolve; });
  const stop = () => {
    if (stopped) return;
    stopped = true;
    source.unpipe(transcoder.stdin);
    source.destroy();
    transcoder.stdin.destroy();
    transcoder.stdout.destroy();
    transcoder.kill();
  };
  const fail = (error: Error) => {
    if (failed || stopped) return;
    failed = true;
    stop();
    onFailure(error);
  };
  source.on('error', (error) => fail(new TrackExtractionError('Audio extraction failed during playback. Please try another track.', { cause: error })));
  source.on('close', () => {
    if (!source.readableEnded) fail(new TrackExtractionError('Audio extraction ended unexpectedly. Please try another track.'));
  });
  transcoder.stdin.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') fail(error);
  });
  transcoder.stdout.on('data', (chunk: Buffer) => { bytesReceived += chunk.length; });
  transcoder.stderr.setEncoding('utf8');
  transcoder.stderr.on('data', (chunk: string) => { transcoderError = (transcoderError + chunk).slice(-2048); });
  transcoder.on('error', (error: NodeJS.ErrnoException) => {
    fail(error.code === 'ENOENT' ? new MissingAudioToolError() : error);
  });
  transcoder.on('close', (code) => {
    if (!stopped && (code !== 0 || bytesReceived === 0)) {
      fail(new Error(`ffmpeg failed: ${transcoderError || `exit ${code}; no audio received`}`));
    }
    complete(!failed && !stopped);
  });
  source.pipe(transcoder.stdin);

  return { stream: transcoder.stdout, completed, stop };
}
