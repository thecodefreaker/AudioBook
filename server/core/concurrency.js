/**
 * Concurrency policy — one place that decides how much work may be in flight.
 *
 * WHY THIS EXISTS
 * ---------------
 * There are TWO independent knobs and they MULTIPLY, which was documented
 * nowhere and reads to an operator as "2 things at once":
 *
 *   settings.concurrency        how many JOBS run simultaneously      (1..4)
 *   settings.chapterConcurrency how many CHAPTERS run inside each job (1..8)
 *
 * The real number of simultaneous Groq/edge-tts requests is the PRODUCT. At
 * the defaults that is 2 x 2 = 4; at the maximums it is 4 x 8 = 32. Thirty-two
 * parallel requests against a free tier whose smallest lane is 6 000 TPM does
 * not fail loudly — the limiter absorbs it by queueing, so the symptom is a
 * pipeline that looks mysteriously slow while burning RPD, which is very hard
 * to attribute back to a settings page.
 *
 * So the product is capped here, and the cap is applied to the CHAPTER pool
 * rather than the job pool: jobs are usually different books, and starving
 * those would look like the queue is stuck, whereas chapters within one job
 * are interchangeable and slowing them is invisible.
 */

/**
 * Ceiling on simultaneous provider requests across the whole process.
 *
 * Chosen against the measured limits rather than by feel: the narrowest
 * rotation lane is 6 000 TPM and a chunk is sized at ~5 100 tokens worst case,
 * so more than a handful of truly parallel requests cannot be served inside a
 * single minute window anyway — they would just queue. Eight leaves headroom
 * for TTS (which has no Groq cost) without pretending we can run 32.
 */
export const MAX_PARALLEL_REQUESTS = 8;

/** Jobs in flight at once. */
export function effectiveJobConcurrency(settings) {
  return Math.max(1, Math.min(Number(settings.concurrency) || 1, 4));
}

/**
 * Chapters in flight inside ONE job, reduced so that
 * `jobs * chapters <= MAX_PARALLEL_REQUESTS`.
 *
 * @param {object} settings
 * @param {number} [total] chapters in this job; never spawn more workers than work
 */
export function effectiveChapterConcurrency(settings, total = Infinity) {
  const jobs = effectiveJobConcurrency(settings);
  const requested = Math.max(1, Math.min(Number(settings.chapterConcurrency) || 2, 8));
  const allowed = Math.max(1, Math.floor(MAX_PARALLEL_REQUESTS / jobs));
  return Math.max(1, Math.min(requested, allowed, total));
}

/** Human-readable summary for the boot log. */
export function describeConcurrency(settings) {
  const jobs = effectiveJobConcurrency(settings);
  const chapters = effectiveChapterConcurrency(settings);
  const requested = Math.max(1, Math.min(Number(settings.chapterConcurrency) || 2, 8));
  const clamped = chapters < requested;
  return {
    jobs,
    chapters,
    peak: jobs * chapters,
    clamped,
    text: `up to ${jobs} job(s) x ${chapters} chapter(s) = ${jobs * chapters} concurrent AI/TTS requests`
      + (clamped ? ` (chapterConcurrency reduced from ${requested} to stay under ${MAX_PARALLEL_REQUESTS})` : ''),
  };
}
