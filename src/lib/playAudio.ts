import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const runFile = promisify(execFile);

export class MissingAudioToolError extends Error {
  constructor(tool: string) {
    super(`Missing ${tool}. Install yt-dlp and ffmpeg (in Termux: pkg install python ffmpeg && pip install -U yt-dlp) and ensure both are on PATH.`);
  }
}

function toolError(error: unknown, tool: string): Error {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
    ? new MissingAudioToolError(tool)
    : error instanceof Error ? error : new Error(String(error));
}

export async function getTrack(query: string, binary = 'yt-dlp') {
  const source = /^https?:\/\//i.test(query) ? query : `ytsearch1:${query}`;
  try {
    const { stdout } = await runFile(binary, [
      '--dump-single-json', '--skip-download', '--no-playlist', '--no-warnings', '--', source,
    ], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    const result: { entries?: Array<{ title?: string; duration?: number; webpage_url?: string }>; title?: string; duration?: number; webpage_url?: string } = JSON.parse(stdout);
    const info = result.entries ? result.entries[0] : result;
    if (!info?.title || !info.webpage_url || !/^https?:\/\//i.test(info.webpage_url)) {
      throw new Error('No playable track found');
    }
    return { title: info.title, duration: info.duration ?? 0, url: info.webpage_url };
  } catch (error) {
    throw toolError(error, 'yt-dlp');
  }
}

export function streamTrack(url: string, onFailure: (error: Error) => void, binaries = { downloader: 'yt-dlp', transcoder: 'ffmpeg' }) {
  const downloader = spawn(binaries.downloader, [
    '--no-playlist', '--no-warnings', '--no-progress', '--no-part',
    '-f', 'bestaudio/best', '-o', '-', '--', url,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const transcoder = spawn(binaries.transcoder, [
    '-nostdin', '-loglevel', 'error', '-i', 'pipe:0',
    '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1',
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stopped = false;
  let bytesReceived = 0;
  let downloaderError = '';
  let transcoderError = '';
  let closed = 0;
  let failed = false;
  let complete!: (success: boolean) => void;
  const completed = new Promise<boolean>((resolve) => { complete = resolve; });
  const fail = (error: Error) => {
    failed = true;
    if (!stopped) onFailure(error);
  };
  const processClosed = () => {
    closed++;
    if (closed === 2) complete(!failed && !stopped);
  };
  downloader.stderr.setEncoding('utf8');
  transcoder.stderr.setEncoding('utf8');
  downloader.stderr.on('data', (chunk: string) => { downloaderError = (downloaderError + chunk).slice(-2048); });
  transcoder.stderr.on('data', (chunk: string) => { transcoderError = (transcoderError + chunk).slice(-2048); });
  downloader.stdout.pipe(transcoder.stdin);
  transcoder.stdin.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') fail(error);
  });
  transcoder.stdout.on('data', (chunk: Buffer) => { bytesReceived += chunk.length; });
  downloader.on('error', (error) => fail(toolError(error, 'yt-dlp')));
  transcoder.on('error', (error) => fail(toolError(error, 'ffmpeg')));
  downloader.on('close', (code) => {
    if (code !== 0) fail(new Error(`yt-dlp failed: ${downloaderError || `exit ${code}`}`));
    processClosed();
  });
  transcoder.on('close', (code) => {
    if (code !== 0 || bytesReceived === 0) fail(new Error(`ffmpeg failed: ${transcoderError || `exit ${code}; no audio received`}`));
    processClosed();
  });

  return {
    stream: transcoder.stdout,
    completed,
    stop: () => {
      if (stopped) return;
      stopped = true;
      downloader.stdout.unpipe(transcoder.stdin);
      downloader.kill();
      transcoder.kill();
      transcoder.stdin.destroy();
      transcoder.stdout.destroy();
    },
  };
}
