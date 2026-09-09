import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

/**
 * `dotenv` was already a dependency but was NEVER imported, so every
 * `process.env.*` read below silently fell through to its default and a `.env`
 * file had no effect whatsoever. Importing it here — in the module every other
 * module already loads first — makes `.env` actually work, which is the
 * precondition for keeping API keys out of the database and out of source.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Paths
  dataDir: path.resolve(__dirname, '../../data'),
  uploadsDir: path.resolve(__dirname, '../../data/uploads'),
  audioDir: path.resolve(__dirname, '../../data/audio'),
  coversDir: path.resolve(__dirname, '../../data/covers'),
  dbPath: path.resolve(__dirname, '../../data/database.sqlite'),

  // Upload limits
  maxFileSize: 100 * 1024 * 1024, // 100MB
  allowedMimeTypes: ['application/epub+zip'],

  // TTS
  ttsChunkMaxChars: 2000,
  ttsChunkMaxBytes: 3500,
  ttsDefaultVoice: 'en-US-AriaNeural',
  ttsDefaultHindiVoice: 'hi-IN-SwaraNeural',

  // Translation
  translationChunkMaxChars: 4000,
};

export default config;
