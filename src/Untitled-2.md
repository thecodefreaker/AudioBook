# Audiobook AI Workspace — Full Audit & Implementation Plan

> **Method note.** Every claim below was verified by reading the actual source:
> `server/models/database.js`, `server/core/pipeline.js`, `server/routes/books.js`,
> `server/services/translator.js`, `server/utils/textChunker.js`,
> `src/main.js`, `src/components/chapterList.js`, `src/services/settings.js`,
> `src/services/readerSync.js`, `src/index.html`.
> Where the brief's assumption turned out to be wrong, that is stated plainly
> rather than agreed with. The original brief is preserved at
> `docs/08_AUDIT_BRIEF_ORIGINAL.md`.

---

## 1. Audit of the Current Convert Flow

There are **four** entry points. All four now read narration settings from one
store (`getConversionSettings()` in `src/services/settings.js`) — this was
previously read off whichever `<select>` was nearest, which is fixed.

| # | Entry point | Code path | What actually happens on click |
|---|---|---|---|
| 1 | Sidebar "Convert" (`#btn-generate`) | `startGeneration()` | Converts the **current selection**. If nothing is selected it falls back to all chapters. Never opens a dialog. |
| 2 | Row "Convert" (split-button main) | `onConvert` → `startSingleChapterGeneration(idx, chapterOverrides[idx] ?? {})` | **Fires instantly.** No dialog. Uses book defaults unless that chapter has a session override. |
| 3 | Row "⚙" (split-button side) | `onConvertOptions` → `openQuickConvertModal(idx)` | Opens the dialog seeded with `{...defaults, ...override}`. Saving stores a per-chapter override. |
| 4 | Selection bar "Convert selected" (`#sel-generate`) | `startGeneration()` | **Identical handler to #1.** Two buttons, one function. |
| 5 | Listen pane "Convert this chapter" (`#listen-convert`) | `openQuickConvertModal(readerChapterIdx)` | Opens the dialog. |

**Answers to the specific questions asked:**

- **Does row convert fire instantly while another opens a modal?** Yes. Row-main
  fires immediately; row-⚙ and the listen-pane button open the modal. This is
  intentional (fast path vs. considered path) but it is **only discoverable if
  you notice the split seam**. It is the single biggest source of confusion.
- **Are settings discoverable?** Partially. The narration form is
  `hidden` behind `#btn-toggle-narration` and starts collapsed.
- **Are the three consistent?** Settings-wise yes (single store). *Behaviour*-wise
  no: two fire instantly, one opens a dialog.
- **Does batch ignore per-chapter overrides?** **Yes.** `startGeneration()`
  collects `chapters.filter(i => chapterOverrides[i])` and shows a `confirm()`
  warning that the exceptions **will not be used**, then converts everything
  with book defaults. Honest, but it dead-ends the user.
- **Does the UI say whether it translates, generates audio, or both?** **No.**
  Every path says "Convert". The backend now supports `action`
  (`both|script|audio`) but **no UI surfaces it**.
- **Sidebar vs. selection bar are literal duplicates** — `#btn-generate` and
  `#sel-generate` bind to the same `startGeneration`.

### Conclusion: **redesign + rename**, not merge

"Convert" is doing the work of six different verbs. The fix is not to delete
entry points — each has a legitimate context — but to make every one of them
**name its action and its scope**. Specifically: delete the duplicate, keep the
split button but label the two halves, and put the action verb on the button.

---

## 2. The Correct Convert Model

**Current support (verified):**

| Action | Backend | UI |
|---|---|---|
| Translate text only | ✅ `action:'script'` | ❌ none |
| Generate audio only (existing script) | ✅ `action:'audio'` + `scriptId` | ❌ none |
| Translate + audio | ✅ `action:'both'` | ✅ every button |
| Regenerate AI script | ✅ (re-run `both`/`script`) | ⚠️ implicit |
| Audio from existing AI script | ✅ `speakScript()` | ❌ none |
| Audio from custom script | ✅ `scriptSource:'custom'` | ✅ Save & generate |
| Audio from original text | ✅ `scriptSource:'original'` | ✅ dialog option |

**The backend model is correct and complete. The UI exposes roughly half of it.**

### Recommended vocabulary — retire the bare word "Convert"

| Say this | Not this | Where |
|---|---|---|
| **Translate text** | Convert | Reader, row menu |
| **Generate audio** | Convert | Reader, row, player |
| **Translate + generate audio** | Convert | Primary button |
| **Regenerate** | Convert again | Rows with existing audio |

### The rule for dialog vs. instant

> **Open the dialog the first time for a book. Never again unless asked.**

Replace the split-button-seam guess with an explicit, learnable rule:

1. First conversion in a book → dialog opens, showing source / language / voice
   / style / estimated time / what it will produce.
2. Dialog carries **"Use these settings for this book — don't ask again."**
3. Once ticked, row buttons fire instantly. The ⚙ remains for exceptions.
4. A persistent one-line **settings summary** sits above the chapter list:
   `Hindi · Aria · Novel · AI script — Change`. This is the missing piece: the
   defaults are currently invisible unless you open a dialog.

---

## 3. Text / Script / Audio Architecture — **already correct**

The brief assumed this needed building. It does not. Verified:

- **Original text** → `chapters.text_content`.
- **AI script** → `chapter_scripts` row, `source='ai'`.
- **Custom script** → `chapter_scripts` row, `source='custom'`.
- **Original-as-script** → `chapter_scripts` row, `source='original'`.
- **Multiple scripts per chapter** → supported; `getScriptsByChapterId()`
  returns all, newest first.
- **Audio → script link** → `audio_files.script_id`, joined in `AUDIO_SELECT`
  so every audio row reports `script_source`, `script_kind`, `script_provider`.
- **Accidental overwrite** → prevented. `resolveScript()` is documented
  *"NEVER mutates an existing script of a different source"*, and custom scripts
  are matched by `source='custom'` before any AI branch runs.
- **`spoken_content` vs `content`** — an important distinction the brief missed:
  `content` is what you *read*, `spoken_content` is what was *sent to TTS* after
  transliteration. Any compare view must show `content`.

### Legacy `translated_content` — the one real debt

`chapters.translated_content` still exists as a column. It is **no longer
written** (pipeline writes only to `chapter_scripts`) and was backfilled once
under the `migrated_scripts_v1` flag. It is dead weight that reads as live
schema. **Recommendation: leave the column, but never read it.** Dropping it
in SQLite requires a table rebuild and buys nothing.

> **Verdict: no schema change needed for the script model.** The rule *"audio
> must always point to the exact script used"* is already enforced.

---

## 4. Text-Only Translation

**Backend: done.** `action:'script'` returns after the SCRIPT stage, emits
`chapter:complete` with `scriptOnly:true`, skips the ffmpeg preflight and the
TTS time estimate. `api.translateOnly()` exists.

**Frontend: nothing calls it.** This is the single highest-value gap.

---

## 5. Reading Mode & Script Comparison

Current tabs: **Original · Translated · My script** (`#reader-tab-*`).

| Capability | State |
|---|---|
| Original view | ✅ |
| AI script view | ⚠️ "Translated" tab shows custom-script-first, falling back to AI — so it is **mislabelled**; it is not necessarily the AI's text |
| Custom script view | ✅ opens editor directly |
| Comparison view | ❌ |
| Playback in reader | ✅ listen pane |
| Current narration settings visible | ❌ |
| Translate text action | ❌ |
| Generate audio action | ⚠️ "Convert this chapter" (ambiguous) |
| Which script made the current audio | ❌ (data exists, unused) |

**The `translatedContent` mislabel is a correctness bug**, not cosmetics: the
route prefers `custom` over `ai`, so a user comparing "AI vs mine" can be shown
their own text in the AI tab.

### Recommended reader layout

Tabs: **Original · AI script · My script · Compare**

- Splitting "Translated" into *AI script* and *My script* removes the mislabel
  and makes the compare workflow legible.
- **AI script** empty state = the natural home for **Translate text**.
- **Compare** = two dropdowns (left/right) + synced scroll. Two panes, not
  three: three-way is genuinely too dense at reading font size, and every
  pairing you want is reachable by changing a dropdown. Keep it as a tab you
  opt into, so reading stays peaceful.

---

## 6. Custom Script Flow — mostly fixed

The extra popup layer is **already removed**: `#reader-tab-edit` calls
`openScriptEditor(idx)` directly and focuses the textarea. **Paste from
clipboard** exists with the exact `navigator.clipboard.readText()` fallback
*"Press Ctrl+V to paste your script here."*; `Ctrl/Cmd+S` saves; **Save &
generate audio** pins `scriptSource:'custom'`.

**Remaining gap:** the DB supports many custom scripts per chapter, but
`getCustomScript()` returns only the newest, and the UI shows one. **Keep the
simple version.** One active custom script per chapter is the right first
implementation; multi-version custom scripts is a power feature with no current
demand and real UI cost.

---

## 7. Audio Player & Listening Pane

- Persistent bottom dock ✅ (`index.html` DOCK section, present in every state).
- Playback survives navigation ✅ (single `#audio-element`, never re-parented).
- Seek bar, current/total time ✅.
- Prev/Next ✅ and **correct** — `playbackOrder()` sorts by chapter index, not
  conversion time.
- Speed ✅ with presets + custom; **now re-applied on `loadedmetadata`**, which
  fixes the reset-on-chapter-change bug (the cause was `src` assignment
  resetting `playbackRate`, not missing persistence).
- Pitch ✅ now persisted per book with a global default.
- **"Make default"** ✅ added; clears the book override so the new default is
  actually audible.
- **Missing:** version selector, script source, voice, download, regenerate,
  autoplay toggle in the player; the listen pane shows Voice/Duration/Version as
  static text with no way to switch.

**Recommended split** (matches the brief):
bottom dock = transport; reader side pane = chapter-specific management
(version switch, script source, download, regenerate); row button = quick play.

---

## 8. Text ↔ Audio Sync — **already good**

`alignment_json` is computed per audio file by `buildAlignment()`, walking real
VTT cues by character length, with an honest `approximate: true` flag when no
word timings exist. `readerSync.js` reads the *same table* in both directions,
so highlight and click-to-seek can never disagree. Follow mode is a toggle and
yields to manual scrolling.

**No work needed.** Only surface `statusText` more prominently.

---

## 9. Speed & Pitch Persistence — **done**

Global default + per-book override for both, "Make default" in the player,
re-applied on book switch and track load. Remaining nicety: an explicit
"Apply to this book" is unnecessary — setting a value *while a book is open*
already means exactly that.

---

## 10. Batch Conversion — the main remaining gap

Currently: one job, book defaults, `confirm()` warning that overrides are
ignored. The recommendation in the brief is correct — **group by effective
settings and create one job per group** — and the backend already supports it,
since each `POST /convert` is independent. Show the grouping summary before
starting, exactly as the brief describes.

---

## 11. Chapter List, Tabs, Sorting, Pagination — **healthy**

- Search matches title **and** 1-based chapter number.
- Filter/search/sort funnel into `rerenderFromTop()` which **resets to page 1**. ✅
- Pagination is `chaptersPerPage` (default 50), computed **after** filtering, so
  each tab has its own page count. ✅
- Pager label already names the range:
  `1–50 of 200 · page 1 of 4`. ✅
- Out-of-range page is clamped, so narrowing a search cannot show a blank list. ✅
- Tabs are **All / Ready / Converting**. **No "Failed" tab** despite
  `state.chapterErrors` being tracked and rendered per row.

**Row noise:** rows are state-adaptive (unconverted shows words + reading time;
converted shows duration + voice) and secondary actions are `.on-hover`. This is
already restrained. **No redesign needed** — add the Failed tab, nothing more.

---

## 12. Previous / Next Behaviour — **already correct**

`playbackOrder()` sorts by chapter index. `ended` advances through that order.
This satisfies the default rule. Queue-follows-selection is a *nice-to-have*
that would need an explicit queue concept; not worth it yet.

---

## 13. Job Flow, Logs, Progress, Errors

**Strong:** per-chapter cancellation without killing the job; one chapter
failing never kills the batch; `completed_chapters`/`failed_chapters` persisted;
orphaned `processing`/`queued` jobs self-heal to `interrupted` on boot;
partial failures reported honestly (`N converted, M failed`); logs deduplicated.

**Gaps:**
- `status: 'interrupted'` is set on boot but **no UI offers Resume** — the
  self-heal is invisible.
- `retryJob` exists in `api.js` but **nothing calls it**.
- Errors don't distinguish *translation failed* from *TTS failed*, so the
  offered recovery can't be specific.

---

## 14. Chunking Strategy — **two chunkers, both correct, for different reasons**

This is the part of the system most worth understanding, and it is already
right.

### Translation: `chunkByTokens()` in `translator.js`
- Sized in **tokens, not characters** — deliberately, because character sizing
  caused real HTTP 413s (*"Requested 9459"*).
- Budget computed from your **TPM rate limit** minus prompt overhead
  (`computeChunkBudget({ tpmLimit, promptOverheadTokens: 700 })`).
- Splits at **paragraph** first, **sentence** second.
- Carries **continuity** (the previous chunk's tail) and the **glossary**, so
  names and tone survive across boundaries. This is why translation chunks must
  be larger than TTS chunks — context is the product.
- On `finish_reason=length` or a 413, it **halves the chunk and recurses**.
- Rate limits **wait and retry the same model** rather than downgrading.

### TTS: `chunkText()` in `textChunker.js`
- Sized in **characters** (`config.ttsChunkMaxChars`, default 4500) because
  that is what the provider limits.
- Paragraph → sentence → forced character split, in that order.
- Sentence regex handles the **Hindi danda `।`** as well as `.!?` — correct for
  Devanagari output.
- Audio chunks are stitched by `synthesizeChunked`, and VTT timestamps are
  shifted during STITCH.

**Both preserve paragraph boundaries and avoid mid-sentence splits unless a
single sentence exceeds the limit.** Progress is logged per chunk
(`TTS chunk 3/7 done`).

**One honest gap:** chunk identity is **not persisted**. Retry is in-memory and
per-attempt; a chunk that failed after the job ended cannot be retried
individually. Given the halving-recursion and backoff already in place, this is
a **debuggability** gap, not a reliability one. **Recommendation: do not add a
chunks table.** Log chunk index + char range on failure instead — 95% of the
diagnostic value at none of the schema cost.

---

## 15. Library → Workspace → Reader Journey

| Stage | Primary action | Gap to fix |
|---|---|---|
| Home / empty | Add book | — |
| Upload → parse | (narrated stages) | — |
| Workspace | Convert selection | Defaults invisible; two identical Convert buttons |
| Chapter list | Play / Convert | No Failed tab |
| Reader | Read | No Translate-text; no settings shown; AI tab mislabelled |
| Compare | — | Doesn't exist |
| Listen | Play | No version/voice/download/regenerate in pane |
| Batch | Convert selected | Overrides discarded |
| Export | Build audiobook | Staleness already detected ✅ |

---

# Deliverables

## A. Current State Summary
Backend architecture is **sound and ahead of the UI**: scripts are versioned and
never overwritten, audio is provably linked to its script, chunking is
context-aware in both stages, jobs are cancellable per chapter and self-heal on
restart, and alignment supports real karaoke sync. The frontend exposes roughly
half of this and describes all of it with one word: "Convert".

## B. UX Problems Found
1. "Convert" names six different actions.
2. Sidebar and selection-bar Convert are literal duplicates.
3. Row-main fires instantly, row-⚙ opens a dialog — discoverable only by the seam.
4. Narration defaults are invisible outside a dialog.
5. No text-only translation anywhere in the UI.
6. "Translated" tab may show your own script — mislabelled.
7. No comparison view.
8. Batch silently discards per-chapter overrides.
9. Listen pane is read-only: no version switch, download, or regenerate.
10. No Failed tab despite errors being tracked.
11. Interrupted jobs recover invisibly; no Resume, no Retry.

## C. Technical Problems Found
1. `chapters.translated_content` is dead schema.
2. `/content` prefers custom over AI for `translatedContent` — wrong for compare.
3. `retryJob` API is unused.
4. Errors don't carry a stage (`script` vs `synth`), so recovery can't be specific.
5. Chunk identity not persisted (debuggability only).

## D. Recommended Product Model
```
Book ─┬─ Chapter ─┬─ Original text        (chapters.text_content)
      │           ├─ Script[]             (chapter_scripts: ai | custom | original)
      │           │    └─ content / spoken_content
      │           └─ AudioVersion[]       (audio_files → script_id → Script)
      ├─ Job      (action: both|script|audio, per-chapter progress)
      ├─ Log      (job_logs, per chapter + stage)
      └─ Export   (merged audiobook, staleness-aware)
```
No schema change required. **Active script** = the one a given audio row points
at, which the DB already records.

## E–F. Recommended UI & Backend Flow
Covered in sections 2, 5, 7, 10 above. Backend flows for all three actions are
implemented; the work is UI.

## G. Schema / API Changes
**None required.** Optional, low-cost:
- `/content` → return `aiContent` and `customContent` separately.
- Error payloads → include `stage: 'script' | 'synth'`.
- `/jobs?status=interrupted` → so the UI can offer Resume.

---

## H. Implementation TODO

### JOB 1 — Name the action, kill the duplicate ⭐ MUST
**Goal:** the user always knows what a button will produce.
**Files:** `chapterList.js`, `index.html`, `main.js`, `components.css`
**API:** none
**Behaviour:** remove `#btn-generate` **or** `#sel-generate` (keep the selection
bar). Relabel to **"Translate + generate audio"**. Add a persistent settings
summary line (`Hindi · Aria · Novel · AI script — Change`). Add
*"Use these settings for this book — don't ask again"* to the dialog; until
ticked, the row-main button opens the dialog instead of firing.
**Acceptance:** no two buttons run the same function; every convert button names
its output; defaults readable without opening a dialog.

### JOB 2 — Text-only translation in the reader ⭐ MUST
**Goal:** review the AI's text before spending TTS time.
**Files:** `main.js` (reader), `index.html`
**API:** `api.translateOnly()` — exists.
**Behaviour:** split "Translated" into **AI script** and **My script**. AI tab
empty state → **Translate text**. On `chapter:complete` with `scriptOnly`,
refresh the tab in place. Add **Generate audio from this script** →
`api.speakScript(bookId, idx, scriptId)`.
**Acceptance:** translating produces text and **no** audio; audio generated
afterwards reports the same `scriptId`.

### JOB 3 — Fix the AI/custom mislabel ⭐ MUST
**Files:** `server/routes/books.js` (`/content`), reader render
**Behaviour:** return `aiContent` + `customContent` separately; each tab shows
its own source.
**Acceptance:** a chapter with both scripts shows different text in each tab.

### JOB 4 — Batch grouping ⭐ MUST
**Files:** `main.js` (`startGeneration`)
**Behaviour:** compute effective settings per chapter, group identical ones,
POST one job per group, and show the summary *"This batch will create 3 jobs
because the selected chapters use different settings"* before starting.
**Acceptance:** overrides are honoured; no silent discard.

### JOB 5 — Listen pane controls 🔸 SHOULD
**Files:** `index.html`, `main.js`
**Behaviour:** version selector, script source + voice line, Download,
Regenerate, autoplay toggle. Switching version reloads audio **and** alignment.
**Acceptance:** everything about the playing chapter is actionable without
leaving the reader.

### JOB 6 — Failed tab, Retry, Resume 🔸 SHOULD
**Files:** `chapterList.js`, `main.js`, `books.js`
**API:** include `stage` in errors; expose interrupted jobs.
**Behaviour:** Failed tab from `state.chapterErrors`. Translation failure →
Retry / change settings / paste script / logs. TTS failure → Retry / change
voice / logs. Interrupted job → Resume banner calling `retryJob`.
**Acceptance:** every failure offers a next step naming its cause.

### JOB 7 — Compare tab 🔹 LATER
Two panes, two dropdowns, synced scroll. Opt-in tab only.

### JOB 8 — Chunk diagnostics 🔹 LATER
Log chunk index + char range on failure. **No schema change.**

### Testing checklist
- [ ] Translate-only creates a script, zero audio rows.
- [ ] `speakScript` audio has the exact `scriptId` requested.
- [ ] AI run never mutates a custom script.
- [ ] Batch with mixed overrides creates the announced number of jobs.
- [ ] Speed/pitch survive chapter change, book switch, and app restart.
- [ ] "Make default" clears the book override.
- [ ] Next/Prev follow chapter order under a name-sorted list.
- [ ] Filter/search resets to page 1; each tab pages independently.
- [ ] Cancelling one chapter leaves the rest running.
- [ ] Clipboard-blocked browser shows the Ctrl+V fallback.

---

## I. Priority Plan

**Must implement now** — Jobs 1–4. Together these close the ambiguity of
"Convert", unlock the compare workflow you actually want, and stop batch from
discarding user intent. All four are frontend-only except one small route change.

**Should implement next** — Jobs 5–6. Player completeness and honest error
recovery.

**Nice to have later** — Jobs 7–8, and multi-version custom scripts (only if
one active script ever proves limiting).

**Explicitly not doing:** dropping `translated_content` (rebuild cost, no gain);
a chunks table (logging gives the same diagnostic value); three-way compare
(too dense); queue-follows-selection for Prev/Next (needs a queue concept that
does not exist).
