import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

const API = 'https://api.audius.co/v1';

export class MissingAudioToolError extends Error {
  constructor() {
    super('Missing ffmpeg. Install it (in Termux: pkg install ffmpeg) and ensure it is on PATH.');
  }
}

export class TrackExtractionError extends Error {}

type AudiusTrack = {
  id?: string;
  title?: string;
  duration?: number;
  permalink?: string;
  is_streamable?: boolean;
  access?: { stream?: boolean };
};

function providerError(status: number): TrackExtractionError {
  if (status === 429) return new TrackExtractionError('Audius is rate-limiting requests. Please try again later.');
  return new TrackExtractionError('Audius is unavailable or this track cannot be streamed. Please try another title.');
}

export async function getTrack(query: string, request: typeof fetch = fetch) {
  if (/^(?:\w+:\/\/|(?:www\.)?(?:youtube\.com|youtu\.be)(?:\/|$))/i.test(query.trim())) {
    throw new TrackExtractionError('Links, including YouTube links, are not supported. Search by song title on Audius instead.');
  }
  if (!query.trim()) throw new TrackExtractionError('Enter a song title to search on Audius.');
  try {
    const url = new URL(`${API}/tracks/search`);
    url.searchParams.set('query', query.trim());
    url.searchParams.set('limit', '10');
    const response = await request(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw providerError(response.status);
    const result: { data?: AudiusTrack[] } = await response.json();
    const track = result.data?.find((item) =>
      item.id && item.title && item.is_streamable && item.access?.stream &&
      item.permalink?.startsWith('/') && !item.permalink.startsWith('//'),
    );
    if (!track?.id || !track.title || !track.permalink) {
      throw new TrackExtractionError('No streamable track found on Audius. Try another title.');
    }
    return {
      id: track.id,
      title: track.title,
      duration: track.duration ?? 0,
      url: `https://audius.co${track.permalink}`,
    };
  } catch (error) {
    if (error instanceof TrackExtractionError) throw error;
    throw new TrackExtractionError('Could not search Audius. Please try again later.', { cause: error });
  }
}

export async function streamTrack(
  id: string,
  onFailure: (error: Error) => void,
  options: { request?: typeof fetch; transcoder?: string } = {},
) {
  if (!/^[a-zA-Z0-9]+$/.test(id)) throw new TrackExtractionError('Invalid Audius track ID.');
  const controller = new AbortController();
  let source: Readable;
  try {
    const response = await (options.request ?? fetch)(`${API}/tracks/${id}/stream`, {
      signal: controller.signal,
    });
    if (!response.ok) throw providerError(response.status);
    if (!response.body || !/^(audio\/|application\/octet-stream)/i.test(response.headers.get('content-type') ?? '')) {
      throw new TrackExtractionError('This Audius track has no playable audio stream. Try another title.');
    }
    source = Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>);
  } catch (error) {
    controller.abort();
    if (error instanceof TrackExtractionError) throw error;
    throw new TrackExtractionError('Could not open this Audius audio stream. Try another title.', { cause: error });
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
    controller.abort();
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
  source.on('error', (error) => fail(new TrackExtractionError('Audius audio stream failed during playback. Please try another track.', { cause: error })));
  source.on('close', () => {
    if (!source.readableEnded) fail(new TrackExtractionError('Audius audio stream ended unexpectedly. Please try another track.'));
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
