# Deep Code Review — Bugs, Blunders & UX Traps

Reviewed: `src/main.js` (1733 lines), `src/index.html`, `server/**`.
Ordered by severity. Each item states the **symptom you actually reported** where applicable.

---

## 🔴 CRITICAL — these cause the bugs you keep hitting

### B1 — One `translated_content` column for infinite versions
**`server/models/database.js`** (chapters table) + **`jobProcessor.js:110`**
```js
db.updateChapter(chapter.id, { translated_content: textForTTS });
```
Every AI run **overwrites** the chapter's only script column.

**This single line causes all of these symptoms you reported:**
- *"when I add my custom script and convert to audio it still doesn't get converted to that custom script"* — an earlier AI run replaced your pasted script.
- *"there is no indication that it converted from the custom script"* — the style is stored on the audio row but the *text* is gone, so nothing can be proven.
- The reader's "Translated" tab always shows the **last** run's text, not the text of the version you're listening to.
- Two versions with different styles are indistinguishable in the reader.

**Fix:** the `chapter_scripts` table in §5.2 of the spec, with `audio_files.script_id`.

---

### B2 — "Saved Custom Script" is offered when no custom script exists
**`main.js:816`**
```js
if (ch.hasTranslation) { customOpt.disabled = false; customOpt.textContent = '✍️ Saved Custom Script (Ready)'; }
```
`hasTranslation` (`books.js:106`) is `!!ch.translated_content` — which is **true after any AI
translation**. So the dialog says "Custom Script (Ready)" and then feeds you AI text.

Compounded in **`jobProcessor.js:88`**:
```js
const isCustomScript = (job.translation_style === 'custom') || (chapter.translated_content && ... && job.translation_style === 'custom');
```
The right-hand clause is dead code — it can never add anything the left clause didn't already cover.

**Fix:** `hasCustomScript` must mean `EXISTS(script WHERE source='custom')`. Show its save date and a 60-char preview.

---

### B3 — Socket listeners are re-registered on every conversion (memory + duplicate events)
**`main.js:1014-1062`** — `setupProgressTracking()` calls `socketService.on('chapter:progress', …)`
and 6 more, and it is called **once per single-chapter conversion** (`main.js:928`) and once per batch.

Convert 10 chapters one by one → **10 stacked handlers** → `renderChapters()` fires 10× per event
→ the list flickers, buttons detach mid-click, and it degrades until the tab is reloaded.

**This is your *"the start button shows Starting and doesn't respond"* bug and your
*"sometimes I see console sometimes I don't"* bug.**

**Fix:** register all socket handlers **once** at app init; `setupProgressTracking` should only
prepare DOM. Check whether `socketService.on` even supports `off` — it likely doesn't.

---

### B4 — The whole chapter list is destroyed and rebuilt on every event
**`main.js:229 renderChapters()`** sets `list.innerHTML = …` for **all** chapters and re-binds
**7 sets of listeners**. Called from `markChapterComplete`, `markChapterError`, after every delete…

Consequences: scroll jumps to top mid-conversion, an open `<select>` closes, checkbox state
survives only because it's mirrored in `state`, and with 5,000 chapters it's a multi-hundred-ms
freeze on **every log-adjacent event**.

**Fix:** patch the single affected row. Long-term: virtualised list + component with a `render(row)`.

---

### B5 — Next/Prev plays the wrong thing
**`main.js:1279 playAudioAtIndex(index)`** indexes into `state.audioFiles`, which comes from
`getAudioFilesByBookId` ordered `is_merged DESC, created_at DESC` — i.e. **newest-conversion
first**, not chapter order.

So `Next chapter` plays "whichever chapter I happened to convert just before this one", and
`ended → next` autoplay walks backwards through your conversion history. Also
`setText('#player-book-title', state.chapters[0].title)` puts the **first chapter's title**
where the **book title** belongs (`main.js:1310`).

**Fix:** a real playlist array (chapter order, one selected version per chapter) separate from the raw audio table.

---

### B6 — Version dropdown ↔ Delete are wired to stale indices
**`main.js:402-451`** — `data-audio-index` is an index into `state.audioFiles`. After a delete,
`state.audioFiles` is refetched and re-indexed, but the DOM `data-audio-index` on *other* rows
was rendered from the old array. Between the `await api.deleteAudioFile()` and the re-render
there is a window where clicking Play plays the wrong version, and clicking 🗑 **deletes the
wrong version**.

**Fix:** use `data-audio-id` (a UUID) everywhere. Never index-based identity in the DOM.

---

### B7 — "Download Complete Audiobook" does nothing
**`index.html:264`** `<button id="btn-download-all">` — grep the whole of `main.js`: **no listener
is ever attached.** The headline deliverable of the app is a dead button. The `#section-results`
block that contains it is also `hidden` and only revealed by `loadResults()` after a batch job.

**Fix:** wire it to the merged file; better, replace with M4B export.

---

### B8 — Hard-coded POSIX path separator breaks downloads on Windows
**`main.js:527`**
```js
const fileName = a.file_path ? a.file_path.split('/').pop() : '';
const audioUrl = `/data/audio/${state.currentBookId}/chapters/${fileName}`;
```
On Windows `file_path` is `C:\...\chapters\chapter_013_l8x.mp3` — `split('/')` returns the whole
string, so the `📥 MP3` link in the Versions modal is a broken URL. It also bypasses the API and
assumes a static mount that may not exist.

**Fix:** `<a href="/api/audio/${a.id}/download">`. There is already a correct download route
(`server/routes/audio.js:84`) — use it.

---

### B9 — Books get permanently stuck in `processing`
**`books.js:255`** sets `status: 'processing'` when a job starts. It is reset to `'parsed'` only
on **cancel**. If the server restarts, or the job throws outside the try, the book stays
`processing` forever — and **`books.js:238`** rejects new generation for non-ready books.

**This is your *"Showing error book is not ready for generation, why?"*.**
(Note the check tests `'uploading'|'parsing'` — so `processing` actually passes — but
`updateBook(status:'processing')` combined with the library card showing `processing` forever
is still wrong, and any restart leaves zombie jobs that no longer exist in memory yet are
`processing` in DB, so cancel finds nothing to cancel.)

**Fix:** derive book status from live jobs; on boot, mark orphaned `processing` jobs `interrupted`
and offer Resume. Add a manual "Reset status".

---

### B10 — No virtualisation
You are converting a 5,000-chapter novel. `renderChapters` builds a ~5,000-element DOM with
~35,000 nodes and 7 listener sets, from a template string, synchronously. Every socket event
does it again (B4).

**Fix:** virtual scroller (or `content-visibility: auto` as a 1-line stopgap).

---

## 🟠 HIGH — quality & trust

### B11 — Chunking is character-based, so Groq 413s are inevitable
`translateInChunks(text, 'hi', 4000, …)` (`jobProcessor.js:105`) and `config.ttsChunkMaxChars`.
Your reported error: `Limit 6000 TPM, Requested 9459`. 4000 chars of English ≈ 1000 tokens,
but the prompt preamble is ~400 tokens and `max_tokens: 2000` counts toward TPM — and multiple
chunks fire back-to-back with **no pacing at all**.

Also **`translator.js:113` `max_tokens: 2000` is fixed** — a 4,000-character chunk retold in
Hinglish frequently exceeds that, so chapters are **silently truncated mid-sentence** and the
user never learns why the audio ends abruptly.

**Fix:** token-based budgeting, dynamic `max_tokens`, token-bucket limiter, `retry-after` backoff.

### B12 — Fallback chain is wrong on three counts
**`translator.js:45-51`**
1. `mixtral-8x7b-32768` is **decommissioned** on Groq — that entry is guaranteed to fail.
2. On a **rate-limit** error, switching models is pointless: TPM is an **org-wide** budget.
   The correct action is *wait and retry the same model*.
3. The Google fallback (`translator.js:126`) silently produces **literal Devanagari Hindi with
   no style**, and is stored with `translation_style: job.translation_style` — so a
   Google-translated version is **labelled "Web Novel Hinglish"** in the UI. The badge lies.

**Fix:** live model list; classify errors (rate-limit → backoff, decommissioned → swap,
auth → stop); make Google opt-in; store `provider_status` and render a `⚠ Literal (Google)` badge.

### B13 — Chapter errors are in-memory only
`state.chapterErrors` (`main.js:27`) — reload the page and every failure disappears.
`chapters.error_message` **is** written server-side (`jobProcessor.js:175`) but is **never
returned** by `GET /api/books/:id` (`books.js:99-107` omits it).

**This is your *"I don't see the errors in UI... earlier it was correctly there"*.**

**Fix:** return `error_message` and `status`, render the persistent error box from it, add Retry.

### B14 — Karaoke highlighting is a proportional guess
**`main.js:1381`**
```js
const paraIdx = Math.floor((cueIdx / state.vttCues.length) * allParas.length);
```
Cues are not uniformly distributed across paragraphs, so it drifts. And when the reader shows
**English** while the audio speaks **Hinglish**, the paragraph counts differ entirely — the
highlight is meaningless. Same guess is used for click-to-seek (`main.js:775`).

**This is why you said *"I can't see that"* about the highlighting feature.**

**Fix:** real alignment map (spec §7.2).

### B15 — `startSubtitleSync` rAF loop leaks and never stops
**`main.js:1348`** — `tick()` returns early when `!audio.src` **without** re-scheduling, but
every `playAudioAtIndex` starts a fresh loop; the previous one is only cancelled if the fetch
resolves. Pausing does not stop it, so a rAF runs at 60 fps forever, calling `$$()` (a fresh
`querySelectorAll`) on every frame.

**Fix:** drive from the `timeupdate` event, or cancel on pause/ended/close.

### B16 — Groq API key is stored in plaintext and echoed back
`generation_jobs.groq_api_key TEXT` (`database.js` migration), sent from the client on every
request, and `GET /api/books/:id/jobs` (`books.js:186`) returns **the whole job row including
the key**. It is also logged into the job record forever.

**Fix:** store server-side in settings, encrypted; never persist per job; strip from all responses.

### B17 — Sanitised filenames destroy non-ASCII titles
**`jobProcessor.js:200`** `book.title.replace(/[^a-zA-Z0-9]/g, '_')` — a Hindi or CJK book title
becomes `________`. Also no collision handling.

### B18 — Silent chapter dropping
**`epubParser.js:65`** skips any section under 50 characters and **does not tell the user**.
Chapter indices then no longer match the book's real chapter numbers — which makes your
*"search by chapter number"* feature quietly wrong.

**Fix:** keep them with `status='skipped_short'`, show them greyed with the reason, and let the user include them.

### B19 — `utils/hash.js` exists but is never used
Duplicate uploads create duplicate books, duplicate parses, duplicate disk usage. The
infrastructure for content-hash dedupe is already written and dead.

### B20 — No dependency pre-flight
`edge-tts` and `ffmpeg`/`ffprobe` are invoked via `execFile` with no startup check
(`ttsEngine.js:33, 116, 133`). If they're missing, **every chapter fails individually** with a
cryptic ENOENT, after the user has queued 500 of them. `getAudioDuration` swallows the error and
returns `0`, so durations show as `0:00` with no clue why.

### B21 — Cancel doesn't cancel the current chapter
**`jobProcessor.js:55`** checks `cancelledJobs` only at the **top of the chapter loop**. A
50,000-word chapter will finish translating *and* synthesising before the cancel takes effect —
minutes later. There is also no way to cancel a **single** chapter.

### B22 — Concurrency is unbounded
`processJob` is fired per request with no queue (`books.js:262`). Click Convert on 10 rows →
10 concurrent jobs → 10 parallel Groq calls → instant TPM exhaustion → all 10 fail.
**This is a direct cause of the rate-limit errors you saw.**

### B23 — `state.audioFiles` filtering is inconsistent
`loadResults` (`main.js:1170`) and `markChapterComplete` (`main.js:1116`) apply
`.filter(a => !a.is_merged)`; `loadBookFromLibrary` (`main.js:1683`) also filters; but the
delete handlers (`main.js:446`) set `state.audioFiles = data.audioFiles` **unfiltered**.
After a delete, indices shift by the number of merged files → **Play plays the merged
whole-book file instead of the chapter**.

---

## 🟡 MEDIUM — UI/UX defects

### U1 — Two conflicting settings panels
The sidebar and the Convert dialog both define language/voice/style, and
`startSingleChapterGeneration` (`main.js:895`) reads **both**: language/voice/style from the
dialog overrides, but `groqApiKey`/`groqModel` from the **sidebar**. If the sidebar language is
`en`, `#groq-config` is `hidden` — the key input still exists so it works by luck, but the
*style* select is also hidden and `$('#translation-style-select')?.value` is read as a fallback.
**Fragile, invisible coupling.** (Spec §5.4 resolves this.)

### U2 — Filter tabs are styled by direct `style.background` mutation
**`main.js:161-176`** uses `e.target.style.background = …`. Clicking the tab's inner text node
(if one is ever added) breaks it, and it fights the CSS class. Same anti-pattern in
`renderReaderBody` for the reader tabs (`main.js:648`).

### U3 — ~600 lines of inline styles inside template literals
Themes, dark/light readers and responsive breakpoints are impossible to maintain when
`background: var(--bg-tertiary)` is hard-coded into 40 JS string templates. The reader themes
(`sepia`/`light`) will not correctly restyle any of it.

### U4 — Fixed 320px sidebar, `display:flex` inline, no media queries
`index.html:113` — the workspace cannot reflow. On a laptop at 1366px the chapter row has ~700px
for title + 4 badges + 3 buttons, which is exactly why **your chapter titles were being
truncated**. On mobile it's unusable.

### U5 — `#section-chapters` is visible with an empty list on first load
Before an upload the user sees an empty "Chapter Workspace" with settings and a Convert button.
No empty state. (Comment in HTML admits it: *"visible by default to show UI layout"*.)

### U6 — `Select All` checkbox starts `checked` in HTML but state starts empty
`index.html:104` has `checked`, while `state.selectedChapters = new Set()`. The header lies until
`updateSelectAll()` runs.

### U7 — `confirm()` / `alert()` for destructive actions
Native dialogs for deleting audio and books — inconsistent with the rest of the UI, and they
don't state **what** is being deleted or how much disk is freed.

### U8 — No undo anywhere
Deleting an audio version or a book is instant and permanent. A 5-second "Undo" toast (soft
delete) is cheap and prevents real data loss.

### U9 — Logs are prose, not structured
`emitLog(\`[AI Translation] Chapter ${i+1} chunk ${p.current}/${p.total} translated via Groq\`)`.
And the frontend **parses chapter numbers back out of the prose** with a regex
(`main.js:1447` `message.match(/chapter\s+(\d+)/i)`). That is fragile and breaks with a
Hindi/localised message. Emit structured fields.

### U10 — `#audio-chapter-list` is dead UI
Rendered by `renderAudioChapterList()` but its container is permanently `hidden`
(`index.html:258`, class `hidden` with a comment "Removed to avoid duplicate UI"). Dead code
that still runs on every job completion.

### U11 — No voice preview
Choosing between Swara and Madhur for a 40-hour audiobook with no sample is a bad bet.

### U12 — Style names are opaque
`Web Novel / LitRPG (Hinglish)` vs `Casual Storytelling` — you cannot know what you'll get
without converting. Show a sample.

### U13 — Progress section is a separate block far below the list
`#section-progress` is a whole separate section; when it appears the page grows and the chapter
list scrolls away. It should be the right rail (spec §3.1) so list + progress + logs are all
visible at once.

### U14 — Reader has no Devanagari-optimised font
`Georgia, Cambria, Times New Roman, serif` renders Hindi in an ugly system fallback.
Add Noto Serif Devanagari / Mukta.

### U15 — No keyboard shortcuts, no focus management
Modals don't trap focus, `Escape` closes the reader but the Quick Convert modal has no Escape
handler in the keydown block (`main.js:1543` closes only `#chapter-modal` and `#versions-modal`).

### U16 — No reading/listening position memory
Close the tab mid-chapter and you lose your place in both the text and the audio.

### U17 — Toast-only feedback for long operations
5-second toasts for events you may not be looking at. Needs an activity/notification centre.

---

## 🟢 What's genuinely good (keep it)

- Chunked TTS with **VTT timestamp shifting** (`ttsEngine.js:47 shiftVtt`) — that's a neat,
  correct piece of engineering.
- Range-request audio streaming (`audio.js:31`) — proper seeking support.
- Resumable jobs via `completed_chapters` (`jobProcessor.js:65`).
- Version **chips** on the chapter row (language/voice/style/model/date) — exactly the
  transparency you asked for; the concept is right, the data behind it just needs B1 fixed.
- WAL mode + foreign keys + cascade deletes in SQLite.
- Temp-chunk cleanup in a `finally` (`ttsEngine.js:123`).
- Reader typography controls persisted to `localStorage`.

---

## Top 12, if you only do twelve things

| # | Fix | Kills |
|---|---|---|
| 1 | `chapter_scripts` table + `audio_files.script_id` | B1, B2, wrong-badge, custom-script-ignored |
| 2 | Register socket handlers once | B3 — the unresponsive-button bug |
| 3 | Job queue, concurrency 1, token-bucket rate limiter | B22, B11, most Groq failures |
| 4 | Token-aware chunking + dynamic `max_tokens` + `retry-after` backoff | 413/429, silent truncation |
| 5 | Persist logs + `/api/logs` + per-chapter log drawer | your #1 recurring complaint |
| 6 | Persist chapter errors + Retry button | B13 |
| 7 | Row-level patching instead of full re-render (+ virtualisation) | B4, B10, scroll jumps |
| 8 | Use audio **IDs** not array indices in the DOM | B6, B23 — deleting the wrong file |
| 9 | Single Convert dialog as the only entry point | U1, "it converts without asking" |
| 10 | Real alignment map for karaoke | B14 — the feature you never got to see work |
| 11 | Batch estimate + typed confirmation for >100 chapters | the 5,000-chapter accident |
| 12 | Startup check for edge-tts/ffmpeg + orphaned-job recovery | B20, B9 — "not ready for generation" |
