import crypto from 'crypto';
import fs from 'fs';

/**
 * Generate a SHA-256 hash of the given content.
 * Used for caching TTS output — same text + voice = same hash = skip regeneration.
 */
export function hashContent(text, voiceId, language) {
  return crypto
    .createHash('sha256')
    .update(`${text}|${voiceId}|${language}`)
    .digest('hex');
}

/**
 * Hash a file by streaming it, so a 100MB EPUB never lands in memory.
 * Used to detect "you already uploaded this book" instead of silently creating
 * a duplicate library entry.
 */
export function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
