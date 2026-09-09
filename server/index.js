/**
 * Server entry point.
 *
 * Boot order matters here and is deliberate:
 *   1. database   — everything else reads from it
 *   2. settings   — the queue and rate limiter are configured from it
 *   3. log bus    — attached to Socket.IO so nothing logged is lost
 *   4. queue      — given the pipeline as its runner, then orphans recovered
 *   5. preflight  — non-blocking; result cached for the Convert dialog
 *   6. listen
 */
import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import config from './config/index.js';
import { initDatabase } from './models/database.js';
import { errorHandler } from './middleware/errorHandler.js';
import booksRouter from './routes/books.js';
import audioRouter from './routes/audio.js';
import systemRouter from './routes/system.js';
import bridgeRouter from './routes/bridge.js';
import logger from './utils/logger.js';

import * as logBus from './services/logBus.js';
import { jobQueue, recoverOrphanedJobs } from './core/queue.js';
import { runJob } from './core/pipeline.js';
import { describeConcurrency } from './core/concurrency.js';
import { getSettings } from './services/settings.js';
import { configureLimiter, getQuotaSnapshot } from './services/translator.js';
import { loadKeysFromEnv, classifyKeys, snapshot as keyPoolSnapshot } from './services/keyPool.js';
import { startQuotaBroadcaster } from './services/quotaBroadcaster.js';
import { runPreflight } from './services/preflight.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// 1. Storage
// ---------------------------------------------------------------------------
initDatabase();
[config.uploadsDir, config.audioDir, config.coversDir].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));

// ---------------------------------------------------------------------------
// 2. HTTP + realtime
// ---------------------------------------------------------------------------
const app = express();
const httpServer = createServer(app);

const io = new SocketServer(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e6,
});

app.set('io', io);
logBus.attachIo(io);

app.use(cors());
app.use(express.json({ limit: '10mb' })); // custom scripts can be long
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use('/data/audio', express.static(config.audioDir));
// Covers are extracted out of the EPUB at parse time. Serving them as plain
// static files means the library grid gets browser caching for free.
app.use('/data/covers', express.static(config.coversDir, { maxAge: '7d' }));

app.use('/api/books', booksRouter);
app.use('/api/audio', audioRouter);
app.use('/api/system', systemRouter);
app.use('/api/bridge', bridgeRouter);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    queue: jobQueue.snapshot(),
  });
});

// Serve frontend static files in production / built dist
const distPath = path.join(__dirname, '../dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/data') || req.path.startsWith('/socket.io')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.use(errorHandler);

// ---------------------------------------------------------------------------
// 3. Socket rooms
//    Every client joins `global` (queue state, toasts) and may additionally
//    subscribe to one book room for its logs and per-chapter progress.
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  socket.join('global');
  logger.debug('Client connected', { socketId: socket.id });

  socket.emit('queue:state', jobQueue.snapshot());
  // Give a freshly-connected client the quota picture immediately, so the chip
  // is never blank while it waits for the first heartbeat.
  socket.emit('quota', { quota: getQuotaSnapshot(), reason: 'connect', state: 'ok', at: Date.now() });

  socket.on('subscribe', ({ bookId } = {}) => {
    if (bookId) socket.join(`book:${bookId}`);
  });

  socket.on('unsubscribe', ({ bookId } = {}) => {
    if (bookId) socket.leave(`book:${bookId}`);
  });

  socket.on('disconnect', () => logger.debug('Client disconnected', { socketId: socket.id }));
});

// ---------------------------------------------------------------------------
// 4. Work engine
// ---------------------------------------------------------------------------
const settings = getSettings();
jobQueue.setRunner(runJob);
jobQueue.configure({ concurrency: settings.concurrency });
// Only applied to models we have NOT measured (see `overridesFor`). These
// settings describe the smallest free lane, so they must never be allowed to
// cap a model we know is faster.
configureLimiter({
  tokensPerMinute: settings.tokensPerMinute,
  requestsPerMinute: settings.requestsPerMinute,
});

// The two concurrency knobs MULTIPLY, which is documented nowhere and is easy
// to misread as "2 things at once". `concurrency` is how many JOBS run, and
// each job internally runs `chapterConcurrency` chapters — so the real number
// of simultaneous Groq requests is the product. Stating it at boot is the
// difference between diagnosing a rate-limit storm in a minute and in a day.
{
  const c = describeConcurrency(settings);
  logger.info(`Work engine: ${c.text}.`, c);
}

// ---------------------------------------------------------------------------
// 4b. Key pool
// ---------------------------------------------------------------------------
// Keys come from `.env` (GROQ_API_KEYS=a,b,c) first, with the Settings-stored
// key appended. Groq's own docs recommend the environment for exactly this
// reason: it "enhances security by minimizing the risk of inadvertently
// including your API key in your codebase".
//
// IMPORTANT HONESTY NOTE: N keys only multiply quota if they belong to N
// DIFFERENT organisations — the docs say limits "apply at the organization
// level". Keys from one org share a bucket, so treating them as independent
// would make the limiter admit N× the traffic and guarantee 429s. We therefore
// probe them (`classifyKeys`) before claiming any multiplier, and report the
// number of VERIFIED lanes rather than the number of keys pasted in.
{
  const lanes = loadKeysFromEnv([settings.groqApiKey].filter(Boolean));
  if (!lanes.length) {
    logger.info('Key pool: no Groq key configured yet — add one in Settings or GROQ_API_KEYS.');
  } else {
    logger.info(`Key pool: ${lanes.length} key(s) registered; verifying how many are independent quota lanes…`);
    classifyKeys()
      .then(({ groups, errors }) => {
        const snap = keyPoolSnapshot();
        logger.info(
          `Key pool: ${snap.usable}/${snap.total} usable, ${groups.length} independent quota lane(s). ` +
          (groups.length < snap.usable
            ? 'Some keys share an organisation and therefore SHARE one rate-limit bucket — ' +
              'they add redundancy, not throughput.'
            : 'Each key is its own organisation, so per-model limits genuinely multiply.'),
          { groups, errors }
        );
      })
      .catch((err) => logger.warn(`Key pool: classification failed (${err.message}). ` +
        'Falling back to treating every key as a separate lane is UNSAFE, so the pool will ' +
        'stay unverified and the router will use one lane until this succeeds.'));
  }
}

startQuotaBroadcaster();
recoverOrphanedJobs();

// ---------------------------------------------------------------------------
// 5. Safety nets — a crashed promise must never take the whole app down
//    silently, which is what used to leave books stuck in "processing".
// ---------------------------------------------------------------------------
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: reason?.message || String(reason), stack: reason?.stack });
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
});

// ---------------------------------------------------------------------------
// 6. Listen
// ---------------------------------------------------------------------------
httpServer.listen(config.port, () => {
  logger.info(`🚀 Server running on http://localhost:${config.port}`);
  logger.info(`📁 Data directory: ${config.dataDir}`);

  // Non-blocking: the app starts even if ffmpeg is missing, but the Convert
  // dialog will refuse with a clear, fixable message instead of failing later.
  runPreflight({ force: true }).then((result) => {
    if (!result.ok) {
      for (const check of result.checks.filter((c) => !c.ok)) {
        logger.warn(`Missing: ${check.label} — ${check.fix}`);
      }
    }
  });
});

export { app, io, httpServer };
