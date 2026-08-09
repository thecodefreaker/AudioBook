import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import * as db from '../models/database.js';
import * as S from './serialize.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';

const router = Router();

/**
 * GET /api/audio/:audioId/stream
 * Stream an audio file for playback.
 */
router.get('/:audioId/stream', (req, res) => {
  try {
    const audio = db.getAudioFileById(req.params.audioId);
    if (!audio) {
      return res.status(404).json({ error: 'Audio file not found' });
    }

    const filePath = audio.file_path;

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Audio file missing from disk' });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      // Support range requests for seeking in audio player
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      const stream = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'audio/mpeg',
      });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'audio/mpeg',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    logger.error('Error streaming audio', { audioId: req.params.audioId, error: err.message });
    res.status(500).json({ error: 'Failed to stream audio' });
  }
});

/**
 * GET /api/audio/:audioId/vtt
 * Serve the VTT subtitle file for an audio track.
 */
router.get('/:audioId/vtt', (req, res) => {
  try {
    const audio = db.getAudioFileById(req.params.audioId);
    if (!audio) {
      return res.status(404).json({ error: 'Audio file not found' });
    }

    const vttPath = audio.file_path.replace('.mp3', '.vtt');

    if (!fs.existsSync(vttPath)) {
      return res.status(404).json({ error: 'VTT file not found' });
    }

    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.sendFile(path.resolve(vttPath));
  } catch (err) {
    logger.error('Error serving VTT', { audioId: req.params.audioId, error: err.message });
    res.status(500).json({ error: 'Failed to serve VTT' });
  }
});

/**
 * GET /api/audio/:audioId/download
 * Download an audio file.
 */
router.get('/:audioId/download', (req, res) => {
  try {
    const audio = db.getAudioFileById(req.params.audioId);
    if (!audio) {
      return res.status(404).json({ error: 'Audio file not found' });
    }

    const filePath = audio.file_path;

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Audio file missing from disk' });
    }

    // Build a descriptive filename
    let fileName;
    if (audio.is_merged) {
      const book = db.getBookById(audio.book_id);
      fileName = `${book ? book.title : 'audiobook'}_complete.mp3`;
    } else {
      const chapter = db.getChapterById(audio.chapter_id);
      fileName = `${chapter ? chapter.title : 'chapter'}.mp3`;
    }

    // Sanitize filename
    // Non-ASCII titles used to become "________". Only strip characters that
    // are genuinely illegal in a filename, and keep Devanagari intact.
    fileName = fileName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').trim() || 'audio.mp3';

    res.download(filePath, fileName);
  } catch (err) {
    logger.error('Error downloading audio', { audioId: req.params.audioId, error: err.message });
    res.status(500).json({ error: 'Failed to download audio' });
  }
});

/**
 * GET /api/audio/:audioId
 * Full metadata for one version, including the script it was made from.
 * This is what lets the reader show "you are hearing THIS text" truthfully.
 */
router.get('/:audioId', (req, res) => {
  const audio = db.getAudioFileById(req.params.audioId);
  if (!audio) return res.status(404).json({ error: 'Audio file not found' });

  const script = audio.script_id ? db.getScriptById(audio.script_id) : null;

  res.json({
    audio: S.audio(audio),
    script: script ? S.script(script) : null,
    fileExists: fs.existsSync(audio.file_path),
  });
});

/**
 * GET /api/audio/:audioId/alignment
 * Sentence ↔ timestamp map for karaoke highlighting.
 * `approximate: true` means we had no word-level subtitles and distributed by
 * character weight — the UI says so rather than pretending to be exact.
 */
router.get('/:audioId/alignment', (req, res) => {
  const audio = db.getAudioFileById(req.params.audioId);
  if (!audio) return res.status(404).json({ error: 'Audio file not found' });

  if (!audio.alignment_json) {
    return res.json({ alignment: null, reason: 'No alignment was stored for this version.' });
  }

  try {
    res.json({ alignment: JSON.parse(audio.alignment_json), duration: audio.duration_seconds });
  } catch {
    res.json({ alignment: null, reason: 'Stored alignment is unreadable.' });
  }
});

/**
 * GET /api/audio/chapter/:chapterId/versions
 * Every version generated for a chapter — powers the version switcher.
 */
router.get('/chapter/:chapterId/versions', (req, res) => {
  res.json({ versions: db.getAudioVersionsByChapterId(req.params.chapterId).map(S.audio) });
});

/** PATCH /api/audio/:audioId — rename a version or star it. */
router.patch('/:audioId', (req, res) => {
  const audio = db.getAudioFileById(req.params.audioId);
  if (!audio) return res.status(404).json({ error: 'Audio file not found' });

  const updates = {};
  if (typeof req.body?.label === 'string' && req.body.label.trim()) {
    updates.label = req.body.label.trim().slice(0, 120);
  }
  if (req.body?.isFavourite !== undefined) {
    updates.is_favourite = req.body.isFavourite ? 1 : 0;
  }
  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  db.updateAudioFile(audio.id, updates);
  res.json({ audio: S.audio(db.getAudioFileById(audio.id)) });
});

/** DELETE /api/audio/:audioId — remove one version, file and row together. */
router.delete('/:audioId', (req, res) => {
  const audio = db.getAudioFileById(req.params.audioId);
  if (!audio) return res.status(404).json({ error: 'Audio file not found' });

  for (const p of [audio.file_path, audio.file_path?.replace(/\.mp3$/, '.vtt')]) {
    if (p && fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch (err) { logger.warn('Could not delete file', { p, error: err.message }); }
    }
  }
  db.deleteAudioFileById(audio.id);
  res.json({ success: true, message: 'Version deleted.' });
});

export default router;
