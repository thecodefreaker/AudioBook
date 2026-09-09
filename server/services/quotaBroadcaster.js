/**
 * Quota broadcaster — turns limiter internals into something a human can watch.
 *
 * The confidence problem with the old UI was not that information was missing
 * from the backend; it was that the only channel was a 5-second poll of a flat
 * `{tokensRemaining, tokensLimit}` object. So during a 60-second rate-limit
 * pause the interface showed a frozen percentage and no explanation, which is
 * indistinguishable from a crash.
 *
 * This module pushes every meaningful limiter transition to the browser the
 * instant it happens, each carrying a plain-English reason and, where possible,
 * a countdown the UI can animate.
 */
import { limiterEvents, getQuotaSnapshot, formatMs } from './rateLimiter.js';
import * as logBus from './logBus.js';

let started = false;
let lastPush = 0;

function push(reason, extra = {}) {
  logBus.emitGlobal('quota', {
    quota: getQuotaSnapshot(),
    reason,
    at: Date.now(),
    ...extra,
  });
  lastPush = Date.now();
}

export function startQuotaBroadcaster() {
  if (started) return;
  started = true;

  limiterEvents.on('waiting', ({ model, waitMs, reason, cost, queued }) => {
    push('waiting', {
      state: 'throttled',
      model,
      waitMs,
      limit: reason,
      // The UI shows this verbatim, so it must be a sentence, not an enum.
      headline: `Waiting ${formatMs(waitMs)} — ${LABEL[reason] || reason} limit reached on ${model}`,
      detail: `The next request needs about ${cost.toLocaleString()} tokens. ${queued} request(s) queued.`,
      queued,
    });
  });

  limiterEvents.on('blocked', ({ model, waitMs, reason }) => {
    push('blocked', {
      state: 'blocked',
      model,
      waitMs,
      headline: `Groq asked us to pause for ${formatMs(waitMs)} (${model})`,
      detail: reason === 'payload_too_large'
        ? 'The last request was too large; it will be split and retried automatically.'
        : 'This is normal throttling. Work resumes automatically — nothing has failed.',
    });
  });

  limiterEvents.on('daily-low', ({ model, remaining, limit, resetInMs }) => {
    logBus.log({
      level: 'warn',
      stage: 'system',
      message:
        `Daily Groq request quota nearly exhausted for ${model}: ${remaining}/${limit} left. ` +
        `Resets in ${formatMs(resetInMs) || 'under 24h'}.`,
    });
    push('daily-low', {
      state: 'daily_low',
      model,
      headline: `Daily quota almost gone: ${remaining} of ${limit} requests left`,
      detail: `Resets in ${formatMs(resetInMs) || 'under 24h'}. Consider switching model or upgrading.`,
    });
  });

  limiterEvents.on('limits', ({ model, changes }) => {
    // A silent 6000 → 30000 TPM jump used to be invisible, which made the
    // quota chip look wrong for no discoverable reason.
    logBus.log({
      level: 'info',
      stage: 'system',
      message: `Groq reported its real limits for ${model}: ${changes.join(', ')}. Chunk sizing now uses these values.`,
    });
    push('limits', { state: 'ok', model });
  });

  limiterEvents.on('queue', () => {
    // Coalesce: queue churn is high-frequency and not individually interesting.
    if (Date.now() - lastPush > 1000) push('queue', { state: 'ok' });
  });

  // Heartbeat so a connected client always has fresh numbers and can prove the
  // backend is alive even when nothing is happening.
  setInterval(() => push('heartbeat', { state: 'ok' }), 5000).unref?.();
}

const LABEL = {
  tokens_per_minute: 'tokens-per-minute',
  requests_per_minute: 'requests-per-minute',
  tokens_per_day: 'tokens-per-day',
  requests_per_day: 'requests-per-day',
  rate_limit: 'rate',
  payload_too_large: 'request-size',
};
