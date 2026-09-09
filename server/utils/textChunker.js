/**
 * Smart text chunker that splits text at natural boundaries
 * (sentences, paragraphs) while respecting max character limits.
 */

/**
 * Helper to check if adding addition to current text exceeds character or UTF-8 byte limits.
 * Default maxBytes is 3500 to stay safely below Edge TTS's 4096 byte WebSocket payload ceiling.
 */
function fits(current, addition, separator = '\n\n', maxChars = 2000, maxBytes = 3500) {
  if (!current) {
    return addition.length <= maxChars && Buffer.byteLength(addition, 'utf8') <= maxBytes;
  }
  const combinedLength = current.length + separator.length + addition.length;
  if (combinedLength > maxChars) return false;
  const combinedBytes = Buffer.byteLength(current, 'utf8') + Buffer.byteLength(separator, 'utf8') + Buffer.byteLength(addition, 'utf8');
  return combinedBytes <= maxBytes;
}

/**
 * Split text into chunks suitable for TTS API calls.
 * Respects both character count and UTF-8 byte size (essential for multi-byte scripts like Devanagari).
 * @param {string} text - The full text to chunk
 * @param {number} maxChars - Maximum characters per chunk (default 2000)
 * @param {number} maxBytes - Maximum UTF-8 bytes per chunk (default 3500)
 * @returns {string[]} Array of text chunks
 */
export function chunkText(text, maxChars = 2000, maxBytes = 3500) {
  if (!text || text.trim().length === 0) return [];
  if (text.length <= maxChars && Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return [text.trim()];
  }

  const chunks = [];
  const paragraphs = text.split(/\n\s*\n/);

  let currentChunk = '';

  for (const paragraph of paragraphs) {
    const trimmedParagraph = paragraph.trim();
    if (!trimmedParagraph) continue;

    // If adding this paragraph would exceed the limit
    if (!fits(currentChunk, trimmedParagraph, '\n\n', maxChars, maxBytes)) {
      // If current chunk has content, save it
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }

      // If the paragraph itself is too long, split by sentences
      if (!fits('', trimmedParagraph, '', maxChars, maxBytes)) {
        const sentenceChunks = chunkBySentences(trimmedParagraph, maxChars, maxBytes);
        // Add all but the last sentence chunk directly
        for (let i = 0; i < sentenceChunks.length - 1; i++) {
          chunks.push(sentenceChunks[i].trim());
        }
        // Keep the last one as the start of the next chunk
        currentChunk = sentenceChunks[sentenceChunks.length - 1];
      } else {
        currentChunk = trimmedParagraph;
      }
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + trimmedParagraph;
    }
  }

  // Don't forget the last chunk
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Split text by sentence boundaries when a paragraph is too long.
 */
function chunkBySentences(text, maxChars, maxBytes = 3500) {
  // Split by sentence-ending punctuation (handles Hindi too: । is Hindi full stop, ॥ is double danda)
  const sentenceRegex = /(?<=[.!?।॥])\s+/g;
  const sentences = text.split(sentenceRegex);

  const chunks = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    if (!fits(currentChunk, trimmed, ' ', maxChars, maxBytes)) {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      // If a single sentence is still too long, force-split
      if (!fits('', trimmed, '', maxChars, maxBytes)) {
        const forcedChunks = forceChunk(trimmed, maxChars, maxBytes);
        for (let i = 0; i < forcedChunks.length - 1; i++) {
          chunks.push(forcedChunks[i].trim());
        }
        currentChunk = forcedChunks[forcedChunks.length - 1];
      } else {
        currentChunk = trimmed;
      }
    } else {
      currentChunk += (currentChunk ? ' ' : '') + trimmed;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Last resort: force-split at word boundaries to stay under character & byte limits.
 */
function forceChunk(text, maxChars, maxBytes = 3500) {
  const words = text.split(/\s+/);
  const chunks = [];
  let currentChunk = '';

  for (const word of words) {
    if (!word) continue;
    if (fits(currentChunk, word, ' ', maxChars, maxBytes)) {
      currentChunk += (currentChunk ? ' ' : '') + word;
    } else {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      if (!fits('', word, '', maxChars, maxBytes)) {
        let remaining = word;
        while (remaining.length > 0) {
          let take = Math.min(remaining.length, maxChars);
          while (take > 0 && Buffer.byteLength(remaining.slice(0, take), 'utf8') > maxBytes) {
            take--;
          }
          if (take === 0) take = 1;
          const piece = remaining.slice(0, take);
          remaining = remaining.slice(take);
          if (remaining.length > 0) {
            chunks.push(piece);
          } else {
            currentChunk = piece;
          }
        }
      } else {
        currentChunk = word;
      }
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Estimate reading time for text (for ETA calculations).
 * Average reading speed: ~200 words per minute spoken.
 */
export function estimateAudioDuration(text) {
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
  return (wordCount / 150) * 60; // seconds (150 wpm speaking rate)
}
