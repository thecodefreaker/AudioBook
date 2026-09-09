/**
 * TTS Engine using pure Node.js edge-tts-universal (Microsoft Neural Voices).
 * Native WebSocket communication — NO Python or external binaries needed.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { Communicate, createVTT } from 'edge-tts-universal';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import logger from '../utils/logger.js';
import { isCancellation } from '../utils/cancellation.js';
import { chunkText } from '../utils/textChunker.js';

const ffprobePath = ffprobeStatic.path;

const execFileAsync = promisify(execFile);

/**
 * Prosody controls for edge-tts.
 */

/** Clamp and format one prosody value as edge-tts expects. */
export function formatProsody(percent, { min = -100, max = 200 } = {}) {
  const n = Math.round(Number(percent) || 0);
  const clamped = Math.max(min, Math.min(max, n));
  return `${clamped >= 0 ? '+' : ''}${clamped}%`;
}

/**
 * Convert a rate MULTIPLIER (what the UI and settings use, 1.0 = normal) into
 * the percentage delta edge-tts wants. 1.0 → "+0%", 1.25 → "+25%", 0.9 → "-10%".
 */
export function rateToPercent(multiplier) {
  const m = Number(multiplier);
  if (!Number.isFinite(m) || m <= 0) return '+0%';
  return formatProsody((m - 1) * 100);
}

/**
 * Build the prosody options for Communicate.
 */
export function getProsodyOptions(prosody = {}) {
  const ratePct = prosody?.rate === undefined || prosody?.rate === null ? '+0%' : rateToPercent(prosody.rate);
  const pitchHz = Math.round(Number(prosody?.pitch) || 0);
  const pitchStr = `${pitchHz >= 0 ? '+' : ''}${pitchHz}Hz`;
  const volPct = formatProsody(prosody?.volume ?? 0);
  return {
    rate: ratePct,
    pitch: pitchStr,
    volume: volPct,
  };
}

/**
 * Retained for backwards-compatibility with tests / scratch scripts.
 */
export function prosodyArgs({ rate, pitch, volume } = {}) {
  const opts = getProsodyOptions({ rate, pitch, volume });
  const args = [];
  if (opts.rate !== '+0%') args.push(`--rate=${opts.rate}`);
  if (opts.pitch !== '+0Hz') args.push(`--pitch=${opts.pitch}`);
  if (opts.volume !== '+0%') args.push(`--volume=${opts.volume}`);
  return args;
}

/**
 * Synthesize text to speech and save as MP3 natively via WebSocket.
 * @param {string} text - Text to synthesize
 * @param {string} voiceId - Voice identifier (e.g. 'hi-IN-MadhurNeural')
 * @param {string} outputPath - Output MP3 file path
 * @param {string} [vttPath] - Optional path to save WebVTT subtitle file
 * @param {Function} [onProgress] - Optional heartbeat / progress callback
 * @param {AbortSignal} [externalSignal] - Optional abort signal
 * @param {object} [prosody] - {rate, pitch, volume}
 * @returns {Promise<{filePath: string, fileSize: number}>}
 */
export async function synthesize(text, voiceId, outputPath, vttPath = null, onProgress = null, externalSignal = null, prosody = null) {
  // Ensure output directory exists
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const prosodyOpts = getProsodyOptions(prosody || {});
  const communicate = new Communicate(text, {
    voice: voiceId,
    rate: prosodyOpts.rate,
    pitch: prosodyOpts.pitch,
    volume: prosodyOpts.volume,
  });

  const audioChunks = [];
  const wordBoundaries = [];
  let lastHeartbeat = Date.now();

  try {
    if (externalSignal?.aborted) {
      throw new Error('Job cancelled');
    }

    for await (const chunk of communicate.stream()) {
      if (externalSignal?.aborted) {
        throw new Error('Job cancelled');
      }

      if (chunk.type === 'audio' && chunk.data) {
        audioChunks.push(chunk.data);
      } else if (chunk.type === 'WordBoundary' && chunk.offset !== undefined && chunk.duration !== undefined && chunk.text !== undefined) {
        wordBoundaries.push({
          offset: chunk.offset,
          duration: chunk.duration,
          text: chunk.text,
        });
      }

      if (onProgress && Date.now() - lastHeartbeat >= 1000) {
        lastHeartbeat = Date.now();
        try {
          onProgress({ heartbeat: true });
        } catch (err) {
          if (isCancellation(err)) throw err;
        }
      }
    }

    if (!audioChunks.length) {
      throw new Error('No audio received from Edge TTS service');
    }

    const audioBuffer = Buffer.concat(audioChunks);
    fs.writeFileSync(outputPath, audioBuffer);

    if (vttPath) {
      fs.mkdirSync(path.dirname(vttPath), { recursive: true });
      const vttContent = createVTT(wordBoundaries);
      fs.writeFileSync(vttPath, vttContent, 'utf8');
    }

    const stats = fs.statSync(outputPath);
    return { filePath: outputPath, fileSize: stats.size };
  } catch (err) {
    if (isCancellation(err) || err.message === 'Job cancelled') {
      logger.warn('TTS synthesis aborted by user', { voiceId });
      const cancelErr = new Error('Job cancelled');
      cancelErr.name = 'CancelledError';
      cancelErr.code = 'CANCELLED';
      throw cancelErr;
    }
    logger.error('TTS synthesis failed', { voiceId, error: err.message });
    throw new Error(`TTS synthesis failed: ${err.message}`);
  }
}

/**
 * Helper to shift VTT timestamps by a given offset in seconds.
 */
function shiftVtt(vttContent, offsetSeconds) {
  return vttContent.replace(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})/g, (_match, h, m, s, ms) => {
    let totalSeconds = parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000;
    totalSeconds += offsetSeconds;
    
    const newH = Math.floor(totalSeconds / 3600);
    const newM = Math.floor((totalSeconds % 3600) / 60);
    const newS = Math.floor(totalSeconds % 60);
    const newMs = Math.round((totalSeconds - Math.floor(totalSeconds)) * 1000);
    
    return `${newH.toString().padStart(2, '0')}:${newM.toString().padStart(2, '0')}:${newS.toString().padStart(2, '0')}.${newMs.toString().padStart(3, '0')}`;
  });
}

/**
 * Synthesize text in chunks, then concatenate with FFmpeg.
 * For long texts that exceed TTS limits.
 *
 * `prosody` MUST be forwarded to every chunk. Applying it to only some chunks
 * would make the narration audibly change speed or pitch part-way through a
 * chapter, which is worse than not supporting it at all.
 */
export async function synthesizeChunked(chunks, voiceId, outputPath, onProgress, signal = null, prosody = null) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  // Guarantee safety: ensure no chunk exceeds 3500 UTF-8 bytes to avoid Edge TTS payload overflow
  const safeChunks = [];
  for (const chunk of chunks) {
    if (!chunk || !chunk.trim()) continue;
    if (Buffer.byteLength(chunk, 'utf8') > 3500) {
      safeChunks.push(...chunkText(chunk, 2000, 3500));
    } else {
      safeChunks.push(chunk.trim());
    }
  }
  const effectiveChunks = safeChunks.length > 0 ? safeChunks : chunks;

  if (effectiveChunks.length === 1) {
    const vttPath = outputPath.replace('.mp3', '.vtt');
    const result = await synthesize(effectiveChunks[0], voiceId, outputPath, vttPath, onProgress, signal, prosody);
    if (onProgress) onProgress({ current: 1, total: 1, percent: 100 });
    return result;
  }

  const tempDir = outputPath + '_chunks';
  fs.mkdirSync(tempDir, { recursive: true });
  const chunkFiles = [];
  let masterVttContent = 'WEBVTT\n\n';
  let currentOffsetSeconds = 0;

  try {
    for (let i = 0; i < effectiveChunks.length; i++) {
      const chunkPath = path.join(tempDir, `chunk_${i.toString().padStart(4, '0')}.mp3`);
      const vttPath = path.join(tempDir, `chunk_${i.toString().padStart(4, '0')}.vtt`);
      
      await synthesize(effectiveChunks[i], voiceId, chunkPath, vttPath, onProgress, signal, prosody);
      chunkFiles.push(chunkPath);

      // Read chunk VTT, shift timestamps, and append to master
      if (fs.existsSync(vttPath)) {
        let chunkVtt = fs.readFileSync(vttPath, 'utf8');
        // Remove WEBVTT header from chunks
        chunkVtt = chunkVtt.replace(/^WEBVTT\s*/i, '').trim();
        if (chunkVtt) {
          const shiftedVtt = shiftVtt(chunkVtt, currentOffsetSeconds);
          masterVttContent += shiftedVtt + '\n\n';
        }
      }

      // Add this chunk's duration to the offset for the next chunk
      const duration = await getAudioDuration(chunkPath);
      currentOffsetSeconds += duration;

      if (onProgress) {
        onProgress({ current: i + 1, total: effectiveChunks.length, percent: Math.round(((i + 1) / effectiveChunks.length) * 100) });
      }
    }

    // Concatenate with FFmpeg
    const listFile = path.join(tempDir, 'filelist.txt');
    const fileListContent = chunkFiles.map(f => `file '${path.resolve(f)}'`).join('\n');
    fs.writeFileSync(listFile, fileListContent);

    await execFileAsync(ffmpegPath, [
      '-y', '-f', 'concat', '-safe', '0',
      '-i', listFile, '-c', 'copy', outputPath,
    ], { timeout: 300000 });

    // Write master VTT
    const finalVttPath = outputPath.replace('.mp3', '.vtt');
    fs.writeFileSync(finalVttPath, masterVttContent.trim());

    const stats = fs.statSync(outputPath);
    return { filePath: outputPath, fileSize: stats.size };
  } finally {
    // Clean up temp chunks
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch { /* ignore cleanup errors */ }
  }
}

/**
 * Get audio duration using FFprobe.
 */
export async function getAudioDuration(filePath) {
  try {
    const { stdout } = await execFileAsync(ffprobePath, [
      '-v', 'quiet', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
    ]);
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

/**
 * Merge multiple audio files into one.
 */
export async function mergeAudioFiles(inputPaths, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const tempDir = path.join(path.dirname(outputPath), '_merge_temp');
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    const listFile = path.join(tempDir, 'filelist.txt');
    const content = inputPaths.map(f => `file '${f}'`).join('\n');
    fs.writeFileSync(listFile, content);

    await execFileAsync(ffmpegPath, [
      '-y', '-f', 'concat', '-safe', '0',
      '-i', listFile, '-c', 'copy', outputPath,
    ], { timeout: 600000 });

    const stats = fs.statSync(outputPath);
    return { filePath: outputPath, fileSize: stats.size };
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { }
  }
}
