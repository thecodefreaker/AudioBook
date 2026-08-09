/**
 * Smart text chunker that splits text at natural boundaries
 * (sentences, paragraphs) while respecting max character limits.
 */

/**
 * Split text into chunks suitable for TTS API calls.
 * @param {string} text - The full text to chunk
 * @param {number} maxChars - Maximum characters per chunk (default 4500)
 * @returns {string[]} Array of text chunks
 */
export function chunkText(text, maxChars = 4500) {
  if (!text || text.trim().length === 0) return [];
  if (text.length <= maxChars) return [text.trim()];

  const chunks = [];
  const paragraphs = text.split(/\n\s*\n/);

  let currentChunk = '';

  for (const paragraph of paragraphs) {
    const trimmedParagraph = paragraph.trim();
    if (!trimmedParagraph) continue;

    // If adding this paragraph would exceed the limit
    if (currentChunk.length + trimmedParagraph.length + 2 > maxChars) {
      // If current chunk has content, save it
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }

      // If the paragraph itself is too long, split by sentences
      if (trimmedParagraph.length > maxChars) {
        const sentenceChunks = chunkBySentences(trimmedParagraph, maxChars);
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
function chunkBySentences(text, maxChars) {
  // Split by sentence-ending punctuation (handles Hindi too: । is Hindi full stop)
  const sentenceRegex = /(?<=[.!?।])\s+/g;
  const sentences = text.split(sentenceRegex);

  const chunks = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    if (currentChunk.length + trimmed.length + 1 > maxChars) {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      // If a single sentence is still too long, force-split by character count
      if (trimmed.length > maxChars) {
        const forcedChunks = forceChunk(trimmed, maxChars);
        chunks.push(...forcedChunks.slice(0, -1));
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
 * Last resort: force-split at word boundaries to stay under the limit.
 */
function forceChunk(text, maxChars) {
  const words = text.split(/\s+/);
  const chunks = [];
  let currentChunk = '';

  for (const word of words) {
    if (currentChunk.length + word.length + 1 > maxChars) {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = word;
    } else {
      currentChunk += (currentChunk ? ' ' : '') + word;
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
