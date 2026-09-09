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
  dataDir: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(__dirname, '../../data'),
  get uploadsDir() { return path.join(this.dataDir, 'uploads'); },
  get audioDir() { return path.join(this.dataDir, 'audio'); },
  get coversDir() { return path.join(this.dataDir, 'covers'); },
  get dbPath() { return path.join(this.dataDir, 'database.sqlite'); },

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
