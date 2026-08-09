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
import logger from './utils/logger.js';

import * as logBus from './services/logBus.js';
import { jobQueue, recoverOrphanedJobs } from './core/queue.js';
import { runJob } from './core/pipeline.js';
import { getSettings } from './services/settings.js';
import { configureLimiter } from './services/translator.js';
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
  cors: { origin: ['http://localhost:5173', 'http://localhost:3000'], methods: ['GET', 'POST'] },
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

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    queue: jobQueue.snapshot(),
  });
});

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
configureLimiter({
  tokensPerMinute: settings.tokensPerMinute,
  requestsPerMinute: settings.requestsPerMinute,
});
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
