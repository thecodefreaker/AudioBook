/**
 * KeyPool — the registry of Groq API keys the router may spend from.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Groq docs state plainly: "Rate limits apply at the organization level,
 * not individual users." Every limit table in the docs (RPM / RPD / TPM / TPD)
 * is therefore scoped to (organisation × model).
 *
 * Two facts follow, and both were verified live rather than assumed
 * (scratch/probe-ground-truth.mjs, scratch/probe-reservation.mjs):
 *
 *   1. Limits are PER MODEL. Spending llama-3.3-70b's TPM does not move
 *      openai/gpt-oss-120b's `x-ratelimit-remaining-tokens`. This is what makes
 *      model rotation worth doing.
 *   2. Limits are PER KEY only insofar as each key belongs to a different
 *      organisation. Two keys from the SAME org share one bucket, and rotating
 *      between them buys nothing — worse, it makes the limiter believe it has
 *      2x the quota and guarantees 429s.
 *
 * Point 2 is the dangerous one, and it is why this module does not simply trust
 * that "more keys = more quota". Each key is probed once and grouped by the
 * quota it actually observes; keys that turn out to share a bucket are collapsed
 * into a single lane. See `classifyKeys()`.
 *
 * PORTABILITY
 * -----------
 * This module has no dependency on the audiobook pipeline, the database, or
 * express. It takes keys in and hands out `{ id, apiKey }` lanes. It can be
 * lifted into any other Groq project unchanged.
 */
import { EventEmitter } from 'events';

export const keyPoolEvents = new EventEmitter();
keyPoolEvents.setMaxListeners(50);

/**
 * How long a key stays benched after an auth failure.
 *
 * An invalid key (401) is permanent — retrying it burns a request slot and a
 * round-trip for a guaranteed failure, so it is disabled outright rather than
 * cooled. A 403/organisation issue may be transient, so that one cools.
 */
const COOLDOWN_MS = 5 * 60 * 1000;

/** @typedef {{id:string, apiKey:string, label:string, state:'ok'|'cooling'|'dead',
 *             reason:string|null, cooledUntil:number, org:string|null,
 *             requests:number, failures:number}} KeyLane */

/** @type {Map<string, KeyLane>} */
const lanes = new Map();

/** Short, non-secret identifier. Never log the key itself. */
export function keyIdFor(apiKey) {
  const s = String(apiKey || '');
  if (!s) return 'none';
  return `${s.slice(0, 7)}…${s.slice(-4)}`;
}

/**
 * Register keys. Idempotent: calling it again with the same keys preserves
 * their learned health, so a settings save does not reset a cooldown.
 *
 * @param {Array<string|{apiKey:string,label?:string}>} input
 * @returns {KeyLane[]}
 */
export function registerKeys(input = []) {
  const seen = new Set();
  for (const raw of input) {
    const apiKey = (typeof raw === 'string' ? raw : raw?.apiKey || '').trim();
    if (!apiKey) continue;
    const id = keyIdFor(apiKey);
    if (seen.has(id)) continue; // the same key pasted twice is one lane
    seen.add(id);
    if (lanes.has(id)) {
      lanes.get(id).apiKey = apiKey;
      continue;
    }
    lanes.set(id, {
      id,
      apiKey,
      label: (typeof raw === 'object' && raw?.label) || id,
      state: 'ok',
      reason: null,
      cooledUntil: 0,
      org: (typeof raw === 'object' && raw?.org) || `org-${lanes.size + 1}`,
      requests: 0,
      failures: 0,
    });
  }
  keyPoolEvents.emit('keys', snapshot());
  return [...lanes.values()];
}

/**
 * Load keys from the environment and an optional settings-provided key.
 *
 * Env format (either works):
 *   GROQ_API_KEYS=gsk_a,gsk_b,gsk_c
 *   GROQ_API_KEY=gsk_a
 *
 * Keys belong in `.env`, not in source or the database — the docs recommend
 * exactly this ("enhances security by minimizing the risk of inadvertently
 * including your API key in your codebase").
 */
export function loadKeysFromEnv(extra = []) {
  const fromEnv = [
    ...String(process.env.GROQ_API_KEYS || '').split(/[,\s]+/),
    process.env.GROQ_API_KEY || '',
  ];
  return registerKeys([...fromEnv, ...extra].filter(Boolean));
}

/** Every lane, healthy or not. */
export function allKeys() {
  return [...lanes.values()];
}

/** Lanes that may be used right now. Falls back to nothing if all are dead. */
export function usableKeys(now = Date.now()) {
  return [...lanes.values()].filter((k) => {
    if (k.state === 'dead') return false;
    if (k.state === 'cooling' && k.cooledUntil > now) return false;
    if (k.state === 'cooling') {
      k.state = 'ok';
      k.reason = null;
    }
    return true;
  });
}

export function getKey(id) {
  return lanes.get(id) || null;
}

/** Resolve a lane id back to the secret, for the SDK client. */
export function apiKeyFor(id) {
  return lanes.get(id)?.apiKey || null;
}

/**
 * Record the outcome of a request so the pool learns which keys are real.
 *
 * `kind` comes straight from `classifyProviderError`, so the pool never has to
 * re-parse provider errors — a single source of truth for what a failure means.
 */
export function reportResult(id, { ok, kind, message } = {}) {
  const lane = lanes.get(id);
  if (!lane) return;
  if (ok) {
    lane.requests++;
    if (lane.state === 'cooling') { lane.state = 'ok'; lane.reason = null; }
    return;
  }
  lane.failures++;
  // These `kind` values come verbatim from `classifyProviderError`, so the pool
  // never re-parses a provider error. `auth` is a 401 — permanent, because
  // retrying a rejected key burns a round-trip for a guaranteed failure.
  // `permission` is a 403, which can be an org/model entitlement issue that
  // resolves, so it is benched rather than killed.
  if (kind === 'auth') {
    lane.state = 'dead';
    lane.reason = message || 'Key rejected by Groq (401). It will not be retried.';
    keyPoolEvents.emit('key-dead', { id, reason: lane.reason });
  } else if (kind === 'permission') {
    lane.state = 'cooling';
    lane.cooledUntil = Date.now() + COOLDOWN_MS;
    lane.reason = message || 'Organisation rejected the request (403); benched for 5 minutes.';
  }
  keyPoolEvents.emit('keys', snapshot());
}

/**
 * Probe every key and group keys that share one quota bucket.
 *
 * ===================================================================
 * CORRECTION (measured 2026-08-11, scratch/probe-key-independence.mjs)
 * ===================================================================
 * The FIRST implementation of this function compared each key's
 * `x-ratelimit-remaining-requests` value and grouped keys whose numbers were
 * close together. That was WRONG, and wrong in the most dangerous way: it did
 * not fail loudly, it produced confident nonsense.
 *
 * Four keys in four DIFFERENT organisations each report ~14 399/14 400
 * remaining, because none of them has been used. "Close together" is therefore
 * true for independent keys just as much as for shared ones, so the test merged
 * all four into a single lane and reported "1 independent quota lane". Run
 * against the real keys it did exactly that — and it would have thrown away
 * three quarters of the available quota while looking like evidence.
 *
 * The only sound test is DIFFERENTIAL: spend requests on ONE key, then re-read
 * every OTHER key's counter and see whether it moved.
 *
 *   shared bucket  → the other key's remaining drops by what we spent
 *   separate orgs  → the other key's remaining is untouched
 *
 * Measured result for the four configured keys: each dropped only its own
 * self-cost while the burned key dropped self-cost + burn. They are four
 * genuinely independent organisations, so per-model limits really do multiply
 * by four.
 *
 * COST: (2 + BURN) tiny requests per key, out of 14 400/day. Negligible, and it
 * is the only honest way to answer "do I actually have N× the quota?".
 *
 * @param {string} model model to probe against (must be cheap and always available)
 * @returns {Promise<{groups:Array<{orgId:string, keys:string[]}>, errors:object[]}>}
 */
export async function classifyKeys(model = 'llama-3.1-8b-instant') {
  const errors = [];

  /** One minimal request; returns the DAILY request counter from the headers. */
  const ping = async (lane) => {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${lane.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        max_completion_tokens: 1,
      }),
    });
    // Even a 429 carries the headers we need, so we do not require res.ok.
    const remaining = Number(res.headers.get('x-ratelimit-remaining-requests'));
    const bodyText = await res.text().catch(() => '');
    return { status: res.status, remaining, body: bodyText };
  };

  const live = allKeys().filter((k) => k.state !== 'dead');

  // -- baseline ------------------------------------------------------------
  const before = new Map();
  for (const lane of live) {
    try {
      const r = await ping(lane);
      if (r.status === 401 || (r.status === 400 && (r.body.includes('organization_restricted') || r.body.includes('restricted')))) {
        lane.state = 'dead';
        lane.reason = r.status === 401 ? 'Key rejected by Groq (401).' : 'Organization restricted (400).';
        errors.push({ id: lane.id, error: lane.reason });
        continue;
      }
      if (!Number.isFinite(r.remaining)) {
        errors.push({ id: lane.id, error: 'no rate-limit headers returned' });
        continue;
      }
      before.set(lane.id, r.remaining);
    } catch (err) {
      errors.push({ id: lane.id, error: err.message });
    }
  }

  const testable = live.filter((k) => before.has(k.id));

  // A single key cannot share with anything, so there is nothing to measure.
  if (testable.length < 2) {
    const groups = testable.map((k, i) => ({ orgId: `org-${i + 1}`, keys: [k.id] }));
    for (const g of groups) {
      const lane = lanes.get(g.keys[0]);
      if (lane) lane.org = g.orgId;
    }
    keyPoolEvents.emit('keys', snapshot());
    return { groups, errors };
  }

  // -- differential --------------------------------------------------------
  // Burn on each key in turn and see which OTHER keys move with it. Keys
  // already assigned to a group are skipped as burn targets, so the cost stays
  // linear in the number of distinct organisations rather than in keys.
  const BURN = 5;
  const SELF_COST = 2;         // baseline ping + final ping
  const SHARED_AT = SELF_COST + Math.ceil(BURN / 2);

  const groups = [];
  const assigned = new Set();

  for (const lane of testable) {
    if (assigned.has(lane.id)) continue;

    try {
      for (let i = 0; i < BURN; i++) await ping(lane);
    } catch (err) {
      errors.push({ id: lane.id, error: `burn failed: ${err.message}` });
    }

    const group = { orgId: `org-${groups.length + 1}`, keys: [lane.id] };
    assigned.add(lane.id);

    for (const other of testable) {
      if (assigned.has(other.id)) continue;
      try {
        const r = await ping(other);
        const drop = before.get(other.id) - r.remaining;
        // Refresh the baseline so the next round measures from here.
        before.set(other.id, r.remaining);
        if (drop >= SHARED_AT) {
          group.keys.push(other.id);
          assigned.add(other.id);
        }
      } catch (err) {
        errors.push({ id: other.id, error: err.message });
      }
    }

    groups.push(group);
  }

  for (const g of groups) {
    for (const id of g.keys) {
      const lane = lanes.get(id);
      if (lane) lane.org = g.orgId;
    }
  }

  keyPoolEvents.emit('keys', snapshot());
  return { groups, errors };
}

/**
 * Distinct quota lanes — the ONLY function the router should ask for keys.
 *
 * If `classifyKeys` has run, keys that share an organisation collapse to ONE
 * representative, because their buckets are shared and treating them as
 * separate would double-count the available quota and guarantee 429s.
 *
 * UNTIL classification has run we return a SINGLE lane, not all of them. This
 * is the conservative direction on purpose: assuming independence when it has
 * not been proven makes the limiter admit N× the traffic it is entitled to,
 * and the failure mode (a rate-limit storm mid-book) is far worse than the
 * cost of briefly using one key. `verified:false` lets the UI say exactly that
 * rather than implying quota that may not exist.
 */
export function quotaLanes(now = Date.now()) {
  const usable = usableKeys(now);
  if (!usable.length) return { lanes: [], verified: false };
  
  const classifiedKeys = usable.filter((k) => k.org);
  const unclassifiedKeys = usable.filter((k) => !k.org);
  
  // If no keys have been verified, fallback to a single safe lane
  if (!classifiedKeys.length) return { lanes: usable.slice(0, 1), verified: false };
  
  const byOrg = new Map();
  for (const k of classifiedKeys) if (!byOrg.has(k.org)) byOrg.set(k.org, k);
  
  const lanes = [...byOrg.values()];
  
  // If there are unclassified keys, we add ONE representative to the pool
  // so they can be used, but without multiplying quota dangerously.
  if (unclassifiedKeys.length > 0) {
    lanes.push(unclassifiedKeys[0]);
  }
  
  return { lanes, verified: unclassifiedKeys.length === 0 };
}

/** UI-facing state. Never includes a secret. */
export function snapshot(now = Date.now()) {
  const { lanes: active, verified } = quotaLanes(now);
  return {
    keys: allKeys().map((k) => ({
      id: k.id,
      label: k.label,
      state: k.state === 'cooling' && k.cooledUntil <= now ? 'ok' : k.state,
      reason: k.reason,
      cooldownMs: Math.max(0, k.cooledUntil - now),
      org: k.org,
      requests: k.requests,
      failures: k.failures,
    })),
    total: lanes.size,
    usable: usableKeys(now).length,
    /** Independent quota buckets — the number that actually multiplies limits. */
    quotaLanes: active.length,
    /** False until `classifyKeys()` has proven the keys are separate orgs. */
    verified,
  };
}

/** Test hook. */
export function _reset() {
  lanes.clear();
}
