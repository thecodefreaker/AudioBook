import path from 'path';
import { fileURLToPath } from 'url';

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
  ttsDefaultVoice: 'en-US-AriaNeural',
  ttsDefaultHindiVoice: 'hi-IN-SwaraNeural',

  // Translation
  translationChunkMaxChars: 4000,
};

export default config;
