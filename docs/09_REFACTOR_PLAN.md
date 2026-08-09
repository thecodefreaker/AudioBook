# Refactor Plan — Current State → Target Application

> Written after reading every file in `server/` and `src/`.
> This is the plan we agree on **before** any more code is written.

---

## ⚠️ FIRST: the app is broken right now

`jobProcessor.js` imports `translateInChunks` from `translator.js`. I rewrote `translator.js`
and it now exports `retellChapter` instead. **The server will not start.**

```
BROKEN: The requested module './translator.js' does not provide an export named 'translateInChunks'
```

We are mid-migration. Half the new foundation exists but nothing is wired to it:

| New file | Lines | Wired in? |
|---|---|---|
| `database.js` (new schema: `chapter_scripts`, `job_logs`, `book_glossary`, `app_settings`) | 703 | ❌ tables exist, nothing writes to them |
| `translator.js` (token budgeting, live models, backoff) | 482 | ❌ nothing calls it |
| `logBus.js` | ~110 | ❌ never imported |
| `rateLimiter.js` | ~200 | only by translator |
| `prompts.js` (lean v3) | ~330 | only by translator |
| `scriptUtils.js` | ~200 | only by translator |
| `jobProcessor.js` | 244 | ⚠️ **still the OLD one** — broken import |
| `routes/books.js` | 351 | ⚠️ still old |
| `src/main.js` | 1733 | ⚠️ completely untouched |

**Rule for the rest of this work: the app must start and run after every step.**
No more half-migrations.

---

## Part 1 — What the application IS (locked definition)

> A local-first library for **your own books**. You add a book (EPUB today, more formats later),
> and from then on you **own that book in the app**: read it, convert any part of it to speech in
> the language and voice you like, keep every version you make, and pick up wherever you left off.
>
> The conversion must not feel like a translation. It must feel like the book was written in that
> language. And everything the machine does must be visible, cancellable and reversible.

Three things that must always be true:

1. **Natural output.** Hinglish that sounds like a person talking, not a dictionary.
2. **Nothing is destroyed.** Every version you make coexists until *you* delete it.
3. **Nothing is hidden.** Real logs, real errors, real progress, real estimates.

Scalability targets, stated as concrete numbers so they're testable:

- 5,000-chapter book must feel instant to browse.
- Adding a new **language** = adding a config entry, not editing the pipeline.
- Adding a new **input format** (PDF/MOBI/TXT) = writing one parser that returns `{metadata, chapters[]}`.
- Adding a new **TTS provider** = implementing one interface.
- Adding a new **AI provider** = implementing one interface.

---

## Part 2 — Honest inventory of what exists today

### 2.1 Backend — verdict per file

| File | Verdict |
|---|---|
| `epubParser.js` | Works, but silently drops sections < 50 chars, so chapter numbers stop matching the real book. Needs to keep + label them. |
| `ttsEngine.js` | The **best code in the project**. Chunked synthesis + VTT timestamp shifting is genuinely correct. Keep, extend to an interface. |
| `textChunker.js` | Fine, but char-based. Superseded by token-based chunking for AI; still right for TTS. |
| `translator.js` | **New, good, unused.** |
| `jobProcessor.js` | **Old, broken, must be rewritten.** No queue, no stages, cancel only between chapters, writes to the dead `translated_content` column. |
| `database.js` | **New schema is right.** But `getAudioFileByChapterId` still returns only the newest, and nothing writes `chapter_scripts`. |
| `routes/books.js` | Old. Returns `groq_api_key` to the client (security bug). No script/log/glossary/settings routes. |
| `routes/audio.js` | Solid — range streaming and download are correct. |
| `index.js` | No dependency pre-flight, no orphaned-job recovery on boot, no queue bootstrap. |

### 2.2 Frontend — the honest verdict

`src/main.js` is **1,733 lines in one file** with ~600 lines of inline CSS inside template
strings. This is the single biggest source of the "messed up / off" feeling. It is not
salvageable by patching; it needs to be split into components.

### 2.3 Confusing / broken UI — the specific list

These are the "blunders" you asked me to find. Each is a real defect, not a style opinion.

| # | What's wrong | Why it hurts |
|---|---|---|
| C1 | **Two settings panels that disagree.** The sidebar sets language/voice/style; the Convert dialog sets them again. Code reads language from the dialog but the **API key and model from the sidebar**. | You never know which setting actually applied. |
| C2 | **"Saved Custom Script (Ready)" shows when no custom script exists.** `hasTranslation` is true after *any* AI run. | You pick "my script", you get AI text. Exactly what you reported. |
| C3 | **Sidebar hides the style dropdown when language = English**, but code still reads it as a fallback. | Silent, invisible coupling. |
| C4 | **`Select All` is `checked` in HTML but nothing is selected in state.** | The header lies on first load. |
| C5 | **Chapter workspace is visible and empty before any upload**, with a live Convert button. | Looks broken on first run. |
| C6 | **"Download Complete Audiobook" has no click handler at all.** | The headline feature is a dead button. |
| C7 | **Next/Prev walks the raw audio table** (ordered by conversion date), not chapter order. | "Next chapter" plays a random old version. |
| C8 | **Play/Delete use array indices** (`data-audio-index`) that shift after any delete. | You can delete the wrong file. |
| C9 | **Version MP3 link uses `split('/')`** on a Windows path. | Broken download link on your machine. |
| C10 | **Chapter errors live in memory only.** | Reload = errors vanish. You reported this twice. |
| C11 | **Log console is rebuilt per job and never persisted.** | "Sometimes I see console, sometimes I don't." |
| C12 | **Socket handlers re-registered on every conversion.** | After ~10 conversions the UI stutters and buttons stop responding. |
| C13 | **Whole 5,000-row list re-rendered on every progress event.** | Scroll jumps, open dropdowns close, freezes. |
| C14 | **"Pitch" slider is actually a 500 Hz EQ filter.** | The label is a lie. |
| C15 | **No per-chapter cancel; no retry on failure.** | One bad chapter = restart everything. |
| C16 | **No estimate before a batch.** | The 5,000-chapter accident. |
| C17 | **Fixed 320px sidebar, no media queries, `max-width` container.** | Truncated chapter titles; unusable on phone; wasted screen. |
| C18 | **Reader has no Devanagari font.** | Hindi renders in an ugly fallback. |
| C19 | **Progress is a section far below the list.** | You can't watch progress and browse at once. |
| C20 | **`#audio-chapter-list` renders on every job completion but is permanently `hidden`.** | Dead code doing work. |

---

## Part 3 — Target architecture

### 3.1 Backend — provider interfaces (this is what makes it scalable)

```
server/
  core/
    queue.js          ← ONE job queue. Concurrency limits. Pause/resume/cancel per item.
    pipeline.js       ← the 5 named stages, provider-agnostic
    events.js         ← single typed event emitter → socket

  providers/
    input/            epub.js   (+ later: pdf.js, mobi.js, txt.js)   → {metadata, chapters[]}
    ai/               groq.js   (+ later: openai.js, gemini.js, ollama.js)
    tts/              edgeTts.js(+ later: piper.js, azure.js, elevenlabs.js)

  languages/
    index.js          ← language registry: code, name, voices, styles, script
```

Adding Tamil later = one entry in `languages/index.js` + voice IDs. No pipeline changes.

### 3.2 The pipeline — 5 named stages, always

```
PREPARE  → chunk, estimate tokens/time/cost
SCRIPT   → get the text to speak:  custom (verbatim) | AI retell | original
SYNTH    → TTS per chunk (+ word-level VTT)
STITCH   → ffmpeg concat + timestamp shift
INDEX    → save version row, duration, size, sentence alignment map
```

Every stage emits start/progress/end. The UI shows a 5-dot stepper per chapter.

### 3.3 Data model — already correct in the new `database.js`, just needs to be used

`chapter_scripts` is the key table. `audio_files.script_id` points at the exact text that was
spoken. This is what makes versions honest and custom scripts safe.

### 3.4 Frontend — component split

```
src/
  store/index.js          ← one observable store; no scattered globals
  components/
    Workspace.js  ChapterList.js  ChapterRow.js  ConvertDialog.js
    Reader.js  Player.js  LogTerminal.js  QueuePanel.js  Library.js  Settings.js
  styles/tokens.css + per-component CSS   ← zero inline styles in JS
```

---

## Part 4 — Target UI

### 4.1 Four surfaces

```
[ Library ]  [ Workspace ]  [ Activity •3 ]  [ Settings ]
```

- **Library** — your books. Cover, progress ring, duration, disk usage. Add book. Open.
- **Workspace** — one book: chapters, convert, read, listen.
- **Activity** — the queue + the persistent log terminal. (Fixes C11.)
- **Settings** — API keys, defaults, prompt editor, glossary, storage.
- **Player** — persistent bottom bar, survives navigation.

### 4.2 Workspace layout (full width, responsive)

```
┌────────────┬────────────────────────────────────┬──────────────┐
│ BOOK RAIL  │ CHAPTER LIST (hero, virtualised)   │ ACTIVITY RAIL│
│ 280px      │                                    │ 320px        │
│            │ 🔍 search │ sort ▾ │ tabs+counts    │ now playing  │
│ cover      │ ─────────────────────────────────  │ live log     │
│ progress   │ ▸ virtualised rows                 │ queue        │
│ preset ▸   │                                    │              │
└────────────┴────────────────────────────────────┴──────────────┘
  <1200px: activity rail → drawer
  <900px : single column, rails → bottom sheets
```

Fixes C17, C19.

### 4.3 The chapter row

```
☐ #14  The System Awakens                        [▶ ▾] [＋] [👁] [⋯]
       3,412 words · ~14 min read · ~19 min audio
       🌐 Hinglish  🎤 Madhur  ✍️ Novel  📅 2h ago   [3 versions ▾]
       ●━●━●━○━○  Synthesizing 7/12 · ETA 1m40s          [Cancel]
       ❯ 23:04:11 [tts] chunk 7/12 ok (41.2s)
```

Every element addresses a defect: split play button (C7/C8), stage stepper, per-chapter cancel
(C15), persistent last-log line (C11), IDs not indices (C8).

### 4.4 One Convert dialog — the only way to start a job

Fixes C1, C2, C3, C16. Pre-filled from the preset, always explicit:

```
Convert — Chapter 14                                  [×]
Scope    ● This chapter    ○ 12 selected
Output   [ English ][ Hinglish ]
Script   ◉ AI retell  ○ My script (saved 2d ago, 4.1k) [view]  ○ Original
Style    [📖 Novel][💬 Casual][🎭 Cinematic][🎓 Formal][🧸 Kids]   ← cards with samples
Voice    [ Madhur ▾ ] [▶ preview]     Speed [──●──] 1.0×
Engine   Groq · llama-3.3-70b ▾   ● key ok · 5,240/6,000 TPM
─────────────────────────────────────────────────────────
Creates a NEW version. Your 3 existing versions are kept.
Estimated: 12 chunks · ~9.1k tokens · ~3 min
                                  [Cancel] [Start]
```

For >100 chapters the button becomes a typed confirmation. Fixes C16.

### 4.5 Reader

Tabs: **Original** | **Translated (version ▾)** | **Side-by-side** | **Edit script**.
Devanagari font (C18), typography controls, and **real sentence highlighting** driven by the
alignment map — not the current proportional guess.

---

## Part 5 — Translation approach (settled)

Your ChatGPT instruction **is** the prompt. Current overhead: **313 tokens**.
No banned-word lists, no forced glossary, no hand-rolled transliterator (deleted).

Kept only because we're forced to chunk (TPM limit) where ChatGPT wasn't:
- **Continuity tail** — appears only when a chapter is actually split.
- **Glossary** — opt-in, off by default.

On model strength: you may well be right that 70B is close enough. **I don't know without
measuring.** So the plan includes a "Compare" tool: run one chapter through 2 models/styles and
show the outputs side by side. Then we decide with evidence rather than opinion.

---

## Part 6 — Execution order (app runs after every step)

| Step | Work | Outcome |
|---|---|---|
| **0** | **Unbreak**: rewrite `jobProcessor` onto the new translator + scripts + logBus | Server starts; conversions write real version rows |
| **1** | `core/queue.js` + boot recovery + dependency pre-flight | No more 10 parallel jobs; no stuck books |
| **2** | Routes: scripts, logs, glossary, settings, models, estimate; strip API key from responses | Backend API complete & secure |
| **3** | Provider interfaces (input/ai/tts) + language registry | Adding a language/format/voice is config |
| **4** | Frontend skeleton: store, router, 4 surfaces, component split, CSS tokens | Foundation for all UI fixes |
| **5** | Chapter list: virtualised, row patching, split-button, per-chapter cancel/retry | C7, C8, C12, C13, C15 |
| **6** | Convert dialog + preset + estimate + confirmation | C1–C4, C16 |
| **7** | Activity surface: queue + persistent log terminal + per-chapter drawer | C10, C11 |
| **8** | Player rebuild: playlist, Media Session, resume, honest labels | C6, C7, C14, C20 |
| **9** | Reader: alignment-map highlighting, side-by-side, Devanagari font | C18 |
| **10** | Library + Settings + storage + M4B export | C5, C6 |
| **11** | Responsive + a11y + keyboard | C17 |

---

## Questions before I continue

1. **Existing data** — is the SQLite DB / any converted audio worth preserving, or may I wipe
   `data/` and start clean? (Clean is much simpler; I'll write a migration if you need it.)

2. **Step 0 scope** — shall I do Steps 0–3 (backend solid and runnable) in one go before touching
   the frontend? I recommend yes: the frontend rewrite depends on the final API shape.

3. **Frontend approach** — vanilla JS components (no new deps, matches current stack) vs. adding
   a small library like Preact + Signals (~4KB, much less hand-written DOM code).
   I lean **vanilla + a tiny reactive store**, since you may copy this project as text between
   machines and fewer deps means fewer surprises. Your call.

4. **Groq key** — should it move to Settings (entered once, stored server-side, never sent from
   the browser again)? Recommended; it also fixes the key-leak bug.

5. **Is anything in Part 1's definition wrong or missing?** That paragraph drives every
   decision, so I'd rather correct it now than build on a wrong assumption.
