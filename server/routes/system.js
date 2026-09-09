/**
 * System routes — settings, dependency status, languages/styles, models, queue.
 *
 * These are the endpoints that let the UI stop guessing: it can ask what
 * languages exist, which models the key can actually reach, whether ffmpeg is
 * installed, and what the queue is doing right now.
 */
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import config from '../config/index.js';
import * as db from '../models/database.js';
import { getPublicSettings, updateSettings, clearSecret, resolveApiKey } from '../services/settings.js';
import { runPreflight } from '../services/preflight.js';
import { fetchAvailableModels, testApiKey, getQuotaSnapshot, configureLimiter } from '../services/translator.js';
import { listLanguages, VOICE_PREVIEW_TEXT } from '../languages/index.js';
import { listStyles, MASTER_SYSTEM_PROMPT, PROMPT_VERSION } from '../services/prompts.js';
import { jobQueue } from '../core/queue.js';
import * as S from './serialize.js';

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

router.get('/settings', (req, res) => {
  res.json({ settings: getPublicSettings() });
});

router.put('/settings', (req, res) => {
  const result = updateSettings(req.body || {});

  // Some settings must take effect immediately, not on next boot.
  if (result.applied.includes('concurrency')) {
    jobQueue.configure({ concurrency: result.settings.concurrency });
  }
  if (result.applied.includes('tokensPerMinute') || result.applied.includes('requestsPerMinute')) {
    configureLimiter({
      tokensPerMinute: result.settings.tokensPerMinute,
      requestsPerMinute: result.settings.requestsPerMinute,
    });
  }

  res.json(result);
});

router.delete('/settings/api-key', (req, res) => {
  res.json({ settings: clearSecret('groqApiKey') });
});

// ---------------------------------------------------------------------------
// Capability discovery
// ---------------------------------------------------------------------------

router.get('/languages', (req, res) => {
  res.json({
    languages: listLanguages(),
    styles: listStyles(),
    previewText: VOICE_PREVIEW_TEXT,
  });
});

router.get('/prompt', (req, res) => {
  const settings = getPublicSettings();
  res.json({
    version: PROMPT_VERSION,
    default: MASTER_SYSTEM_PROMPT,
    override: settings.promptOverride || '',
    isOverridden: !!settings.promptOverride,
  });
});

router.get('/preflight', wrap(async (req, res) => {
  res.json(await runPreflight({ force: req.query.force === 'true' }));
}));

router.get('/models', wrap(async (req, res) => {
  const apiKey = resolveApiKey(req.query.apiKey);
  if (!apiKey) {
    return res.json({ models: [], error: 'No API key saved. Add one in Settings.' });
  }
  res.json(await fetchAvailableModels(apiKey, { force: req.query.force === 'true' }));
}));

router.post('/test-key', wrap(async (req, res) => {
  const apiKey = resolveApiKey(req.body?.apiKey);
  res.json(await testApiKey(apiKey));
}));

router.get('/quota', (req, res) => {
  res.json({ quota: getQuotaSnapshot() });
});

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

router.get('/queue', (req, res) => {
  res.json({
    ...jobQueue.snapshot(),
    active: db.getActiveJobs().map((j) => S.job(j, jobQueue.status(j.id))),
    recent: db.getRecentJobs(20).map((j) => S.job(j)),
  });
});

router.post('/queue/pause', (req, res) => {
  jobQueue.pause();
  res.json({ paused: true, ...jobQueue.snapshot() });
});

router.post('/queue/resume', (req, res) => {
  jobQueue.resume();
  res.json({ paused: false, ...jobQueue.snapshot() });
});

router.post('/queue/cancel-all', (req, res) => {
  res.json(jobQueue.cancelAll(req.body?.reason || 'Cancelled by user'));
});

// ---------------------------------------------------------------------------
// Storage & Database Export
// ---------------------------------------------------------------------------

router.get('/storage', (req, res) => {
  res.json({ storage: db.getStorageStats() });
});

router.get('/export-db', wrap(async (req, res) => {
  const database = db.getDb();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const exportFileName = `audiobook_db_${timestamp}.sqlite`;
  const tempExportPath = path.join(config.dataDir, `export_temp_${Date.now()}.sqlite`);

  try {
    await database.backup(tempExportPath);
    res.download(tempExportPath, exportFileName, (err) => {
      if (fs.existsSync(tempExportPath)) {
        fs.unlink(tempExportPath, () => {});
      }
    });
  } catch (err) {
    if (fs.existsSync(tempExportPath)) {
      try { fs.unlinkSync(tempExportPath); } catch {}
    }
    res.status(500).json({ error: 'Database export failed', message: err.message });
  }
}));

export default router;
