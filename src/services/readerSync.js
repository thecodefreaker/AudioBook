/**
 * Reader ↔ audio synchronisation.
 *
 * WHY THE OLD SYNC NEVER FELT RIGHT
 * ---------------------------------
 * It guessed. Highlighting did:
 *
 *     paraIdx = floor((cueIdx / totalCues) * totalParagraphs)
 *
 * which assumes every paragraph takes an equal share of the audio. One long
 * paragraph followed by a one-line reply throws it off, and the drift compounds
 * through the chapter. Click-to-seek used the same guess in reverse, so clicking
 * a line jumped somewhere near it at best.
 *
 * WHAT THIS DOES INSTEAD
 * ----------------------
 * The backend already walks the real edge-tts word-level subtitles and stores a
 * sentence → time map (`alignment_json`). We use it directly:
 *
 *   time → sentence   binary search over sorted ranges  (highlight)
 *   sentence → time   read the range's start            (click-to-seek)
 *
 * Both directions read the SAME table, so they can never disagree — clicking a
 * sentence and letting playback reach it land on the identical timestamp.
 *
 * HONESTY ABOUT ACCURACY
 * ----------------------
 * Alignment is computed against the text that was actually SPOKEN. If you are
 * playing Hindi audio while reading the English original, no true mapping
 * exists. Rather than silently highlight the wrong line, we report
 * `syncable: false` and the UI says so.
 */

export class ReaderSync {
  constructor({ audio, container, onSentenceChange } = {}) {
    this.audio = audio;
    this.container = container;
    this.onSentenceChange = onSentenceChange;

    this.sentences = [];      // [{ i, s, e, p }] sorted by start time
    this.approximate = false;
    this.syncable = false;
    this.activeIndex = -1;

    /** Auto-scroll is OFF by default: nothing yanks the page while you read. */
    this.followMode = false;

    this._rafId = null;
    this._lastTime = -1;
    this._userScrolledAt = 0;

    this._onScroll = this._onScroll.bind(this);
    this._tick = this._tick.bind(this);
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  /**
   * @param {object} alignment  { approximate, sentences: [{i,s,e,p}] }
   * @param {boolean} textMatchesAudio  is the visible text the spoken text?
   */
  load(alignment, textMatchesAudio) {
    this.stop();
    this.activeIndex = -1;
    this._lastTime = -1;

    if (!alignment?.sentences?.length || !textMatchesAudio) {
      this.sentences = [];
      this.syncable = false;
      this.approximate = false;
      return this;
    }

    // Sort defensively — binary search requires monotonic starts.
    this.sentences = [...alignment.sentences].sort((a, b) => a.s - b.s);
    this.approximate = !!alignment.approximate;
    this.syncable = true;

    this.container?.addEventListener('scroll', this._onScroll, { passive: true });
    return this;
  }

  /** Status text the UI can show without inventing its own wording. */
  get statusText() {
    if (!this.syncable) return 'Text sync unavailable for this view';
    if (this.approximate) return 'Approximate sync (no word timings available)';
    return 'Synced to audio';
  }

  // -------------------------------------------------------------------------
  // time → sentence
  // -------------------------------------------------------------------------

  /** Binary search: O(log n), so a 5,000-sentence chapter stays smooth. */
  indexAtTime(time) {
    const list = this.sentences;
    if (!list.length) return -1;

    let lo = 0;
    let hi = list.length - 1;
    let best = -1;

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].s <= time) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    if (best === -1) return -1;

    // Inside a gap (silence between sentences) keep the previous sentence lit
    // rather than flickering to nothing.
    return best;
  }

  // -------------------------------------------------------------------------
  // sentence → time
  // -------------------------------------------------------------------------

  timeAtIndex(sentenceIndex) {
    const hit = this.sentences.find((s) => s.i === sentenceIndex);
    return hit ? hit.s : null;
  }

  /**
   * Seek the audio to a sentence. Returns false when this view cannot be
   * mapped, so the caller can explain instead of doing nothing.
   */
  seekToSentence(sentenceIndex) {
    if (!this.syncable || !this.audio?.src) return false;

    const time = this.timeAtIndex(sentenceIndex);
    if (time === null) return false;

    // Nudge inside the range; seeking to the exact boundary can land the
    // decoder on the previous sentence.
    this.audio.currentTime = time + 0.01;
    this.setActive(sentenceIndex, { scroll: this.followMode });
    return true;
  }

  // -------------------------------------------------------------------------
  // Highlighting
  // -------------------------------------------------------------------------

  setActive(sentenceIndex, { scroll = false } = {}) {
    if (sentenceIndex === this.activeIndex) return;

    const previous = this.container?.querySelector('.sentence-active');
    previous?.classList.remove('sentence-active');

    this.activeIndex = sentenceIndex;
    if (sentenceIndex < 0) return;

    const el = this.container?.querySelector(`[data-sentence="${sentenceIndex}"]`);
    if (!el) return;

    el.classList.add('sentence-active');
    if (scroll) this._centre(el);

    this.onSentenceChange?.(sentenceIndex, el);
  }

  /**
   * Centre the active sentence.
   *
   * Deliberately scrolls only the reader container, never the page, and only
   * when the user has not just scrolled themselves — otherwise follow mode
   * fights you for control of the viewport.
   */
  _centre(el) {
    if (!this.container) return;
    if (Date.now() - this._userScrolledAt < 2000) return;

    const box = this.container.getBoundingClientRect();
    const target = el.getBoundingClientRect();
    const delta = (target.top + target.height / 2) - (box.top + box.height / 2);

    this._programmaticScroll = true;
    this.container.scrollBy({ top: delta, behavior: 'smooth' });
    setTimeout(() => { this._programmaticScroll = false; }, 400);
  }

  _onScroll() {
    // Distinguish our own smooth-scroll from a real gesture, so centring does
    // not permanently disable itself.
    if (this._programmaticScroll) return;
    this._userScrolledAt = Date.now();
  }

  // -------------------------------------------------------------------------
  // Follow mode
  // -------------------------------------------------------------------------

  setFollowMode(enabled) {
    this.followMode = enabled;
    if (enabled && this.activeIndex >= 0) {
      this._userScrolledAt = 0; // an explicit opt-in should snap immediately
      const el = this.container?.querySelector(`[data-sentence="${this.activeIndex}"]`);
      if (el) this._centre(el);
    }
    return this.followMode;
  }

  // -------------------------------------------------------------------------
  // Playback loop
  // -------------------------------------------------------------------------

  start() {
    if (this._rafId || !this.syncable) return;
    this._rafId = requestAnimationFrame(this._tick);
  }

  stop() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
    this.container?.removeEventListener('scroll', this._onScroll);
  }

  _tick() {
    const audio = this.audio;
    if (!audio || !audio.src) {
      this._rafId = requestAnimationFrame(this._tick);
      return;
    }

    const t = audio.currentTime;

    // Only recompute when the clock actually moved a meaningful amount.
    if (Math.abs(t - this._lastTime) > 0.03) {
      this._lastTime = t;
      const idx = this.indexAtTime(t);
      if (idx >= 0) {
        this.setActive(this.sentences[idx].i, { scroll: this.followMode });
      }
    }

    this._rafId = requestAnimationFrame(this._tick);
  }
}

/**
 * Render text as clickable sentences.
 *
 * Splitting MUST mirror the server's `splitSentences`, or sentence 42 in the
 * browser is not sentence 42 in the alignment map and every highlight is off by
 * a little. Same rule: split after . ! ? or the Hindi danda (।).
 */
export function renderSentences(text, { escape }) {
  if (!text) return '';

  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());
  let sentenceIndex = 0;

  return paragraphs.map((para, paraIndex) => {
    const parts = para.trim().split(/(?<=[.!?\u0964])\s+/).filter((s) => s.trim());

    const spans = parts.map((sentence) => {
      const i = sentenceIndex++;
      return `<span class="sentence" data-sentence="${i}" role="button" tabindex="0" ` +
             `aria-label="Jump to this sentence">${escape(sentence.trim())}</span>`;
    }).join(' ');

    return `<p class="reader-para" data-para-index="${paraIndex}">${spans}</p>`;
  }).join('');
}
