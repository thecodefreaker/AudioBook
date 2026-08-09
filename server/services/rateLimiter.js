/**
 * Token-bucket rate limiter for the Groq API.
 *
 * WHY: the reported failure was
 *   413 "Limit 6000 TPM, Requested 9459"
 * caused by (a) sizing chunks in characters instead of tokens, and
 * (b) firing every chunk back-to-back with zero pacing, from N concurrent jobs.
 *
 * TPM is an ORGANISATION-wide budget, so switching models on a rate-limit error
 * (as the old fallback chain did) cannot help. The correct response is to WAIT.
 *
 * This limiter is shared process-wide so all jobs pace against one budget.
 */

class TokenBucket {
  constructor({ tokensPerMinute, requestsPerMinute }) {
    this.tpm = tokensPerMinute;
    this.rpm = requestsPerMinute;
    this.tokens = tokensPerMinute;
    this.requests = requestsPerMinute;
    this.lastRefill = Date.now();
    this.queue = [];
    this.draining = false;
  }

  configure({ tokensPerMinute, requestsPerMinute }) {
    if (tokensPerMinute) { this.tpm = tokensPerMinute; this.tokens = Math.min(this.tokens, tokensPerMinute); }
    if (requestsPerMinute) { this.rpm = requestsPerMinute; this.requests = Math.min(this.requests, requestsPerMinute); }
  }

  refill() {
    const now = Date.now();
    const elapsedMs = now - this.lastRefill;
    if (elapsedMs <= 0) return;

    const ratio = elapsedMs / 60000;
    this.tokens = Math.min(this.tpm, this.tokens + this.tpm * ratio);
    this.requests = Math.min(this.rpm, this.requests + this.rpm * ratio);
    this.lastRefill = now;
  }

  /** Current budget snapshot, for the UI quota chip. */
  snapshot() {
    this.refill();
    return {
      tokensRemaining: Math.floor(this.tokens),
      tokensLimit: this.tpm,
      requestsRemaining: Math.floor(this.requests),
      requestsLimit: this.rpm,
      waiting: this.queue.length,
    };
  }

  /**
   * Wait until `cost` tokens are available. Resolves when it's safe to call.
   * @param {number} cost estimated input + output tokens
   * @param {(waitMs:number)=>void} [onWait] called when we actually have to wait
   */
  acquire(cost, onWait) {
    return new Promise((resolve) => {
      this.queue.push({ cost: Math.min(cost, this.tpm), resolve, onWait, notified: false });
      this.drain();
    });
  }

  async drain() {
    if (this.draining) return;
    this.draining = true;

    while (this.queue.length > 0) {
      this.refill();
      const head = this.queue[0];

      if (this.tokens >= head.cost && this.requests >= 1) {
        this.tokens -= head.cost;
        this.requests -= 1;
        this.queue.shift();
        head.resolve();
        continue;
      }

      // Work out how long until we have enough budget.
      const tokenDeficit = Math.max(0, head.cost - this.tokens);
      const requestDeficit = Math.max(0, 1 - this.requests);
      const waitForTokens = (tokenDeficit / this.tpm) * 60000;
      const waitForRequests = (requestDeficit / this.rpm) * 60000;
      const waitMs = Math.ceil(Math.max(waitForTokens, waitForRequests, 250));

      if (!head.notified && head.onWait) {
        head.notified = true;
        head.onWait(waitMs);
      }

      await sleep(Math.min(waitMs, 5000));
    }

    this.draining = false;
  }

  /** Called after a real 429 so we stop optimistically spending. */
  penalise(retryAfterSeconds = 10) {
    this.tokens = 0;
    this.requests = 0;
    // Push the refill clock forward so the bucket genuinely stays empty
    // for the duration the provider asked us to back off.
    this.lastRefill = Date.now() + retryAfterSeconds * 1000;
  }

  /**
   * Settle a reservation against the provider's reported usage.
   *
   * `acquire()` must reserve an ESTIMATE, because the true cost is unknowable
   * until the response arrives. The old code reserved the worst case — prompt
   * plus the full `max_tokens` ceiling — on every call, so a chunk routinely
   * reserved several times what it spent and the 6000 TPM free tier looked
   * exhausted after five or six chapters. Reconciling makes the estimate
   * self-correcting: unused budget is handed back, and an under-estimate is
   * charged so the next caller genuinely waits.
   *
   * @param {number} reserved what acquire() was charged
   * @param {number} actual   total tokens the provider reported
   */
  reconcile(reserved, actual) {
    if (!Number.isFinite(reserved) || !Number.isFinite(actual) || actual <= 0) return;
    this.refill();
    const delta = reserved - actual;
    if (delta === 0) return;
    // delta > 0 → refund the surplus; delta < 0 → charge the shortfall.
    this.tokens = Math.max(0, Math.min(this.tpm, this.tokens + delta));
    if (delta > 0) this.drain(); // a refund may unblock a waiter
  }
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Groq free tier defaults; configurable from Settings.
export const groqLimiter = new TokenBucket({
  tokensPerMinute: 6000,
  requestsPerMinute: 28,
});

/**
 * Classify a provider error so the caller knows what to DO about it.
 * @returns {{kind:string, retryable:boolean, retryAfterMs:number, message:string}}
 */
export function classifyProviderError(err) {
  const status = err?.status || err?.response?.status;
  const raw = err?.message || String(err);
  const body = err?.error?.error || err?.error || {};
  const code = body?.code || '';
  const lower = raw.toLowerCase();

  // Explicit retry-after if the provider gave us one
  const headerRetry = Number(
    err?.headers?.['retry-after'] || err?.response?.headers?.['retry-after'] || 0
  );
  const parsedRetry = parseRetryAfterFromMessage(raw);
  const retryAfterMs = (headerRetry ? headerRetry * 1000 : parsedRetry) || 0;

  if (status === 429 || code === 'rate_limit_exceeded' || lower.includes('rate_limit')) {
    return {
      kind: 'rate_limit', retryable: true,
      retryAfterMs: retryAfterMs || 8000,
      message: 'Rate limit reached (TPM/RPM). Waiting before retry — the same model is retried because the limit is organisation-wide.',
    };
  }

  if (status === 413 || lower.includes('request too large') || code === 'tokens') {
    return {
      kind: 'payload_too_large', retryable: true, retryAfterMs: retryAfterMs || 3000,
      message: 'Request exceeded the per-minute token budget. Retrying with a smaller chunk.',
    };
  }

  if (status === 401 || status === 403 || lower.includes('invalid api key') || lower.includes('unauthorized')) {
    return { kind: 'auth', retryable: false, retryAfterMs: 0, message: 'API key is invalid, expired, or lacks access. Fix the key in Settings.' };
  }

  if (status === 404 || lower.includes('decommission') || lower.includes('does not exist') || lower.includes('model_not_found')) {
    return { kind: 'model_gone', retryable: true, retryAfterMs: 0, message: 'Model unavailable or decommissioned. Switching to another available model.' };
  }

  if (status >= 500 || lower.includes('timeout') || lower.includes('econnreset') || lower.includes('fetch failed')) {
    return { kind: 'transient', retryable: true, retryAfterMs: 2000, message: 'Temporary provider/network failure. Retrying.' };
  }

  return { kind: 'unknown', retryable: false, retryAfterMs: 0, message: raw };
}

function parseRetryAfterFromMessage(msg) {
  // Groq embeds e.g. "Please try again in 8.5s"
  const m = /try again in ([\d.]+)\s*(ms|s|m)/i.exec(msg || '');
  if (!m) return 0;
  const value = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === 'ms') return value;
  if (unit === 'm') return value * 60000;
  return value * 1000;
}
