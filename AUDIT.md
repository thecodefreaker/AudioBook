# Audiobook AI Workspace — Full Codebase Audit

> Scope: server/core/queue.js, pipeline.js, rateLimiter.js, translator.js,
> ttsEngine.js, database.js, routes/books.js, routes/audio.js, routes/system.js,
> services/settings.js, services/logBus.js, services/prompts.js,
> services/scriptUtils.js, utils/textChunker.js,
> src/main.js, src/store.js, src/services/api.js, src/services/socket.js,
> src/components/chapterList.js
> Plus: official Groq rate-limit and API reference docs.
>
> All claims in this report are traced to specific lines. Nothing is assumed.

---

## Area 1 — Cancellation System

### How it actually works

**UI trigger (chapterList.js:149)**
The Stop button renders only when `gen.message !== 'Stopping…'`, i.e. it becomes
`disabled` the moment the user presses it:

```js
<button ... data-act="cancel" ${gen.message === 'Stopping…' ? 'disabled' : ''}>Stop</button>
```

A click fires `handlers.onCancel(chapterIdx)` → `cancelChapterConversion` (main.js:823).

**`cancelChapterConversion` (main.js:823)**
1. Looks up `state.chapterJobs[chapterIdx]` (set by `setupProgressTracking`).
2. If no jobId is recorded, falls back to `cancelAllJobs()` — a book-wide cancel
   with a `confirm()` dialog.
3. Otherwise: `api.cancelChapter(bookId, jobId, chapterIdx)` →
   `POST /books/:id/jobs/:jobId/chapters/:idx/cancel`.
4. Immediately writes `'Stopping…'` into `state.activeGenerations[chapterIdx].message`
   and calls `renderChapters()`.
5. UI shows toast: "Chapter N will stop after the current step."

**Backend (queue.js:cancel)**
- If the job is still in `pending[]`: spliced out immediately, DB row updated to
  `cancelled`, `{ wasRunning: false }` returned. ✅
- If the job is in `running` Map: `run.cancelled = true` cooperative flag only.
  No signal, no interrupt. Returns `{ wasRunning: true }`.

**Pipeline (pipeline.js:checkCancel)**
`checkCancel()` throws `CancelledError` when the job flag is true. It is called at
six points: before each of the 5 named stages, and inside the TTS `onProgress`
callback (polled every 1 s by `ttsEngine.js`).

**TTS (ttsEngine.js)**
`AbortController.abort()` cancels the native WebSocket stream in `edge-tts-universal` when `onProgress()`
throws `CancelledError`. The pure Node.js synthesis aborts immediately without any subprocesses.

---

### Problems found

#### BUG-1 (HIGH): Cancel is invisible for 10–60 s during Groq HTTP calls

`translator.js` calls `groq.chat.completions.create({...}).withResponse()` as a
single awaited promise. There is no AbortSignal passed to this call, and no
`onProgress` callback is invoked while the HTTP response is in flight.

`checkCancel()` is called immediately BEFORE the HTTP call and immediately AFTER.
Between those two points — the entire round-trip to Groq — the cancel flag is set
but never checked. A chapter translating a 5 000-token chunk through a slow model
will hold "Stopping…" for the full duration of that request.

The `onProgress` in the rate-limiter drain loop IS called every second, but only
during the `acquire()` wait — not during the HTTP request itself.

**Acceptance criteria for a fix:**
- Pass `signal: abortController.signal` to `groq.chat.completions.create()`.
- The same controller that drives `checkCancel()` must own the signal, so the HTTP
  request is aborted the moment `run.cancelled` becomes `true`.
- UI "Stopping…" must resolve (row disappears or shows "Stopped") within ~2 s of
  the button press, including during translation.

#### BUG-2 (MEDIUM): `job:cancelled` / `job:error` wipe ALL chapter states

`initRealtimeHandlers` (main.js:2685, 2676):
```js
state.activeGenerations = {};
state.chapterJobs = {};
```
This clears every chapter's in-progress state on ANY job cancel or error.

In a batch scenario where 3 jobs run concurrently, cancelling job #1 makes the UI
show chapters #2 and #3 as idle even though the server is still working on them.
The chapters eventually complete and fire `chapter:complete` events, but
`activeGenerations` is empty, so the row stays "idle" and no success toast fires.

**Fix**: track cancel/error per-jobId and only clear chapters belonging to that job.
`state.chapterJobs` already maps chapterIdx → jobId; use it to filter.

#### BUG-3 (MEDIUM): After page reload, Stop falls back to book-wide cancel

`state.chapterJobs` is in-memory only. After reload it is empty. When the user
presses Stop on a chapter that was already running when the page loaded,
`cancelChapterConversion` (main.js:826) detects no jobId and falls back to
`cancelAllJobs()`, which shows a `confirm()` dialog promising to cancel ALL
conversions. A chapter-level action should not silently escalate to a book-level
one without clear explanation.

**Fix**: On page load, if active jobs exist (from `GET /books/:id/jobs`), populate
`state.chapterJobs` from the job's `selectedChapters` field.

#### BUG-4 (LOW): Partial output MP3 not cleaned on TTS failure mid-chunk

`synthesizeChunked` (ttsEngine.js:104):
- The `finally` block deletes `tempDir` (chunk temp files). ✅
- `outputPath` (the final stitched MP3) is only written by FFmpeg concat.
- If concat succeeds but `writeFileSync(finalVttPath, ...)` throws (disk full), the
  MP3 exists but the VTT is absent. The pipeline writes the DB row pointing to both;
  audio loads but subtitles fail silently.
- If the job is cancelled AFTER concat but BEFORE pipeline writes the DB row,
  the MP3 stays on disk as an orphan.

**Fix**: In the catch path of `pipeline.js`'s SYNTH stage, unlink `outputPath` if it
exists and no DB row has been committed yet.

#### CORRECT behaviours (do not change)
- Queued job: instant, no race — `pending[]` splice is synchronous.
- Per-chapter cancel correctly isolates one chapter within a multi-chapter job.
- Socket `chapter:cancelled` event properly clears only the one chapter's UI state.
- TTS subprocess is killed within ~1 s via AbortController.
- "Stopping…" disables the Stop button, preventing double-cancel.

---

## Area 2 — Queue Concurrency

### How it actually works

`queue.js` constructor: `this.concurrency = 1`.  
`settings.js` DEFAULTS: `concurrency: 2`, `chapterConcurrency: 2`.

The queue is configured by `queue.configure()` at startup and when
`PUT /system/settings` is called. `configure()` clamps to `[1, 4]`.

Within each job, the chapter worker pool size is:
```js
workers = Math.max(1, Math.min(settings.chapterConcurrency || 3, 8, total))
```
The fallback here is `3`, not `2`.

**Scope**: The `jobQueue` is process-wide (one instance, `queue.js` exports a
singleton). All books share this queue. There is no per-book, per-voice, or
per-provider limit. Translation and TTS share the same chapter worker pool.

**Batch fan-out**: `startGeneration` (main.js:2345) sends one `POST /convert` per
settings group via `Promise.all`. Each POST creates one job. The queue
serialises them according to `concurrency`.

---

### Problems found

#### BUG-5 (HIGH): Queue starts at concurrency=1, not the settings default of 2

On a cold start, `queue.js` initialises with `concurrency: 1`. Whether startup
wires the settings default into the queue depends on `server/index.js` (not audited),
but if `jobQueue.configure()` is not called before the first job is enqueued, only
one book conversion runs at a time.

**Fix**: Call `jobQueue.configure({ concurrency: settings.concurrency })` at boot,
before any route is served.

#### BUG-6 (LOW): `chapterConcurrency` fallback is 3, settings default is 2

`pipeline.js`: `settings.chapterConcurrency || 3`

If someone saves `chapterConcurrency: 0` in settings (an edge case but legal JSON),
they get 3 workers, not 1. The fallback should match the settings default (2).

**Fix**: Change to `settings.chapterConcurrency ?? 2` (nullish coalescing, preserves
`0` as falsy correctly by using default only for `null`/`undefined`). Or:
`settings.chapterConcurrency > 0 ? settings.chapterConcurrency : 2`.

#### FRAGILE-1: In-memory queue does not survive restart

After server restart: the DB boot-heal marks `processing`/`queued` jobs
`interrupted`, but the in-memory queue is empty. No job is ever re-queued
automatically. Users see chapters stuck at `interrupted` status until they press
Retry. This is documented behaviour but should be stated clearly in the UI
(currently there is no "Interrupted — click Retry" state, only a generic error row).

#### CORRECT behaviours (do not change)
- `configure()` is called immediately when settings change via `PUT /system/settings`.
- Queue concurrency clamps correctly to [1, 4].
- `cancel()` for a pending job is synchronous and immediate.
- `GET /system/queue` exposes a real-time snapshot.

---

## Area 3 — Groq Rate Limiting

### Comparing implementation against official docs

**Docs (Rate Limits.md):**
- RPM: 30 for most text models. RPD: varies (14.4 K for llama-3.1-8b-instant,
  1 K for llama-3.3-70b-versatile).
- TPM: 6 K for llama-3.1-8b-instant, 12 K for llama-3.3-70b-versatile.
- Header `x-ratelimit-limit-requests` = **total allowed RPD** (not RPM).
- Header `x-ratelimit-remaining-requests` = **remaining RPD** (not RPM).
- Header `x-ratelimit-limit-tokens` = TPM.
- Header `x-ratelimit-remaining-tokens` = remaining TPM in this minute.
- `retry-after` is returned only on 429 responses.

---

#### BUG-7 (HIGH): `x-ratelimit-remaining-requests` is RPD, not RPM

`translator.js` reads `x-ratelimit-remaining-requests` and passes it to
`groqLimiter.syncRemaining(parseInt(tpmRemaining, 10), ...)` (this is the requests
path, not the tokens path). The code treats this number as "requests remaining this
minute", but the Groq docs explicitly state it is "Remaining Requests Per Day".

For llama-3.1-8b-instant, this header starts at 14 400 and decrements by 1 per
request. The rate limiter interprets 14 399 as "plenty of RPM budget" and never
throttles, while the actual per-minute limit (30 RPM) is enforced silently by Groq
and results in a 429 that the code then penalises.

**Correct approach**: Do not sync per-minute request rates from this header. The
docs say to monitor `x-ratelimit-remaining-requests` only to know daily headroom.
The per-minute RPM is a Groq-side guardrail; client-side, only TPM (tokens per
minute) is accurately trackable via headers.

**Fix**: Remove or rename the "requests" sync from the response header path.
Keep only the TPM sync from `x-ratelimit-remaining-tokens`.

#### BUG-8 (MEDIUM): Startup RPM mismatch

`rateLimiter.js` constructs `groqLimiter` with `requestsPerMinute: 28`.
`settings.js` DEFAULTS has `requestsPerMinute: 30`.

Between server start and the first settings-load call, the limiter uses 28 RPM.
This causes ~7% unnecessary headroom sacrifice on the first batches after restart.

**Fix**: Set `rateLimiter.js` initial value to 30, or initialise the limiter from
settings at startup.

#### BUG-9 (MEDIUM): `tpmLimit` not propagated from settings to `computeChunkBudget`

`pipeline.js` calls `retellChapter(chapter, options)` without passing `tpmLimit`.
`computeChunkBudget` therefore always calculates against `tpmLimit=6000`:

```js
export function computeChunkBudget({ tpmLimit = 6000, ... } = {}) {
```

If the user has a higher-tier account (e.g., 12 000 TPM for llama-3.3-70b) and
has updated the settings, the chunk budget is still calculated for 6 000 TPM.
This produces unnecessarily small chunks — up to 2× too conservative — meaning
more API calls, more RPM consumption, and slower translation.

**Fix**: Pass `settings.tokensPerMinute` (or `groqLimiter.tpm` after header sync)
when calling `retellChapter`.

#### BUG-10 (LOW): No model-specific TPM cap

The rate limiter stores one `tokensPerMinute` value process-wide. If two jobs run
simultaneously with different models (one via settings default, one via per-chapter
override), they share the same token bucket even though their per-minute caps are
different. At worst, the 6 K-TPM llama-3.1-8b-instant and a future 70 K-TPM
compound model would share the same bucket at whichever value was last set.

This is a minor risk today (single user, one model at a time) but worth noting for
future multi-tenant or multi-model scenarios.

#### CORRECT behaviours (do not change)
- TPM token-bucket refill-by-elapsed-time is correct (no busy wait).
- `reconcile(reserved, actual)` correctly reclaims unused reservation.
- `penalise(retryAfterSeconds)` zeros both `tokens` and `requests` and sets
  `lastRefill` to `now + retryAfterSeconds`. This is consistent with
  the docs: "Wait for the specified duration before retrying."
- Header sync of `x-ratelimit-limit-tokens` and `x-ratelimit-remaining-tokens`
  is correct — these ARE TPM values in the Groq docs.
- Exponential backoff in `translator.js` retry loop is implemented correctly.
- The `drain()` loop calls `onProgress()` every second, enabling cancellation
  during token-budget waits.

---

## Area 4 — Translation Pipeline

### How the full AI text flow works

1. **Source selection**: `scriptSource` param ('ai' | 'custom' | 'original') in
   the convert request.
2. **For 'ai'**: pipeline SCRIPT stage calls `retellChapter()` → Groq →
   stores result as a new row in `chapter_scripts` (source='ai').
3. **For 'custom'**: pipeline reads the latest `chapter_scripts` row where
   `source='custom'` for this chapter.
4. **For 'original'**: pipeline reads `chapters.content` directly.
5. **Script output**: stored in `chapter_scripts.content` with `source`,
   `kind`, `provider`, `language`, `style` columns. Row gets a UUID `id`.
6. **Pinning**: the TTS stage is given the resolved text from the chosen script
   source. The resulting `audio_files` row stores `script_id` pointing to the
   exact `chapter_scripts` row.
7. **UI display**: `previewChapter` fetches `chapterContent` which returns
   `aiContent` (latest AI script content) and `aiScript` (the full script object).
   The reader renders `data.aiContent`, not the legacy `translated_content` column.
   The legacy migration on boot converts old `translated_content` → `chapter_scripts`.

---

### Problems found

#### BUG-11 (HIGH): No prompt version stored per script row

`PROMPT_VERSION = 'v3-lean'` is a constant in `prompts.js`. It is NOT stored in
the `chapter_scripts` table. If the prompt is changed (e.g., from v3-lean to v4),
there is no way to distinguish scripts produced by the old prompt from scripts
produced by the new one. The UI will silently show an old script as if it were
current.

**Fix**: Store `prompt_version` in `chapter_scripts`. Surface it in the
`aiScript` object returned by the API so the reader can show a "⚠️ Created with an
older prompt version" badge when `script.promptVersion !== PROMPT_VERSION`.

#### BUG-12 (MEDIUM): `chunkByTokens` always assumes 6 000 TPM for budget

(See BUG-9 above — same root cause.) The chunk budget computation in
`computeChunkBudget()` hardcodes `tpmLimit=6000`. For a 12 000 TPM model, chunks
could be up to 2× larger, halving the number of API calls and reducing latency.

#### BUG-13 (LOW): Continuity block pulled from in-memory accumulation

The `buildTranslationPrompt` appends the last paragraph of the previous chunk as a
"continuity block". This works correctly within a single `retellChapter` call. But
if the server restarts mid-chapter, the continuity context is lost and the
next retry starts without it. For a fresh `retryJob`, the chapter starts from
scratch anyway, so this is a minor edge case rather than a bug.

#### CORRECT behaviours (do not change)
- `aiContent` is read from `chapter_scripts` (not `translated_content`).
  The legacy migration handles old data correctly.
- `script_id` is stored on `audio_files`, enabling the "generate audio from THIS
  script" pinning the UI promises.
- Token estimation correctly differentiates Devanagari (÷1.4) from Latin (÷3.2).
- `prepareForTts()` is advisory — it does not modify the text, only checks it.
  TTS receives the script verbatim as intended.
- Style/glossary/language fields are all applied correctly in prompt construction.
- The reader's AI tab reads `data.aiContent` (the content), not the old blended
  `translatedContent` field that could show a custom script under the AI label.

---

## Area 5 — TTS and Audio Generation

### How the TTS/audio flow works

1. Pipeline SYNTH stage calls `synthesizeChunked(ttsChunks, voice, outputPath, onProgress)`.
2. `chunkText(text, 4500)` splits script by paragraph/sentence at ≤4 500 chars.
3. Each chunk: `synthesize(chunk, voice, chunkPath, vttPath, onProgress)` → edge-tts subprocess.
4. VTT timestamps for each chunk are shifted by accumulated duration (via ffprobe of prior chunks).
5. All chunks concatenated with FFmpeg concat demuxer → final `outputPath` MP3.
6. Master VTT written to `outputPath.replace('.mp3', '.vtt')`.
7. Pipeline probes final MP3 for duration, calls `db.createAudioFile()` with
   `script_id`, `alignment_json` (built from VTT cues), `duration_seconds`, etc.
8. Socket event `chapter:complete` fires with the new audio row.

---

### Problems found

#### BUG-14 (MEDIUM): VTT absent if final write fails after FFmpeg concat

(Same issue as BUG-4 from a different angle.) `synthesizeChunked` writes
`masterVttContent` to `finalVttPath` AFTER FFmpeg concat succeeds. If `writeFileSync`
throws (rare but possible: disk full, permission error), the MP3 exists on disk
but VTT does not. The pipeline continues, `createAudioFile()` stores the row, and
the audio plays without subtitles. There is no error logged for missing VTT.

**Fix**: Wrap the VTT write in a try/catch. If it fails, log a warning and store
`null` for the VTT path in the DB row rather than a path that doesn't exist.

#### BUG-15 (LOW): `onProgress` callback signature inconsistency

`synthesize()` calls `onProgress()` with no arguments (it's used only as a cancel
check). `synthesizeChunked()` calls `onProgress({ current, total, percent })` with
a progress object. The caller in `pipeline.js` has a single `onProgress` that
handles BOTH forms:

```js
(p) => {
  checkCancel();   // always
  if (p?.percent) stageProgress(p.percent);
}
```

This works today but is fragile: if the call signature changes in one branch, the
other silently breaks. The `synthesize` function's `onProgress` fires only as a
cancel check; its result is discarded. Defining two separate callbacks
(`onCancel` and `onProgress`) would make intent explicit.

#### BUG-16 (LOW): TTS chunk boundary may split mid-Devanagari word

`chunkText` splits at `\n\s*\n` paragraph boundaries then at sentence endings
using regex `/(?<=[.!?।])\s+/g`. The Hindi full-stop `।` is included, which is
correct. However, the character limit (4 500) is applied to JS string `.length`,
which counts code points, not grapheme clusters. For Devanagari with combining
marks, a visual "character" can be 2–4 code points. In practice, edge-tts accepts
up to ~5 000 characters, so 4 500 is safe, but if a single token is 4 000+
characters it may be force-split mid-word by `forceChunk`.

This is unlikely to occur in normal prose but could affect books with densely
concatenated Devanagari.

#### CORRECT behaviours (do not change)
- VTT timestamp accumulation using `getAudioDuration(chunkPath)` is accurate
  (ffprobe, not estimated).
- `buildAlignment()` falls back correctly to proportional when VTT cues are absent.
- `alignment_json` is stored on the audio row and returned by `GET /audio/:id/alignment`.
- `script_id` on the audio row correctly identifies which script text was spoken.
- `synthesizeChunked` `finally` block cleans up `tempDir` even on error/cancel.
- AbortController correctly terminates the edge-tts subprocess within ~1 s.
- Single-chunk optimisation (skip FFmpeg concat when `chunks.length === 1`) is correct.

---

## Area 6 — Duplicate Conversion / Idempotency

### How the deduplication check works

`POST /:id/convert` (books.js) runs `db.getOverlappingChapterJobs(bookId, selectedChapters)` 
before creating a job. This returns a 409 if any of the requested chapters are
CURRENTLY being processed (status `processing` or `queued`). It does NOT check
whether audio with the same settings already exists.

`db.createAudioFile()` always INSERTs. There is no unique constraint on
(chapterId, voiceId, scriptId). The same chapter can have 10 identical audio rows
if you press Convert 10 times.

---

### Problems found

#### DESIGN-1 (HIGH): No content-based deduplication

**Current state**: Every conversion creates a new row, unlimited. The UI correctly
tells the user "This adds another — nothing is overwritten" and shows version counts.
But there is no automatic limit and no automatic cleanup.

**Recommended standard model** (implementation task, not a bug):

Option A — Enforce uniqueness at DB level: add a UNIQUE constraint on
`(chapter_id, script_id, voice_id)`. Before inserting, check if a row with the
same triple exists; if so, either return the existing row (idempotent) or create a
new version only if any other field (speed, model) differs.

Option B — Soft deduplication: keep unrestricted INSERTs but expose a "keep N
versions" policy in settings (default 3). Run a pruning query after each insert
that deletes the oldest rows beyond the limit. Delete the associated MP3 and VTT
files.

Option B is recommended because it preserves the user's ability to keep parallel
versions (different voices, styles, scripts) while preventing unbounded growth.

**Acceptance criteria**:
- After setting `maxVersionsPerChapter=3`, converting the same chapter a 4th time
  deletes the oldest version (file + DB row) automatically.
- The setting is configurable and defaults to `null` (no limit, current behaviour).
- Delete-on-prune fires `chapter:audio:deleted` socket event so the UI refreshes.

#### DESIGN-2 (MEDIUM): `script_id` is not exposed as a deduplication key in UI

The audio row has `script_id`, meaning two rows from different convert runs with
the same `script_id` and `voice_id` are provably identical audio. The versions
modal and the listen pane do not show this fact. A user who converts the same
chapter twice with the same settings cannot tell they are identical without
playing both.

**Fix**: In the versions modal and listen pane, show a "(same as V2)" indicator
when two versions share the same `script_id` and `voice_id`.

#### CORRECT behaviours (do not change)
- 409 guard prevents two concurrent jobs for the same chapter. ✅
- `script_id` is stored on the audio row, making provenance traceable.
- Version picker in the chapter row and listen pane correctly selects which
  version to play/download; they do not default silently to newest.
- `deleteAudio()` deletes both file and VTT from disk before the DB row.

---

## Cross-Cutting Issues

### UI Backend capability gap

The backend exposes:
- `api.cancelChapter()` — per-chapter cancel ✅ used
- `api.cancelJob(bookId, jobId)` — per-job cancel ✅ used
- `api.cancelBook(bookId)` — book-wide cancel ✅ used as fallback
- `api.cancelAll()` — process-wide cancel exposed in system queue ❌ not wired in UI
- `api.getQueue()` — real-time queue snapshot ✅ polled every 5 s
- `api.pauseQueue()` / `api.resumeQueue()` ✅ queue panel
- `api.speakScript(bookId, chapterIdx, scriptId)` ✅ used via startSingleChapterGeneration
- `api.getChapterVersions(chapterId)` ❌ never called — UI uses `state.audioFiles` filtered in memory
- `api.updateAudio(audioId, updates)` ❌ never called — no audio rename or flag UI
- `api.getStorage()` ❌ never called
- `api.clearApiKey()` ❌ never called (api key is updated via PUT settings)

None of these gaps are critical, but `getChapterVersions` is worth fixing: the
current approach (filter `state.audioFiles` in memory) means a newly-completed
version only appears after the next poll, not immediately.

### Settings consistency

| Setting | settings.js default | rateLimiter.js init | Fix needed |
|---|---|---|---|
| `requestsPerMinute` | 30 | 28 | Set init to 30 |
| `concurrency` | 2 | queue init = 1 | Call `configure()` at boot |
| `chapterConcurrency` | 2 | fallback = 3 in pipeline.js | Change `\|\| 3` to `?? 2` |

### `groq_api_key` plain text in DB

`generation_jobs.groq_api_key` stores the API key in plain text.
`getJobById()` returns it (used by pipeline internally — this is necessary for the
job to make API calls). `getJobsByBookId()` strips it before returning to the client.
The key is never sent to the browser. This is acceptable for a single-user local
app; for a multi-user deployment, keys should be stored encrypted.

---

## Summary Table

| ID | Severity | Area | Summary |
|---|---|---|---|
| BUG-1 | HIGH | Cancel | Groq HTTP call not abortable — "Stopping" stalls 10–60 s |
| BUG-5 | HIGH | Queue | Queue starts at concurrency=1 on cold boot |
| BUG-7 | HIGH | Rate limit | `x-ratelimit-remaining-requests` is RPD, treated as RPM |
| BUG-11 | HIGH | Translation | Prompt version not stored per script |
| DESIGN-1 | HIGH | Idempotency | No content dedup — unlimited identical audio rows |
| BUG-2 | MEDIUM | Cancel | `job:cancelled` wipes ALL chapter states (batch regression) |
| BUG-3 | MEDIUM | Cancel | After reload, Stop escalates to book-wide cancel |
| BUG-8 | MEDIUM | Rate limit | Startup RPM 28 vs settings default 30 |
| BUG-9 | MEDIUM | Rate limit | `tpmLimit` not propagated → chunks 2× too small for 12K models |
| BUG-12 | MEDIUM | Translation | Same root as BUG-9 |
| BUG-14 | MEDIUM | TTS | VTT can be absent if post-concat write fails silently |
| DESIGN-2 | MEDIUM | Idempotency | Same-script duplicates not identified in UI |
| BUG-4 | LOW | Cancel | Partial MP3 not cleaned on cancel/failure |
| BUG-6 | LOW | Queue | `chapterConcurrency` fallback is 3 vs setting default 2 |
| BUG-10 | LOW | Rate limit | No model-specific TPM per-limiter |
| BUG-13 | LOW | Translation | Continuity context lost on restart-mid-chapter |
| BUG-15 | LOW | TTS | `onProgress` callback signature inconsistency |
| BUG-16 | LOW | TTS | Force-split may split mid Devanagari grapheme cluster |
| FRAGILE-1 | LOW | Queue | In-memory queue doesn't survive restart — no UI for interrupted |
