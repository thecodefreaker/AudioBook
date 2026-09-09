/**
 * Groq rate limiting — modelled directly on the published Groq rate-limit docs.
 *
 * The docs define FOUR independent dimensions that can each trip first:
 *
 *   RPM  requests per minute      TPM  tokens per minute
 *   RPD  requests per day         TPD  tokens per day
 *
 * ...and expose live state through response headers:
 *
 *   x-ratelimit-limit-requests / -remaining-requests / -reset-requests   (RPD)
 *   x-ratelimit-limit-tokens   / -remaining-tokens   / -reset-tokens     (TPM)
 *   retry-after                                          (429 responses only)
 *
 * DESIGN RULES (each maps to a statement in the docs):
 *
 *  1. Headers are the source of truth. Local accounting only bridges the gap
 *     between responses and paces the very first request.
 *  2. Reset headers are DURATIONS ("7.66s", "2m59.56s"). They mean "full budget
 *     returns at now + d". We schedule to that instant instead of assuming a
 *     linear drip, because a linear drip hands out tokens Groq has not released
 *     yet and immediately re-trips the limit.
 *  3. `retry-after` outranks every local calculation. We never retry sooner.
 *  4. Reserve the CEILING (prompt + max_tokens), refund the remainder once the
 *     provider reports real usage. Reserving less than a request may consume is
 *     how you breach TPM.
 *  5. Limits are per-organisation AND per-model, so buckets are keyed by model.
 *     Switching models cannot dodge an org cap, but it does get a different TPM.
 */
import { EventEmitter } from 'events';

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

/** Realtime channel so the UI can show WHY it is waiting, not just that it is. */
export const limiterEvents = new EventEmitter();
limiterEvents.setMaxListeners(50);

// ---------------------------------------------------------------------------
// Header parsing
// ---------------------------------------------------------------------------

/**
 * Groq returns durations like "7.66s", "2m59.56s", "1h2m3s", "500ms".
 * @returns {number} milliseconds, or 0 if unparseable.
 */
export function parseDuration(value) {
  if (value === null || value === undefined) return 0;
  const str = String(value).trim();
  if (!str) return 0;

  // Bare number = seconds (this is what `retry-after` uses).
  if (/^\d+(\.\d+)?$/.test(str)) return parseFloat(str) * 1000;

  const re = /(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)/gi;
  let match;
  let total = 0;
  let found = false;
  while ((match = re.exec(str)) !== null) {
    found = true;
    const n = parseFloat(match[1]);
    switch (match[2].toLowerCase()) {
      case 'ms': total += n; break;
      case 's': total += n * 1000; break;
      case 'm': total += n * 60000; break;
      case 'h': total += n * 3600000; break;
      case 'd': total += n * 86400000; break;
    }
  }
  return found ? total : 0;
}

/**
 * Read a header from any shape the SDK might hand us: a `Headers` instance, a
 * plain object, or a Node-style lowercase map.
 *
 * The previous code did `err.headers['retry-after']` — which is always
 * `undefined` on a `Headers` object, so the authoritative retry delay was being
 * silently discarded on every single 429.
 */
export function readHeader(headers, name) {
  if (!headers) return null;
  const key = name.toLowerCase();
  if (typeof headers.get === 'function') {
    const v = headers.get(key);
    if (v !== null && v !== undefined) return v;
  }
  if (typeof headers === 'object') {
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === key) return headers[k];
    }
  }
  return null;
}

const toInt = (v) => {
  if (v === null || v === undefined) return undefined;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : undefined;
};

/** Extract the full rate-limit picture from a response (success OR error). */
export function extractRateLimitHeaders(headers) {
  if (!headers) return null;
  const retryAfterMsHeader = readHeader(headers, 'retry-after-ms');
  const out = {
    limitRequests: toInt(readHeader(headers, 'x-ratelimit-limit-requests')),
    limitTokens: toInt(readHeader(headers, 'x-ratelimit-limit-tokens')),
    remainingRequests: toInt(readHeader(headers, 'x-ratelimit-remaining-requests')),
    remainingTokens: toInt(readHeader(headers, 'x-ratelimit-remaining-tokens')),
    resetRequestsMs: parseDuration(readHeader(headers, 'x-ratelimit-reset-requests')),
    resetTokensMs: parseDuration(readHeader(headers, 'x-ratelimit-reset-tokens')),
    retryAfterMs: retryAfterMsHeader
      ? Number(retryAfterMsHeader) || 0
      : parseDuration(readHeader(headers, 'retry-after')),
    /**
     * Separate input/output per-minute budgets (ITPM/OTPM).
     *
     * The docs say only SOME organisations have these, and that the only way
     * to check is hovering the TPM value on the Limits page — i.e. it cannot be
     * read from documentation. Probed live on 2026-08-11
     * (scratch/probe-itpm-otpm.mjs): this account returns NO input/output
     * headers at all and behaves as a single combined TPM bucket.
     *
     * We still parse them, because an account upgrade would silently introduce
     * them and a limiter that models only combined TPM would then breach OTPM
     * while believing it had headroom. If these ever appear, `applyHeaders`
     * emits a loud warning rather than quietly mis-pacing.
     */
    limitInputTokens: toInt(readHeader(headers, 'x-ratelimit-limit-input-tokens')),
    limitOutputTokens: toInt(readHeader(headers, 'x-ratelimit-limit-output-tokens')),
    remainingInputTokens: toInt(readHeader(headers, 'x-ratelimit-remaining-input-tokens')),
    remainingOutputTokens: toInt(readHeader(headers, 'x-ratelimit-remaining-output-tokens')),
  };
  const hasAny = Object.values(out).some((v) => v !== undefined && v !== 0);
  return hasAny ? out : null;
}

// ---------------------------------------------------------------------------
// A single rate-limited dimension
// ---------------------------------------------------------------------------

/**
 * One window (e.g. TPM). Refills to `limit` at `resetAt`, and in the meantime
 * drips linearly as a fallback so we are not frozen when the server never
 * sends reset headers.
 */
class Window {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.remaining = limit;
    this.lastRefill = Date.now();
    /** Absolute time at which the server says the budget is whole again. */
    this.resetAt = 0;
    /** True once a real header has been seen — before that we are guessing. */
    this.authoritative = false;
  }

  setLimit(limit) {
    if (!Number.isFinite(limit) || limit <= 0) return false;
    const previous = this.limit;
    if (previous === limit) return false;
    this.limit = limit;
    if (limit > previous && Number.isFinite(previous)) {
      // The limit went UP — grant the extra headroom immediately.
      //
      // Without this, discovering that the account is really 12 000 TPM (when
      // we had assumed 6 000) raised the ceiling but left `remaining` pinned at
      // the old value, so we kept throttling at half the true rate until the
      // window happened to reset. Verified against live Groq headers.
      this.remaining += (limit - previous);
    }
    this.remaining = Math.max(0, Math.min(this.remaining, limit));
    return true;
  }

  /** Trust the server's remaining count and its reset instant. */
  sync(remaining, resetMs) {
    if (Number.isFinite(remaining)) {
      this.remaining = Math.max(0, Math.min(this.limit, remaining));
      this.authoritative = true;
    }
    if (Number.isFinite(resetMs) && resetMs > 0) {
      this.resetAt = Date.now() + resetMs;
    }
    this.lastRefill = Date.now();
  }

  refill(now = Date.now()) {
    // The server told us exactly when the window resets — honour it.
    if (this.resetAt && now >= this.resetAt) {
      this.remaining = this.limit;
      this.resetAt = 0;
      this.lastRefill = now;
      return;
    }
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    this.lastRefill = now;
    if (!Number.isFinite(this.limit)) return;

    /**
     * Drip continuously, EVEN WHILE A RESET IS PENDING.
     *
     * This used to `return` early whenever `resetAt` was set, on the reasoning
     * that we should not "invent budget early". But Groq's token bucket refills
     * continuously — `x-ratelimit-reset-tokens` is when the budget is FULL
     * again, not the first moment any budget exists. Refusing to drip until
     * then modelled the window as all-or-nothing and kept `remaining` pinned at
     * its lowest value for the entire window, which is what made `waitFor`
     * compute shortfalls that did not really exist.
     *
     * Dripping is capped by the true remaining time to reset, so we can never
     * credit more than the window will actually have refilled by `now`.
     */
    this.remaining = Math.min(this.limit, this.remaining + (this.limit * elapsed) / this.windowMs);
  }

  /** How long until `cost` units are available, in ms. */
  waitFor(cost, now = Date.now()) {
    if (!Number.isFinite(this.limit)) return 0;
    if (this.remaining >= cost) return 0;
    if (cost > this.limit) return Infinity;

    /**
     * Wait for the SHORTFALL, not for the whole window.
     *
     * This line used to be:
     *     if (this.resetAt && this.resetAt > now) return this.resetAt - now;
     * which slept until the next reset instant for ANY deficit — one token or
     * one thousand, the same full-window sleep. Since Groq sends a reset header
     * on every response, that branch was always taken and the drip calculation
     * below was unreachable.
     *
     * That is the origin of the 30-40 second freezes users saw mid-chapter.
     * Measured (PROBE-10, offline and deterministic) against a real window
     * state of 7941/12000 remaining with a 20.3s reset:
     *
     *     shortfall        old wait    correct wait
     *         1 token        20.3s         0.0s
     *       100 tokens       20.3s         0.5s
     *      1000 tokens       20.3s         5.0s
     *
     * Groq's own budget refills continuously, so waiting for just the missing
     * tokens is both correct and far cheaper. The reset instant is still
     * honoured as an UPPER BOUND: never claim a wait longer than the moment the
     * window is whole again, because at that point the full limit is available.
     */
    const deficit = cost - this.remaining;
    const dripMs = Math.ceil((deficit / this.limit) * this.windowMs);
    if (this.resetAt && this.resetAt > now) {
      return Math.min(dripMs, this.resetAt - now);
    }
    return dripMs;
  }

  spend(cost) { this.remaining = Math.max(0, this.remaining - cost); }
  refund(cost) { this.remaining = Math.min(this.limit, this.remaining + cost); }
}

// ---------------------------------------------------------------------------
// The per-model limiter
// ---------------------------------------------------------------------------

const MINUTE = 60_000;
const DAY = 86_400_000;

/** Tuning for the learned reservation ratio (see `observe`/`effectiveCost`). */
const RATIO_MIN_SAMPLES = 3;   // reserve the full ceiling until we have evidence
const RATIO_ALPHA = 0.3;       // EWMA weight for each new observation
const RATIO_MARGIN = 1.15;     // 15% safety margin on top of what we observed
const RATIO_FLOOR = 0.45;      // never discount a reservation below this

/**
 * A 429 is only treated as fatal if Groq asks us to wait longer than this.
 * Below it we simply pause and continue — verified necessary, because Groq
 * reports TPD exhaustion with a ~20 SECOND retry-after, not a 24-hour one.
 */
const DAILY_TERMINAL_THRESHOLD_MS = 15 * 60 * 1000;

export class ModelRateLimiter {
  constructor(model, limits = {}) {
    this.model = model;
    this.tpm = new Window(limits.tokensPerMinute ?? 6000, MINUTE);
    this.rpm = new Window(limits.requestsPerMinute ?? 30, MINUTE);
    this.tpd = new Window(limits.tokensPerDay ?? Infinity, DAY);
    this.rpd = new Window(limits.requestsPerDay ?? Infinity, DAY);

    /** Hard stop imposed by a 429 `retry-after`. Nothing runs before this. */
    this.blockedUntil = 0;
    this.blockedReason = null;

    this.queue = [];
    this.draining = false;
    this.seq = 0;

    /** Observability counters — see `stats()`. */
    this.metrics = {
      requests: 0, rateLimited: 0, payloadTooLarge: 0,
      totalWaitMs: 0, tokensReserved: 0, tokensActual: 0,
      refundedReservations: 0,
    };

    /**
     * Learned ratio of ACTUAL spend to the ceiling we reserve.
     *
     * Reserving the worst case is correct for safety but costs throughput:
     * measured against live Groq traffic we reserved 1.45x what we spent, which
     * let only ONE chunk through per minute on a 12 000 TPM account where four
     * would have fit. Rather than choose between "safe" and "fast", we reserve
     * the ceiling until we have evidence, then shrink the reservation toward
     * what this model+prompt actually costs — while still refunding to exact
     * usage afterwards, so an under-estimate self-corrects within one request.
     */
    this.observedRatio = null;
    this.observedSamples = 0;
  }

  /**
   * Seed the learned ratio from a measured value so it works on request ONE.
   *
   * The EWMA above needs `RATIO_MIN_SAMPLES` observations before it discounts
   * anything. That was harmless with a single bucket, but buckets are keyed
   * `keyId::model` — with 4 keys x 7 models there are ~30 of them, each needing
   * its own 3 samples. A typical chapter is 4 requests spread across lanes, so
   * in practice the discount NEVER engaged and every request reserved the full
   * worst case forever. Seeding from `KNOWN_MODEL_LIMITS.measuredOutputRatio`
   * means a cold bucket starts from evidence instead of from pessimism, and the
   * EWMA then refines it from live traffic as usual.
   */
  seedRatio(sample, samples = RATIO_MIN_SAMPLES) {
    if (!(sample > 0) || this.observedSamples > 0) return;
    this.observedRatio = Math.min(1, sample);
    this.observedSamples = samples;
  }

  /**
   * Discount a ceiling estimate using observed history.
   * Stays at 1.0 (full worst-case reserve) until enough samples exist, and
   * never discounts below a safety floor.
   */
  effectiveCost(ceiling) {
    if (this.observedSamples < RATIO_MIN_SAMPLES || !this.observedRatio) return ceiling;
    const ratio = Math.max(RATIO_FLOOR, Math.min(1, this.observedRatio * RATIO_MARGIN));
    return Math.max(1, Math.ceil(ceiling * ratio));
  }

  /** Feed a completed request back into the learned ratio (EWMA). */
  observe(ceiling, actual) {
    if (!(ceiling > 0) || !(actual > 0)) return;
    const sample = Math.min(1, actual / ceiling);
    this.observedRatio = this.observedRatio === null
      ? sample
      : this.observedRatio * (1 - RATIO_ALPHA) + sample * RATIO_ALPHA;
    this.observedSamples++;
  }

  // -- configuration -------------------------------------------------------

  configure({ tokensPerMinute, requestsPerMinute, tokensPerDay, requestsPerDay } = {}) {
    const changes = [];
    if (this.tpm.setLimit(tokensPerMinute)) changes.push(`TPM→${tokensPerMinute}`);
    if (this.rpm.setLimit(requestsPerMinute)) changes.push(`RPM→${requestsPerMinute}`);
    if (this.tpd.setLimit(tokensPerDay)) changes.push(`TPD→${tokensPerDay}`);
    if (this.rpd.setLimit(requestsPerDay)) changes.push(`RPD→${requestsPerDay}`);
    if (changes.length) {
      limiterEvents.emit('limits', { model: this.model, changes });
    }
    return changes;
  }

  /**
   * Apply everything a response told us.
   *
   * Per the docs, `x-ratelimit-*-requests` describes the DAILY request budget
   * and `x-ratelimit-*-tokens` the per-minute token budget — so they are routed
   * to different windows. Getting this backwards (treating request headers as
   * RPM) makes the limiter think it has 14 400 requests per minute.
   */
  applyHeaders(headers) {
    const h = extractRateLimitHeaders(headers);
    if (!h) return null;

    this.configure({
      tokensPerMinute: h.limitTokens,
      requestsPerDay: h.limitRequests,
    });

    this.tpm.sync(h.remainingTokens, h.resetTokensMs);
    this.rpd.sync(h.remainingRequests, h.resetRequestsMs);

    // Split input/output budgets would invalidate our whole pacing model: we
    // reserve and refund against ONE combined bucket, so an OTPM cap could be
    // exhausted while `remainingTokens` still looked healthy. Measured absent
    // on this account, but surface it loudly if that ever changes rather than
    // silently mis-pacing.
    if (!this.warnedSplitLimits
        && (h.limitInputTokens !== undefined || h.limitOutputTokens !== undefined)) {
      this.warnedSplitLimits = true;
      limiterEvents.emit('split-limits', {
        model: this.model,
        limitInputTokens: h.limitInputTokens,
        limitOutputTokens: h.limitOutputTokens,
      });
      limiterEvents.emit('limits', {
        model: this.model,
        changes: [
          `ITPM/OTPM detected (in=${h.limitInputTokens ?? '?'} out=${h.limitOutputTokens ?? '?'}). ` +
          'This limiter models a single combined TPM bucket and will UNDER-COUNT output pressure.',
        ],
      });
    }

    // A near-empty daily budget is worth surfacing loudly: unlike TPM it will
    // not come back in a minute.
    if (Number.isFinite(h.remainingRequests) && Number.isFinite(h.limitRequests)
        && h.limitRequests > 0 && h.remainingRequests / h.limitRequests < 0.05) {
      limiterEvents.emit('daily-low', {
        model: this.model, remaining: h.remainingRequests,
        limit: h.limitRequests, resetInMs: h.resetRequestsMs,
      });
    }

    this.drain();
    return h;
  }

  /**
   * True up an unobservable window (TPD/RPM) from a 429 body.
   *
   * Headers never report these, so without this the daily TOKEN budget is
   * invisible right up until it fails.
   */
  applyLimitState(state) {
    if (!state) return null;
    const win = this[state.dimension];
    if (!win) return null;
    win.setLimit(state.limit);
    win.remaining = Math.max(0, state.limit - state.used);
    win.authoritative = true;
    win.lastRefill = Date.now();
    limiterEvents.emit('limits', {
      model: this.model,
      changes: [`${state.dimension.toUpperCase()} discovered: ${win.remaining}/${state.limit} left`],
    });
    return win;
  }

  /** A real 429. Stop everything until the provider says we may resume. */

  penalise(retryAfterMs, reason = 'rate_limit') {
    const ms = Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : 10_000;
    this.blockedUntil = Math.max(this.blockedUntil, Date.now() + ms);
    this.blockedReason = reason;
    this.metrics.rateLimited++;
    // Assume the minute budget is gone; the next response's headers will
    // correct us if we are being pessimistic.
    this.tpm.remaining = 0;
    this.tpm.resetAt = this.blockedUntil;
    limiterEvents.emit('blocked', {
      model: this.model, untilMs: this.blockedUntil, reason, waitMs: ms,
    });
  }

  // -- acquisition ---------------------------------------------------------

  /**
   * Reserve budget for one request.
   *
   * @param {object} opts
   * @param {number} opts.tokens  CEILING cost (prompt + max_tokens)
   * @param {(info:{waitMs:number,reason:string})=>void} [opts.onWait]
   * @param {()=>void} [opts.onProgress] throw from here to cancel
   * @param {AbortSignal} [opts.signal]
   * @returns {Promise<{cost:number, settle:(actual:number)=>void}>}
   */
  acquire({ tokens, onWait, onProgress, signal }) {
    const ceiling = Math.max(1, Math.ceil(tokens));
    // Reserve the worst case at first; once we have measured this model's real
    // appetite, reserve a (still-padded) realistic amount so we stop starving
    // ourselves of throughput we are entitled to.
    const cost = this.effectiveCost(ceiling);

    // A chunk that cannot EVER fit is a caller bug, not something to wait out.
    // The old code silently clamped the cost to TPM, which guaranteed a 413.
    // NOTE: judged on the CEILING, because that is what may actually be sent.
    if (ceiling > this.tpm.limit) {
      return Promise.reject(Object.assign(
        new Error(
          `A single request needs ~${ceiling} tokens but the ${this.model} limit is ` +
          `${this.tpm.limit} TPM. The chunk must be split before it is sent.`
        ),
        { code: 'CHUNK_TOO_LARGE', cost: ceiling, limit: this.tpm.limit }
      ));
    }

    return new Promise((resolve, reject) => {
      const entry = {
        id: ++this.seq, cost, ceiling, resolve, reject, onWait, onProgress, signal,
        notified: false, enqueuedAt: Date.now(),
      };
      if (signal) {
        if (signal.aborted) return reject(Object.assign(new Error('Cancelled'), { code: 'CANCELLED' }));
        signal.addEventListener('abort', () => { entry.aborted = true; this.drain(); }, { once: true });
      }
      this.queue.push(entry);
      this.emitQueue();
      this.drain();
    });
  }

  /** Why can't `entry` run right now, and for how long? */
  assess(entry, now) {
    if (this.blockedUntil > now) {
      return { waitMs: this.blockedUntil - now, reason: this.blockedReason || 'rate_limit' };
    }
    const checks = [
      [this.tpm.waitFor(entry.cost, now), 'tokens_per_minute'],
      [this.rpm.waitFor(1, now), 'requests_per_minute'],
      [this.tpd.waitFor(entry.cost, now), 'tokens_per_day'],
      [this.rpd.waitFor(1, now), 'requests_per_day'],
    ];
    let waitMs = 0;
    let reason = null;
    for (const [w, r] of checks) {
      if (w > waitMs) { waitMs = w; reason = r; }
    }
    return { waitMs, reason };
  }

  async drain() {
    if (this.draining) return;
    this.draining = true;

    try {
      while (this.queue.length > 0) {
        const now = Date.now();
        this.tpm.refill(now); this.rpm.refill(now);
        this.tpd.refill(now); this.rpd.refill(now);

        // Drop anything that was cancelled while queued.
        for (let i = this.queue.length - 1; i >= 0; i--) {
          const e = this.queue[i];
          if (e.aborted || e.signal?.aborted) {
            this.queue.splice(i, 1);
            e.reject(Object.assign(new Error('Cancelled'), { code: 'CANCELLED' }));
          }
        }
        if (!this.queue.length) break;

        // NOT strictly FIFO: scan for any waiter that fits right now.
        //
        // The old loop only ever looked at queue[0], so one large chunk stalled
        // every small chunk behind it for a full minute even when there was
        // ample budget — which serialised the entire pipeline whenever more
        // than one chapter was in flight.
        let ranSomething = false;
        const headStarving = Date.now() - this.queue[0].enqueuedAt > 20_000;
        const scanLimit = headStarving ? 1 : this.queue.length;
        for (let i = 0; i < scanLimit; i++) {
          const e = this.queue[i];
          const { waitMs } = this.assess(e, Date.now());
          if (waitMs === 0) {
            this.queue.splice(i, 1);
            this.charge(e.cost);
            e.resolve(this.makeReservation(e.cost, e.ceiling));
            ranSomething = true;
            break;
          }
        }
        if (ranSomething) { this.emitQueue(); continue; }

        // Nothing can run. Sleep until the earliest waiter is viable.
        const head = this.queue[0];
        const { waitMs, reason } = this.assess(head, Date.now());
        if (!head.notified || Date.now() - (head.lastNotify || 0) > 5000) {
          head.notified = true;
          head.lastNotify = Date.now();
          head.onWait?.({ waitMs, reason, cost: head.cost, model: this.model });
          limiterEvents.emit('waiting', {
            model: this.model, waitMs, reason, cost: head.cost, queued: this.queue.length,
          });
        }

        const slice = Math.min(waitMs, 1000);
        this.metrics.totalWaitMs += slice;
        try {
          head.onProgress?.();
        } catch (err) {
          this.queue.shift();
          head.reject(err);
          continue;
        }
        await sleep(slice);
      }
    } finally {
      this.draining = false;
      this.emitQueue();
    }
  }

  charge(cost) {
    this.tpm.spend(cost); this.tpd.spend(cost);
    this.rpm.spend(1); this.rpd.spend(1);
    this.metrics.requests++;
    this.metrics.tokensReserved += cost;
  }

  /**
   * A reservation must ALWAYS be settled, which is why it is an object with a
   * `settle()` the caller can put in a `finally`.
   *
   * Previously the reservation was only reconciled on the success path, so
   * every network error, 500 and abort permanently leaked its full estimate out
   * of the bucket. Over a long book the limiter throttled harder and harder for
   * no reason, and nothing in the logs explained why.
   */
  makeReservation(cost, ceiling = cost) {
    let settled = false;
    return {
      cost,
      settle: (actualTokens) => {
        if (settled) return;
        settled = true;
        const actual = Number.isFinite(actualTokens) && actualTokens > 0 ? actualTokens : 0;
        if (actual === 0) this.metrics.refundedReservations++;
        else {
          this.metrics.tokensActual += actual;
          // Learn how much of the ceiling this model really uses, so future
          // reservations are tighter without ever risking an overspend.
          this.observe(ceiling, actual);
        }

        const delta = cost - actual; // >0 → refund, <0 → we under-estimated
        if (delta !== 0) {
          this.tpm.refill(); this.tpd.refill();
          if (delta > 0) {
            this.tpm.refund(delta); this.tpd.refund(delta);
            this.drain(); // a refund may unblock a waiter
          } else {
            this.tpm.spend(-delta); this.tpd.spend(-delta);
          }
        }
      },
    };
  }

  // -- observability -------------------------------------------------------

  snapshot() {
    const now = Date.now();
    this.tpm.refill(now); this.rpm.refill(now);
    this.tpd.refill(now); this.rpd.refill(now);

    const win = (w) => ({
      remaining: Number.isFinite(w.remaining) ? Math.floor(w.remaining) : null,
      limit: Number.isFinite(w.limit) ? w.limit : null,
      resetInMs: w.resetAt ? Math.max(0, w.resetAt - now) : null,
      authoritative: w.authoritative,
    });

    return {
      model: this.model,
      tpm: win(this.tpm),
      rpm: win(this.rpm),
      tpd: win(this.tpd),
      rpd: win(this.rpd),
      queued: this.queue.length,
      blocked: this.blockedUntil > now,
      blockedForMs: Math.max(0, this.blockedUntil - now),
      blockedReason: this.blockedUntil > now ? this.blockedReason : null,
      metrics: this.stats(),
    };
  }

  stats() {
    const m = this.metrics;
    return {
      ...m,
      /** >1 means we routinely reserve more than we spend (safe but wasteful). */
      estimateRatio: m.tokensActual > 0
        ? +(m.tokensReserved / m.tokensActual).toFixed(2)
        : null,
      /** Learned fraction of the ceiling actually consumed. */
      observedRatio: this.observedRatio !== null ? +this.observedRatio.toFixed(3) : null,
      observedSamples: this.observedSamples,
    };
  }

  emitQueue() {
    limiterEvents.emit('queue', { model: this.model, queued: this.queue.length });
  }
}

// ---------------------------------------------------------------------------
// Registry — one limiter per model, because limits differ per model
// ---------------------------------------------------------------------------

/**
 * Free-tier limits, CONFIRMED against the live API on 2026-08-11
 * (scratch/probe-all-models.mjs — every value matched the response headers).
 *
 * These are PER MODEL, not per account. Verified by spending on one model and
 * observing that another model's `x-ratelimit-remaining-tokens` did not move.
 * That is the entire basis for rotation: the buckets are independent.
 *
 * `devanagariOk` records whether the model actually produced usable Hinglish
 * Devanagari for a realistic chapter chunk. Quota is worthless if the output
 * cannot be spoken by a hi-IN voice, so the router MUST consult this.
 * See scratch/probe-devanagari-eligibility.mjs and docs/09_MODEL_ROTATION_MEASURED.md.
 * `measuredOutputRatio` is completion tokens ÷ CHUNK TEXT tokens, measured on
 * REAL chapter-sized chunks (scratch/probe-3-true-ratio.mjs, 2026-08-11). The
 * earlier values here were taken from short probe strings, where the fixed
 * prompt preamble dominates and inflates the apparent ratio — they read high
 * and made us reserve roughly double what we spend. Chapter-length text
 * amortises that overhead and the true ratio drops well below 1.0.
 *
 * CAVEAT (2026-08-12): a ratio is only valid for the PROMPT it was measured
 * under. These were measured under a prompt that permitted summarising. The
 * current prompt carries an explicit length target, so the model emits roughly
 * twice as much. Any model re-measured under the new prompt is marked below;
 * the rest are still carrying pre-length-target numbers and will under-reserve
 * (symptom: finish_reason=length + a repair retry). Re-probe before trusting.
 */
export const KNOWN_MODEL_LIMITS = {
  'llama-3.1-8b-instant': {
    requestsPerMinute: 30, requestsPerDay: 14400, tokensPerMinute: 6000, tokensPerDay: 500000,
    // Measured mean 1.76x on real chapters — genuinely the most verbose model,
    // and the only one that ran above 1.0. Kept high deliberately.
    devanagariOk: true, measuredOutputRatio: 1.76, promptOverheadFactor: 1,
  },
  'llama-3.3-70b-versatile': {
    requestsPerMinute: 30, requestsPerDay: 1000, tokensPerMinute: 12000, tokensPerDay: 100000,
    // RE-MEASURED 2026-08-12 (scratch/probe-16-output-ratio.mjs) under the NEW
    // length-target prompt. The old 0.95 was measured under the previous prompt,
    // which let the model SUMMARISE — it under-reported what a real retelling
    // costs. With an explicit "match the source length" instruction the model
    // emits far more: mean 1.59x, max 1.89x with finish_reason=stop.
    // 2.08 = max observed + ~10% headroom. Erring high is free (the reservation
    // is refunded to actual usage on response); erring low cost us a truncated
    // chapter plus a whole extra billed repair request.
    devanagariOk: true, measuredOutputRatio: 2.08, promptOverheadFactor: 1,
  },
  'openai/gpt-oss-120b': {
    requestsPerMinute: 30, requestsPerDay: 1000, tokensPerMinute: 8000, tokensPerDay: 200000,
    // Measured mean 0.91x, max 1.02x (n=4) — tightly clustered, so 1.0 is safe.
    devanagariOk: true, measuredOutputRatio: 1.0, promptOverheadFactor: 1,
    // Reasoning-capable. Measured: 'low' cut completion tokens 388 → 384 with
    // no quality loss, so it is free headroom. See `REASONING_PARAMS`.
    reasoning: { reasoning_effort: 'low' },
  },
  // Agentic SYSTEM, not a plain model: it wraps the prompt in tool scaffolding,
  // so a ~1000-token prompt was billed at 5328 tokens. Huge TPM, tiny RPD —
  // a bulk lane for LARGE chunks only. It has no documented TPD.
  'groq/compound': {
    requestsPerMinute: 30, requestsPerDay: 250, tokensPerMinute: 70000,
    devanagariOk: true, measuredOutputRatio: 0.51, promptOverheadFactor: 5.5,
  },
  'groq/compound-mini': {
    requestsPerMinute: 30, requestsPerDay: 250, tokensPerMinute: 70000,
    devanagariOk: null, measuredOutputRatio: 0.51, promptOverheadFactor: 5.5,
  },

  // ---- RESCUED 2026-08-11 (scratch/probe-reasoning-rescue.mjs) ------------
  // These two were excluded on real evidence, but the evidence measured OUR
  // REQUEST, not the model. Both failures had one cause: the model spent its
  // whole `max_completion_tokens` budget on hidden reasoning and had nothing
  // left for the retelling. The Groq API reference documents the control for
  // exactly this (`reasoning_effort`), and we were sending neither it nor
  // `reasoning_format`.
  //
  // Re-probed with the correct parameter and both now produce clean, fully
  // Devanagari output — and do it CHEAPER than the models we kept:
  //
  //   gpt-oss-20b  baseline 1184 completion tokens → 264 with effort:'low'
  //                (4.5x cheaper, same quality, no truncation)
  //   qwen3.6-27b  baseline leaked <think> as 3814 chars and hit the length
  //                cap → 435 tokens, clean, finish_reason=stop with 'none'
  //
  // CRITICAL: the accepted values DIFFER PER MODEL and a wrong one is a hard
  // 400, not a warning — so they are recorded per model rather than guessed.
  //   gpt-oss-*   → 'low' | 'medium' | 'high'   ('none' is rejected)
  //   qwen3.6     → 'none' | 'default'          ('low' is rejected)
  //   llama-3.3   → rejects the parameter entirely
  'openai/gpt-oss-20b': {
    requestsPerMinute: 30, requestsPerDay: 1000, tokensPerMinute: 8000, tokensPerDay: 200000,
    devanagariOk: true, measuredOutputRatio: 0.35, promptOverheadFactor: 1,
    reasoning: { reasoning_effort: 'low' },
    rescuedNote: "Was excluded for returning no visible text; reasoning_effort:'low' fixed it (1184→264 output tokens).",
  },
  'qwen/qwen3.6-27b': {
    requestsPerMinute: 30, requestsPerDay: 1000, tokensPerMinute: 8000, tokensPerDay: 200000,
    devanagariOk: true, measuredOutputRatio: 0.6, promptOverheadFactor: 1,
    reasoning: { reasoning_effort: 'none' },
    rescuedNote: "Was excluded for leaking <think> chain-of-thought; reasoning_effort:'none' fixed it.",
  },
  'qwen/qwen3.8-27b': {
    requestsPerMinute: 30, requestsPerDay: 1000, tokensPerMinute: 8000, tokensPerDay: 200000,
    devanagariOk: true, measuredOutputRatio: 0.6, promptOverheadFactor: 1,
    reasoning: { reasoning_effort: 'none' },
    rescuedNote: "Qwen 3.8 reasoning control: reasoning_effort:'none'.",
  },

  // ---- Excluded from rotation (measured, not assumed) --------------------
  'openai/gpt-oss-safeguard-20b': {
    requestsPerMinute: 30, requestsPerDay: 1000, tokensPerMinute: 8000, tokensPerDay: 200000,
    devanagariOk: false, excludedReason: 'Content-moderation model, not a storyteller',
  },
  'meta-llama/llama-prompt-guard-2-22m': {
    requestsPerMinute: 30, requestsPerDay: 1000, tokensPerMinute: 8000,
    devanagariOk: false, excludedReason: 'Prompt guard moderation model, not a storyteller',
  },
  'meta-llama/llama-prompt-guard-2-86m': {
    requestsPerMinute: 30, requestsPerDay: 1000, tokensPerMinute: 8000,
    devanagariOk: false, excludedReason: 'Prompt guard moderation model, not a storyteller',
  },
  'allam-2-7b': {
    requestsPerMinute: 30, requestsPerDay: 1000, tokensPerMinute: 6000,
    devanagariOk: false, excludedReason: 'Arabic language model, not suitable for Hindi/Devanagari retelling',
  },
};

/**
 * Extra request fields for a model, or `{}` if it takes none.
 *
 * Sending `reasoning_effort` to a model that does not support it is a hard 400
 * ("`reasoning_effort` is not supported with this model" — measured on
 * llama-3.3-70b-versatile), and sending the WRONG VALUE is also a 400 with a
 * different message per family. So this must never be a global default; it is
 * looked up per model or omitted entirely.
 */
export function reasoningParamsFor(model) {
  return KNOWN_MODEL_LIMITS[model]?.reasoning || {};
}

const DEFAULT_LIMITS = { requestsPerMinute: 30, requestsPerDay: 1000, tokensPerMinute: 6000, tokensPerDay: 100000 };

const limiters = new Map();
/**
 * Settings overrides, keyed by model id. `*` holds legacy global values.
 *
 * A global override must NEVER clobber a known per-model limit: the Settings
 * defaults are `tokensPerMinute: 6000, requestsPerMinute: 30`, and spreading
 * those over every model capped `groq/compound` at 6 000 TPM instead of 70 000
 * and `llama-3.3-70b-versatile` at 6 000 instead of 12 000 — silently throwing
 * away most of the quota that rotation exists to unlock.
 */
let userOverrides = { '*': {} };

/** Overrides that apply to `model`: model-specific first, else legacy global. */
function overridesFor(model) {
  const specific = userOverrides[model];
  if (specific && Object.keys(specific).length) return specific;
  const global = userOverrides['*'] || {};
  // A global setting is only honoured where we have no measured value, so it
  // can raise an unknown model but can never lower a confirmed one.
  if (KNOWN_MODEL_LIMITS[model]) {
    const safe = {};
    for (const [k, v] of Object.entries(global)) {
      if (!(k in KNOWN_MODEL_LIMITS[model])) safe[k] = v;
    }
    return safe;
  }
  return global;
}

/**
 * One limiter per (KEY, MODEL) pair.
 *
 * The Groq docs say limits "apply at the organization level", and the limit
 * tables are per model — so the quota bucket is the CROSS PRODUCT of the two.
 * Keying only on model was correct while there was one key; with a pool it
 * silently merged independent buckets, so a key with a full budget inherited
 * the throttling of a key that had just been rate-limited.
 *
 * `keyId` is the non-secret lane id from keyPool (never the key itself), and
 * defaults to `'default'` so every existing single-key call site keeps working
 * and keeps using the exact same bucket it used before.
 */
export function limiterFor(model = 'default', keyId = 'default') {
  const bucketId = `${keyId}::${model}`;
  let l = limiters.get(bucketId);
  if (!l) {
    const known = KNOWN_MODEL_LIMITS[model] || {};
    l = new ModelRateLimiter(model, { ...DEFAULT_LIMITS, ...known, ...overridesFor(model) });
    l.keyId = keyId;
    l.bucketId = bucketId;
    l.devanagariOk = known.devanagariOk ?? null;
    l.excludedReason = known.excludedReason || null;
    l.promptOverheadFactor = known.promptOverheadFactor || 1;
    l.measuredOutputRatio = known.measuredOutputRatio || null;

    // A cold bucket starts from measured evidence, not from the worst case.
    // We reserve `prompt + prompt*reserved`, and spend `prompt + actual`, so
    // the fraction of the ceiling really used is (1+actual)/(1+reserved).
    // Deriving it this way keeps the seed consistent with what `observe()`
    // feeds in later, instead of being a second unrelated guess.
    //
    // NOTE: the margin and floor are duplicated from translator.js
    // (`OUTPUT_RATIO_MARGIN`, `MIN_OUTPUT_RATIO`) rather than imported, because
    // translator.js already imports this module and the cycle would be worse
    // than the duplication. Keep all three in step.
    if (known.measuredOutputRatio) {
      const RESERVE_MARGIN = 1.15;
      const MIN_RESERVED_RATIO = 1.2;
      const reservedRatio = Math.max(MIN_RESERVED_RATIO, known.measuredOutputRatio * RESERVE_MARGIN);
      l.seedRatio((1 + known.measuredOutputRatio) / (1 + reservedRatio));
    }

    limiters.set(bucketId, l);
  }
  return l;
}

// ---------------------------------------------------------------------------
// Model router
// ---------------------------------------------------------------------------

/**
 * Models we are willing to route to, in tie-break preference order.
 * Membership requires `devanagariOk === true` — a model that cannot emit
 * Devanagari has quota we must never spend, because the output is unusable by
 * a hi-IN voice and the failure is silent (see docs/09_MODEL_ROTATION_MEASURED.md).
 */
export function eligibleModels(available = null) {
  const eligible = Object.entries(KNOWN_MODEL_LIMITS)
    .filter(([, v]) => v.devanagariOk === true)
    .map(([id]) => id);
  if (!available || !available.length) return eligible;
  return eligible.filter((id) => available.includes(id));
}

/**
 * What one request for `ceiling` tokens ACTUALLY costs on `model`.
 *
 * `groq/compound` is an agentic system, not a bare model: it wraps the prompt
 * in tool scaffolding, so a ~1 000-token prompt was billed at 5 328 tokens
 * (measured). Routing on the raw ceiling would send it work it cannot afford
 * and trip a 429 we predicted would not happen.
 */
export function costOn(model, ceiling) {
  const factor = KNOWN_MODEL_LIMITS[model]?.promptOverheadFactor || 1;
  return Math.max(1, Math.ceil(ceiling * factor));
}

/**
 * Weight of "burning one daily request slot" against "consuming the TPM window".
 *
 * These two terms are in different units, so the weight sets the exchange rate
 * and is NOT arbitrary — it was calibrated against the measured limits. At 1.5
 * the RPD term for `groq/compound` is 1.5/250 = 0.006, which is noise next to
 * any token term, so the router happily spent a 250-per-DAY slot (plus that
 * model's 5.5x prompt overhead) on an 800-token chunk. Since a request slot is
 * the scarcest resource in the whole system — 250/day on compound vs 14 400 on
 * 8b-instant — the term has to be able to dominate. At 50 the ordering for a
 * small chunk becomes 70b (0.117) < 8b (0.136) < compound (0.263), while a
 * chunk large enough to justify the big lane still routes there.
 */
const RPD_SCARCITY_WEIGHT = 50;

/**
 * How strongly to prefer a lane whose per-minute window is still full.
 *
 * `fullness` is in [0,1], and `tokenShare` — the dominant term for a typical
 * chunk — is roughly 0.1-0.4. A weight of 0.5 therefore makes lane temperature
 * matter enough to break ties and to steer a burst away from a depleted lane,
 * without ever overriding a genuine cost or daily-scarcity difference.
 *
 * Set from PROBE-15: a recently-spent lane 429s where a rested lane succeeds,
 * so spreading by temperature is what prevents self-inflicted rejections when
 * a chapter fans out into many small chunks (see TARGET_CHUNK_WORDS).
 */
const LANE_COOLNESS_WEIGHT = 0.5;

/**
 * Pick the cheapest eligible model for a chunk.
 *
 * Free-tier limits are PER MODEL (verified: spending on one model does not move
 * another's `x-ratelimit-remaining-tokens`), so rotation genuinely multiplies
 * quota. Two rules make that worth doing:
 *
 *  1. NEVER WAIT IF SOMETHING IS FREE. A model with zero wait always beats a
 *     "preferred" model that is blocked. Preference order is only a tie-break.
 *  2. BE RPD-AWARE, NOT JUST TPM-AWARE. `groq/compound` has 70 000 TPM but only
 *     250 requests per DAY; `llama-3.1-8b-instant` has 6 000 TPM and 14 400 RPD.
 *     Sorting on TPM alone sends every tiny chunk to compound and exhausts a
 *     day's requests before lunch. So a request is scored by the fraction of
 *     each scarce budget it consumes, and the RPD penalty is discounted for
 *     large chunks — that is exactly what the high-TPM/low-RPD lane is FOR.
 *
 * @param {number} ceiling   worst-case tokens (prompt + max_completion_tokens)
 * @param {object} [opts]
 * @param {string[]} [opts.available] ids the account can actually reach
 * @param {string[]} [opts.exclude]   ids that already failed for this chunk
 *                                    (either `model` or `keyId::model`)
 * @param {string}   [opts.prefer]    user's chosen model, wins ties
 * @param {string[]} [opts.keys]      key lane ids to spread across; omit for
 *                                    single-key behaviour identical to before
 * @returns {{model:string, keyId:string, waitMs:number, cost:number, reason:string,
 *            candidates:object[]}|null}
 */
export function selectModel(ceiling, { available, exclude = [], prefer, keys } = {}) {
  const now = Date.now();
  const keyLanes = keys && keys.length ? keys : ['default'];
  const pool = eligibleModels()
    .filter((m) => !available || available.includes(m));

  const candidates = [];
  for (const keyId of keyLanes) {
    for (const model of pool) {
      // A chunk may be dead on one model everywhere (too big), or dead only on
      // one key (that key got a 429). Both are expressed through `exclude`.
      if (exclude.includes(model) || exclude.includes(`${keyId}::${model}`)) continue;

      const l = limiterFor(model, keyId);
      const cost = costOn(model, ceiling);

      // Cannot EVER fit in this model's minute window — no amount of waiting helps.
      if (cost > l.tpm.limit) {
        candidates.push({ model, keyId, cost, viable: false, reason: 'chunk_exceeds_tpm' });
        continue;
      }
      l.tpm.refill(now); l.rpm.refill(now); l.tpd.refill(now); l.rpd.refill(now);

      // Out of daily budget entirely: waiting for a day is not "waiting".
      const rpdWait = l.rpd.waitFor(1, now);
      const tpdWait = l.tpd.waitFor(cost, now);
      if (rpdWait > DAILY_TERMINAL_THRESHOLD_MS || tpdWait > DAILY_TERMINAL_THRESHOLD_MS) {
        candidates.push({ model, keyId, cost, viable: false, reason: 'daily_exhausted' });
        continue;
      }

      const { waitMs, reason } = l.assess({ cost }, now);

      // Scarcity: what fraction of each budget does this one request eat?
      const tokenShare = cost / (l.tpm.limit || 1);
      const rpdRemaining = Number.isFinite(l.rpd.remaining) ? Math.max(1, l.rpd.remaining) : 1e9;
      const requestShare = 1 / rpdRemaining;
      // A chunk that fills most of this model's minute window is a "large" chunk;
      // spending a scarce request slot on it is good value, so discount the penalty.
      const sizeFactor = Math.min(1, tokenShare);

      /**
       * PREFER THE COOLEST LANE.
       *
       * Without this term, every lane that is "free now" scores identically and
       * ties are broken by array order — so a burst of chunks is handed to the
       * same lanes in the same sequence every time, hammering the lane whose
       * per-minute window is already the most depleted.
       *
       * PROBE-15 measured the consequence directly: two concurrent requests on
       * a RECENTLY-USED key were both rejected with 429, while the same two
       * requests on rested keys succeeded — and three *larger* concurrent
       * requests on a rested key also succeeded. Concurrency was never the
       * problem; the residual state of the lane's window was.
       *
       * `fullness` is 0 for a completely fresh lane and approaches 1 as the
       * window empties, so adding it steers each new chunk to the lane with the
       * most headroom. This is what turns a large key pool into real throughput
       * instead of just a longer list of keys.
       */
      const fullness = 1 - (l.tpm.remaining / (l.tpm.limit || 1));

      const score = tokenShare
        + RPD_SCARCITY_WEIGHT * requestShare * (1 - sizeFactor)
        + LANE_COOLNESS_WEIGHT * fullness;

      candidates.push({
        model, keyId, cost, viable: true, waitMs, reason: reason || 'ready',
        score, rpdRemaining: Number.isFinite(l.rpd.remaining) ? Math.floor(l.rpd.remaining) : null,
        tpmRemaining: Math.floor(l.tpm.remaining),
      });
    }
  }

  const viable = candidates.filter((c) => c.viable);
  if (!viable.length) return null;

  const ready = viable.filter((c) => c.waitMs === 0);
  const pick = (list) => list.sort((a, b) => {
    if (prefer && a.model !== b.model) {
      if (a.model === prefer) return -1;
      if (b.model === prefer) return 1;
    }
    return a.score - b.score;
  })[0];

  // Rule 1: if anything is free right now, take it and never sleep.
  const chosen = ready.length
    ? pick(ready)
    : viable.sort((a, b) => a.waitMs - b.waitMs || a.score - b.score)[0];

  const via = chosen.keyId === 'default' ? '' : ` via key ${chosen.keyId}`;
  return {
    model: chosen.model,
    keyId: chosen.keyId,
    waitMs: chosen.waitMs,
    cost: chosen.cost,
    reason: ready.length
      ? `free now${via} (${chosen.rpdRemaining ?? '∞'} RPD left, ${chosen.tpmRemaining} TPM left)`
      : `all lanes throttled; ${chosen.model}${via} frees soonest in ${formatMs(chosen.waitMs)} (${chosen.reason})`,
    candidates,
  };
}

/**
 * Settings-driven override.
 *
 * IMPORTANT: a `model` of `'*'` is a LEGACY global override and is deliberately
 * weak — `overridesFor` will not let it lower a limit we have measured. The
 * Settings defaults (`tokensPerMinute: 6000`, `requestsPerMinute: 30`) describe
 * the smallest free-tier lane, so applying them globally would cap
 * `groq/compound` at 6 000 TPM instead of 70 000 and `llama-3.3-70b-versatile`
 * at 6 000 instead of 12 000 — throwing away most of the quota that rotation
 * exists to unlock. Prefer passing an explicit model id.
 *
 * @param {object} limits
 * @param {string} [model] restrict to one model; omitted = legacy global
 */
export function configureLimiter(limits = {}, model = '*') {
  const clean = {};
  for (const [k, v] of Object.entries(limits)) {
    if (Number.isFinite(v) && v > 0) clean[k] = v;
  }
  userOverrides[model] = { ...(userOverrides[model] || {}), ...clean };
  if (model === '*') {
    for (const l of limiters.values()) l.configure(overridesFor(l.model));
  } else {
    // One model now has one bucket PER KEY, so a per-model override has to
    // reach all of them; `limiters.get(model)` only ever found the first.
    for (const l of limiters.values()) {
      if (l.model === model) l.configure(clean);
    }
  }
}


/** Aggregate view for the UI. */
export function quotaSnapshot() {
  const models = [...limiters.values()].map((l) => ({
    ...l.snapshot(),
    keyId: l.keyId || 'default',
    bucketId: l.bucketId || l.model,
  }));
  const totalQueued = models.reduce((s, m) => s + m.queued, 0);
  const blocked = models.find((m) => m.blocked) || null;
  return {
    models,
    // The bucket that is actually constraining us right now.
    active: blocked || models.find((m) => m.queued > 0) || models[0] || null,
    totalQueued,
    blocked: !!blocked,
    /** Distinct key lanes currently holding buckets — powers the UI grid. */
    keyLanes: [...new Set(models.map((m) => m.keyId))],
  };
}

/** Flat shape consumed by `/system/quota` and the UI quota chip. */
export function getQuotaSnapshot() {
  const snap = quotaSnapshot();
  const a = snap.active;
  if (!a) {
    return {
      model: null, tokensRemaining: 0, tokensLimit: 0,
      requestsRemaining: 0, requestsLimit: 0, waiting: 0,
      blocked: false, authoritative: false, all: [],
    };
  }
  return {
    model: a.model,
    keyId: a.keyId || 'default',
    tokensRemaining: a.tpm.remaining ?? 0,
    tokensLimit: a.tpm.limit ?? 0,
    tokensResetInMs: a.tpm.resetInMs,
    requestsRemaining: a.rpm.remaining ?? 0,
    requestsLimit: a.rpm.limit ?? 0,
    dailyRequestsRemaining: a.rpd.remaining,
    dailyRequestsLimit: a.rpd.limit,
    dailyResetInMs: a.rpd.resetInMs,
    waiting: snap.totalQueued,
    blocked: a.blocked,
    blockedForMs: a.blockedForMs,
    blockedReason: a.blockedReason,
    authoritative: a.tpm.authoritative,
    metrics: a.metrics,
    all: snap.models,
  };
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/**
 * Turn any provider failure into an instruction.
 *
 * @returns {{kind:string, retryable:boolean, terminal:boolean, retryAfterMs:number,
 *            message:string, userAction:string|null, headers:object|null}}
 */
export function classifyProviderError(err) {
  const status = err?.status ?? err?.response?.status;
  const raw = err?.message || String(err);
  const lower = raw.toLowerCase();
  const body = err?.error?.error || err?.error || {};
  const code = body?.code || err?.code || '';

  const headers = err?.headers || err?.response?.headers || null;
  const parsed = extractRateLimitHeaders(headers);
  const retryAfterMs = (parsed?.retryAfterMs || 0) || parseRetryAfterFromMessage(raw);
  // Groq only ever discloses TPD/RPM inside the 429 text — capture it.
  const limitState = parseLimitStateFromMessage(body?.message || raw);

  const base = { headers: parsed, limitState, terminal: false, userAction: null };

  if (code === 'CANCELLED' || lower === 'cancelled') {
    return { ...base, kind: 'cancelled', retryable: false, terminal: true, retryAfterMs: 0, message: 'Cancelled by the user.' };
  }

  // --- Daily (TPD/RPD) quota ----------------------------------------------
  //
  // VERIFIED AGAINST LIVE GROQ: a TPD exhaustion does NOT mean "come back
  // tomorrow". The observed response was
  //   "...on tokens per day (TPD): Limit 100000, Used 99981... try again in
  //    19.008s"   with   retry-after: 20
  // i.e. Groq runs TPD as a ROLLING window that trickles back continuously.
  //
  // Treating it as terminal (as an earlier version did) aborted an entire book
  // over a twenty-second pause. So the decision is driven by the ACTUAL wait
  // Groq asks for, never by the words "per day".
  const isDaily = lower.includes('per day') || lower.includes('(tpd)') || lower.includes('(rpd)');

  if (isDaily) {
    const waitMs = retryAfterMs || 60_000;
    // Only give up if the wait is genuinely impractical to sit through.
    if (waitMs > DAILY_TERMINAL_THRESHOLD_MS) {
      return {
        ...base, kind: 'daily_limit', retryable: false, terminal: true, retryAfterMs: waitMs,
        message: `Daily Groq quota exhausted for this model. Resets in ${formatMs(waitMs)}.`,
        userAction: 'Wait for the daily reset, switch to another model, or upgrade the Groq plan.',
      };
    }
    return {
      ...base, kind: 'rate_limit', retryable: true, retryAfterMs: waitMs,
      scope: 'daily',
      message:
        `Daily ${limitState?.dimension === 'rpd' ? 'request' : 'token'} allowance is full, but it ` +
        `refills continuously — Groq asked us to wait ${formatMs(waitMs)}. This is a pause, not a failure.` +
        (limitState ? ` (${limitState.used.toLocaleString()}/${limitState.limit.toLocaleString()} used today)` : ''),
    };
  }

  if (status === 429 || code === 'rate_limit_exceeded' || lower.includes('rate_limit') || lower.includes('rate limit')) {
    return {
      ...base, kind: 'rate_limit', retryable: true,
      retryAfterMs: retryAfterMs || 8000,
      message: retryAfterMs
        ? `Per-minute rate limit reached. Groq asked us to wait ${formatMs(retryAfterMs)}.`
        : 'Per-minute rate limit reached. Backing off before retrying.',
    };
  }

  if (status === 413 || lower.includes('request too large') || lower.includes('reduce your message size') || code === 'tokens') {
    return {
      ...base, kind: 'payload_too_large', retryable: true,
      retryAfterMs: retryAfterMs || 1000,
      message: 'The request was larger than the per-minute token budget allows. Splitting it into smaller pieces.',
    };
  }

  if (status === 401 || lower.includes('invalid api key') || lower.includes('invalid_api_key') || lower.includes('unauthorized')) {
    return {
      ...base, kind: 'auth', retryable: false, terminal: true, retryAfterMs: 0,
      message: 'The Groq API key was rejected (401). This is NOT a rate limit — retrying cannot help.',
      userAction: 'Open Settings, paste a valid Groq API key, and press "Test key".',
    };
  }

  if (status === 403 || lower.includes('forbidden') || lower.includes('permission')) {
    return {
      ...base, kind: 'permission', retryable: false, terminal: true, retryAfterMs: 0,
      message: 'The API key is valid but not permitted to use this model or endpoint (403).',
      userAction: 'Pick a different model, or enable this model on your Groq account.',
    };
  }

  if (status === 404 || lower.includes('decommission') || lower.includes('does not exist') || lower.includes('model_not_found')) {
    return {
      ...base, kind: 'model_gone', retryable: true, retryAfterMs: 0,
      message: 'That model is unavailable or decommissioned. Switching to another available model.',
    };
  }

  if (status === 400) {
    if (code === 'organization_restricted' || lower.includes('organization has been restricted') || lower.includes('organization_restricted')) {
      return {
        ...base, kind: 'auth', retryable: false, terminal: false, retryAfterMs: 0,
        message: 'Organization has been restricted on this Groq key.',
        userAction: 'Use a different API key.',
      };
    }
    return {
      ...base, kind: 'bad_request', retryable: false, terminal: true, retryAfterMs: 0,
      message: `Groq rejected the request as invalid (400): ${body?.message || raw}`,
      userAction: 'This is a bug in the request we built — the raw payload is in the log detail.',
    };
  }

  if (status >= 500 || lower.includes('timeout') || lower.includes('econnreset')
      || lower.includes('enotfound') || lower.includes('fetch failed') || lower.includes('socket hang up')) {
    return {
      ...base, kind: 'transient', retryable: true, retryAfterMs: 0,
      message: 'Temporary Groq/network failure. Retrying with backoff.',
    };
  }

  return { ...base, kind: 'unknown', retryable: false, terminal: true, retryAfterMs: 0, message: raw };
}

/** Groq embeds the delay in prose too: "Please try again in 8.5s". */
export function parseRetryAfterFromMessage(msg) {
  const m = /try again in\s+([\d.]+\s*(?:ms|s|m|h)?(?:[\d.]+\s*(?:ms|s|m|h))*)/i.exec(msg || '');
  return m ? parseDuration(m[1]) : 0;
}

/**
 * Recover the true state of an UNOBSERVABLE limit from a 429 body.
 *
 * This matters more than it looks. Per the official docs, the response headers
 * only ever describe TWO of the four limits:
 *
 *   x-ratelimit-*-tokens    -> "Always refers to Tokens Per Minute (TPM)"
 *   x-ratelimit-*-requests  -> "Always refers to Requests Per Day (RPD)"
 *
 * There is NO header for TPD or RPM. So a daily TOKEN budget silently drains
 * with zero feedback until it fails — which is exactly what happened in
 * testing: TPM showed a healthy 5729 remaining at the very moment the request
 * was rejected for TPD.
 *
 * The only place Groq ever reveals it is the 429 message itself:
 *   "...on tokens per day (TPD): Limit 100000, Used 99981, Requested 41"
 * so we parse it and true up the local counter.
 *
 * @returns {{dimension:string, limit:number, used:number}|null}
 */
export function parseLimitStateFromMessage(msg) {
  if (!msg) return null;
  const dim = /on (tokens|requests) per (day|minute)/i.exec(msg);
  const nums = /Limit\s+(\d+)\s*,\s*Used\s+(\d+)/i.exec(msg);
  if (!dim || !nums) return null;
  const unit = dim[1].toLowerCase();
  const period = dim[2].toLowerCase();
  return {
    dimension: `${unit === 'tokens' ? 't' : 'r'}p${period === 'day' ? 'd' : 'm'}`,
    limit: parseInt(nums[1], 10),
    used: parseInt(nums[2], 10),
  };
}

/**
 * Exponential backoff with FULL JITTER.
 *
 * Without jitter every concurrent worker wakes at the same instant, fires
 * together, and re-trips the limit as a group — a retry storm that looks like
 * the limiter "not working".
 */
export function backoffMs(attempt, { baseMs = 2000, capMs = 60_000 } = {}) {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(exp / 2 + Math.random() * (exp / 2));
}

export function formatMs(ms) {
  if (!ms || ms <= 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3_600_000)}h ${Math.round((ms % 3_600_000) / 60000)}m`;
}
