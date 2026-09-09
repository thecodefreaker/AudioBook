import EPub from 'epub';
import fs from 'fs';
import path from 'path';
import { convert } from 'html-to-text';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger.js';
import config from '../config/index.js';
import * as db from '../models/database.js';

const COVER_EXT = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg' };

/**
 * Pull the cover image out of the EPUB and write it next to our other data.
 *
 * The href in the manifest points *inside* the zip, so storing it verbatim
 * (as we used to) produced a path the browser could never load — which is why
 * every book fell back to a placeholder. We extract the bytes once, at parse
 * time, and store a URL the client can actually request.
 *
 * @returns {Promise<string|null>} public URL, or null if the book has no cover
 */
async function extractCover(epub, bookId) {
  // `metadata.cover` is the usual pointer, but plenty of EPUBs omit it and
  // only mark the cover in the manifest, so fall back to scanning for it.
  const candidates = [];
  if (epub.metadata.cover) candidates.push(epub.metadata.cover);
  for (const [id, item] of Object.entries(epub.manifest || {})) {
    if (id === epub.metadata.cover) continue;
    const looksLikeCover = /cover/i.test(id) || /cover/i.test(item.href || '');
    if (looksLikeCover && (item['media-type'] || '').startsWith('image/')) candidates.push(id);
  }

  for (const id of candidates) {
    const item = epub.manifest[id];
    if (!item) continue;
    try {
      // This build of `epub` resolves a promise with { data, mimeType } — it
      // is NOT the Node-style callback the older API used. Getting this wrong
      // hangs the parse forever instead of erroring, so it is asserted here.
      const result = await epub.getImage(id);
      const buffer = Buffer.isBuffer(result) ? result : result?.data;
      if (!buffer || !buffer.length) continue;

      const mime = (result?.mimeType || item['media-type'] || '').toLowerCase();
      const ext = COVER_EXT[mime]
        || path.extname(item.href || '')
        || '.jpg';
      const fileName = `${bookId}${ext}`;
      fs.writeFileSync(path.join(config.coversDir, fileName), buffer);
      return `/data/covers/${fileName}`;
    } catch (err) {
      logger.debug('Cover candidate failed, trying next', { bookId, id, error: err.message });
    }
  }
  return null;
}

/**
 * Parse an EPUB file and extract chapters with their text content.
 * @param {string} bookId - The book ID in the database
 * @param {string} epubPath - Absolute path to the EPUB file
 * @param {function} onProgress - Optional callback for progress updates
 * @returns {Promise<object>} Parsed book metadata and chapters
 */
export async function parseEpub(bookId, epubPath, onProgress) {
  try {
    const epub = new EPub(epubPath);
    try {
      await epub.parse();
    } catch (parseErr) {
      logger.warn('Caught parse error', { 
        message: parseErr.message, 
        hasFlow: !!epub.flow, 
        flowLength: epub.flow ? epub.flow.length : 0 
      });
      if (parseErr.message && parseErr.message.includes('Entry not found:') && epub.flow && epub.flow.length > 0) {
        logger.warn('Ignored error during EPUB parsing (missing file, likely TOC)', { bookId, error: parseErr.message });
      } else {
        throw parseErr;
      }
    }

    // Extract metadata
    const metadata = {
      title: epub.metadata.title || 'Untitled Book',
      author: epub.metadata.creator || 'Unknown Author',
      coverImage: null,
    };

    // A missing cover is cosmetic, so it must never fail the whole parse.
    try {
      metadata.coverImage = await extractCover(epub, bookId);
    } catch (coverErr) {
      logger.warn('Could not extract cover image', { bookId, error: coverErr.message });
    }

    // Extract chapters
    const flow = epub.flow || [];
    const chapters = [];
    let chapterIndex = 0;

    if (onProgress) {
      onProgress({ phase: 'parsing', message: `Found ${flow.length} sections in EPUB`, percent: 10 });
    }

    for (let i = 0; i < flow.length; i++) {
      const section = flow[i];

      try {
        const htmlContent = await epub.getChapter(section.id);

        // Convert HTML to plain text
        const textContent = convert(htmlContent || '', {
          wordwrap: false,
          preserveNewlines: true,
          selectors: [
            { selector: 'img', format: 'skip' },
            { selector: 'a', options: { ignoreHref: true } },
            { selector: 'table', format: 'dataTable' },
          ],
        }).trim();

        // Skip empty chapters or very short sections (likely TOC, copyright, etc.)
        if (textContent.length < 50) {
          logger.debug('Skipping short section', { bookId, sectionId: section.id, length: textContent.length });
          continue;
        }

        // Determine chapter title
        let title = extractTitle(htmlContent) || section.title || `Chapter ${chapterIndex + 1}`;

        // Count words
        const wordCount = textContent.split(/\s+/).filter((w) => w.length > 0).length;
        const charCount = textContent.length;

        const chapterId = uuidv4();

        chapters.push({
          id: chapterId,
          bookId,
          chapterIndex,
          title,
          textContent,
          wordCount,
          charCount,
        });

        chapterIndex++;

        if (onProgress) {
          const percent = 10 + Math.round(((i + 1) / flow.length) * 80);
          onProgress({
            phase: 'parsing',
            message: `Extracted chapter ${chapterIndex}: ${title}`,
            percent,
          });
        }
      } catch (chapterErr) {
        logger.warn('Failed to extract chapter', {
          bookId,
          sectionId: section.id,
          error: chapterErr.message,
        });
        // Continue with other chapters
      }
    }

    if (chapters.length === 0) {
      throw new Error('No readable chapters found in this EPUB file.');
    }

    // Save to database
    db.updateBook(bookId, {
      title: metadata.title,
      author: metadata.author,
      cover_image: metadata.coverImage,
      total_chapters: chapters.length,
      status: 'parsed',
    });

    for (const chapter of chapters) {
      db.createChapter(chapter);
    }

    if (onProgress) {
      onProgress({ phase: 'complete', message: `Extracted ${chapters.length} chapters`, percent: 100 });
    }

    logger.info('EPUB parsed successfully', {
      bookId,
      title: metadata.title,
      chapters: chapters.length,
    });

    return {
      metadata,
      chapters: chapters.map(({ textContent, ...rest }) => ({
        ...rest,
        textPreview: textContent.substring(0, 200) + '...',
      })),
    };
  } catch (err) {
    logger.error('Error processing EPUB chapters', { bookId, error: err.message });
    throw err;
  }
}

/**
 * Extract a title from HTML content by looking for heading tags.
 */
function extractTitle(html) {
  if (!html) return null;
  // Try to find h1, h2, or h3 tags
  const headingMatch = html.match(/<h[1-3][^>]*>(.*?)<\/h[1-3]>/is);
  if (headingMatch) {
    // Strip inner HTML tags
    return headingMatch[1].replace(/<[^>]+>/g, '').trim();
  }
  return null;
}
