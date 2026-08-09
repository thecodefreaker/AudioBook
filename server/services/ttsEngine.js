/**
 * TTS Engine using edge-tts (Microsoft Neural Voices) via Python subprocess.
 * Falls back to edge-tts CLI since npm packages can be unreliable.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import logger from '../utils/logger.js';

const ffprobePath = ffprobeStatic.path;

const execFileAsync = promisify(execFile);

/**
 * Synthesize text to speech and save as MP3.
 * @param {string} text - Text to synthesize
 * @param {string} voiceId - Voice identifier (e.g. 'hi-IN-SwaraNeural')
 * @param {string} outputPath - Output MP3 file path
 * @returns {Promise<{filePath: string, fileSize: number}>}
 */
export async function synthesize(text, voiceId, outputPath, vttPath = null) {
  // Ensure output directory exists
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const tempTextFile = outputPath + '.txt';

  try {
    fs.writeFileSync(tempTextFile, text, 'utf8');

    // Use edge-tts Python CLI
    const args = [
      '--voice', voiceId,
      '--file', tempTextFile,
      '--write-media', outputPath,
    ];
    if (vttPath) {
      args.push('--write-subtitles', vttPath);
    }
    
    await execFileAsync('edge-tts', args, { timeout: 120000 }); // 2 minute timeout

    const stats = fs.statSync(outputPath);
    return { filePath: outputPath, fileSize: stats.size };
  } catch (err) {
    logger.error('TTS synthesis failed', { voiceId, error: err.message });
    throw new Error(`TTS synthesis failed: ${err.message}`);
  } finally {
    try {
      if (fs.existsSync(tempTextFile)) {
        fs.unlinkSync(tempTextFile);
      }
    } catch (cleanupErr) {
      // ignore
    }
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
 */
export async function synthesizeChunked(chunks, voiceId, outputPath, onProgress) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  if (chunks.length === 1) {
    const vttPath = outputPath.replace('.mp3', '.vtt');
    const result = await synthesize(chunks[0], voiceId, outputPath, vttPath);
    if (onProgress) onProgress({ current: 1, total: 1, percent: 100 });
    return result;
  }

  const tempDir = outputPath + '_chunks';
  fs.mkdirSync(tempDir, { recursive: true });
  const chunkFiles = [];
  let masterVttContent = 'WEBVTT\n\n';
  let currentOffsetSeconds = 0;

  try {
    for (let i = 0; i < chunks.length; i++) {
      const chunkPath = path.join(tempDir, `chunk_${i.toString().padStart(4, '0')}.mp3`);
      const vttPath = path.join(tempDir, `chunk_${i.toString().padStart(4, '0')}.vtt`);
      
      await synthesize(chunks[i], voiceId, chunkPath, vttPath);
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
        onProgress({ current: i + 1, total: chunks.length, percent: Math.round(((i + 1) / chunks.length) * 100) });
      }
    }

    // Concatenate with FFmpeg
    const listFile = path.join(tempDir, 'filelist.txt');
    const fileListContent = chunkFiles.map(f => `file '${f}'`).join('\n');
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
