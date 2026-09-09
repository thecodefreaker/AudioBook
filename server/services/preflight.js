/**
 * Pre-flight checks.
 *
 * The single most common failure in the old build was a job dying halfway
 * through because `edge-tts` or `ffmpeg` was not on PATH — after the user had
 * already waited for the AI step. We now check once at boot, cache the result,
 * and let the Convert dialog block with a clear message instead.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { Communicate } from 'edge-tts-universal';
import logger from '../utils/logger.js';

const execFileAsync = promisify(execFile);

// The pipeline invokes the binaries bundled with the project, NOT whatever
// happens to be on PATH. Preflight must probe the exact same binaries,
// otherwise it reports a false failure and blocks the Convert dialog.
const FFMPEG_BIN = ffmpegStatic || 'ffmpeg';
const FFPROBE_BIN = ffprobeStatic?.path || 'ffprobe';

let cache = null;
let cachedAt = 0;
const TTL_MS = 60 * 1000;

async function probe(command, args) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout: 15000 });
    const out = (stdout || stderr || '').trim();
    return { ok: true, version: out.split('\n')[0].slice(0, 120) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function runPreflight({ force = false } = {}) {
  if (!force && cache && Date.now() - cachedAt < TTL_MS) return cache;

  let edgeTtsCheck;
  try {
    if (typeof Communicate === 'function') {
      edgeTtsCheck = {
        ok: true,
        version: 'bundled (Node.js)',
        bundled: true,
      };
    } else {
      edgeTtsCheck = {
        ok: false,
        error: 'Communicate not found in edge-tts-universal',
        bundled: false,
      };
    }
  } catch (err) {
    edgeTtsCheck = {
      ok: false,
      error: err.message,
      bundled: false,
    };
  }

  const [ffmpeg, ffprobe] = await Promise.all([
    probe(FFMPEG_BIN, ['-version']),
    probe(FFPROBE_BIN, ['-version']),
  ]);

  const checks = [
    {
      id: 'edge-tts',
      label: 'Edge TTS (Node.js)',
      required: true,
      ...edgeTtsCheck,
      fix: 'Bundled via edge-tts-universal — run:  npm install',
      why: 'Turns your script into speech. Pure Node.js via WebSocket.',
    },
    {
      id: 'ffmpeg',
      label: 'FFmpeg',
      required: true,
      ...ffmpeg,
      bundled: Boolean(ffmpegStatic),
      fix: 'Bundled via the ffmpeg-static package — run:  npm install',
      why: 'Joins audio chunks into one chapter file and merges chapters into a full book.',
    },
    {
      id: 'ffprobe',
      label: 'FFprobe',
      required: false,
      ...ffprobe,
      bundled: Boolean(ffprobeStatic?.path),
      fix: 'Bundled via the ffprobe-static package — run:  npm install',
      why: 'Measures audio duration. Without it, durations show as 0.',
    },
  ];

  const blocking = checks.filter((c) => c.required && !c.ok);

  cache = {
    ok: blocking.length === 0,
    checks,
    blocking: blocking.map((c) => c.id),
    checkedAt: new Date().toISOString(),
  };
  cachedAt = Date.now();

  if (!cache.ok) {
    logger.warn('Pre-flight check failed', { missing: cache.blocking });
  } else {
    logger.info('Pre-flight check passed');
  }

  return cache;
}

/** Synchronous read of the last result (null until runPreflight has run once). */
export function lastPreflight() {
  return cache;
}
