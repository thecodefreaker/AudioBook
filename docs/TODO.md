# TODO — conversion, settings and batch model

Status of the redesign described in the audit. This file is the single list of
what is done, what was deliberately deferred, and why.

---

## Done

### Settings model (three levels)
- `src/services/settings.js` stores level 1 (global) and level 2 (`bookPresets`).
- Level 3 (chapter overrides) is session-scoped and now lives on
  `state.chapterOverrides`, so the chapter list can render it without importing
  from `main.js`.
- `effectiveSettingsFor(idx)` is the **only** definition of resolution order:
  `chapter override > book preset > global default`. The row button, the reader
  and the batch path all call it, which is what previously let them disagree.
- `settingsKey()` defines when two chapters are the same job: language, voice,
  style, script source, **action and scriptId**.

### First-use dialog / "don't ask again"
- A row's quick action opens the dialog while `getQuickActionAllowed(bookId)`
  is false; after agreement it fires directly.
- The dialog states action, scope, source, language, voice, style and whether
  audio will be produced; the start button is labelled with what it does.
- "Use these settings as this book's default" writes the book preset and
  refreshes the summary above the chapter list.
- "Use these settings for this book and don't ask again" grants the quick
  action, and implies saving the preset (a quick action needs settings to fall
  back on).
- The gear / Change action is always available, so exceptions never require
  undoing the agreement.

### Batch
- `resolveBatchPlan()` groups by effective settings; one group starts without
  ceremony, several open the conflict dialog.
- Per-chapter mode: one job per group, every exception preserved.
- Uniform mode: language, voice, style, source and action chosen once, applied
  to the batch only, with an opt-in "save as this book's default".
- "Remember my batch preference for this book" persists via `setBatchMode()`;
  unticking forgets it, so it stays reversible from the same dialog.
- The summary states the job count and which chapters are in each group before
  the button is pressed.
- Chapter overrides are never deleted by a batch — only ignored for that run,
  and the dialog says so.

### Job A — pinned script ids  ✅
- Reader shows a toolbar above each script: what it is, when it was made, and
  **"Generate audio from this script"**, which sends that exact `scriptId`.
- The dialog's "Generate audio only" no longer silently ran a full
  translate+audio job; it now resolves the newest script of the chosen source
  and pins it, or fails clearly when there is none.
- `startSingleChapterGeneration` forwards `action` and `scriptId`, and refuses
  `action:'audio'` without an id rather than guessing.
- Batch refuses a group that carries a `scriptId` across several chapters —
  dropping the pin would speak an unchosen script, splitting it would invent
  pins that do not exist.
- `effectiveSettingsFor()` deliberately does **not** carry `action`/`scriptId`,
  so a one-off pin cannot leak into every later conversion of that chapter.
- Server already validated and honoured all of this (`books.js` rejects the
  four bad shapes; `pipeline.js` speaks `job.script_id` verbatim).

### Job B — overrides visible outside the dialog  ✅
- The chapter row shows an `Override` chip when the chapter disagrees with the
  book, with a tooltip reading e.g. `Hindi · Madhur · My script`.
- Clicking the chip opens the settings dialog; its `✕` calls
  `resetChapterOverride()`.
- Reset removes **only** the session override. Book preset and global defaults
  are untouched, and the summary, chip and batch grouping all recompute
  together.

### Bug found and fixed on the way
- `getQuickActionAllowed`, `setBookPreset`, `setQuickActionAllowed`,
  `getBatchMode` and `setBatchMode` were used in `main.js` but never imported.
  Every first-use and "don't ask again" path would have thrown at runtime.

---

## Job C — acceptance pass  ✅

Run against the real EPUB *Alice's Adventures in Wonderland* (13 chapters,
`5fda38e9`), server on :3000. Chapter 3 (index 2) used throughout. All test
artifacts were deleted afterwards; the book is back to 1 script / 1 audio.

### Verified by live API

| # | Check | Result |
|---|---|---|
| 1 | Translate Text creates a script and **no** audio | ✅ `action:script` → scripts 2→3, audioVersions unchanged at 2 |
| 2 | Generate Audio from AI script uses the exact id | ✅ new audio row `script_id = b08126ae` |
| 3 | Generate Audio from My script uses the exact id | ✅ audio `script_id = 18312f7e`, `scriptSource=custom`, **duration 7.6s** — proving it spoke the 75-char custom script, not the 9,203-char AI one |
| 4 | **A newer script does not hijack a pinned regeneration** | ✅ with newer AI script `69048de8` present, regenerating from `b08126ae` still linked to `b08126ae`, and `scripts` stayed at 3 (no re-translation) |
| 5 | Audio metadata shows which script created it | ✅ `/content` returns `scriptId` + `scriptSource` per version |
| 6 | AI and My Script tabs show separate content | ✅ `aiContent` 9,203 chars / `customContent` 75 chars, each with its own `aiScript` / `customScript` metadata |
| 7 | Audio-only with no `scriptId` | ✅ rejected: *"generating audio from an existing script needs that script to be named"* |
| 8 | Audio-only across 2 chapters | ✅ rejected: *"a specific script belongs to one chapter"* |
| 9 | Audio-only with a script from another chapter | ✅ rejected: *"that script belongs to a different chapter"* |
| 10 | Audio-only with a bogus id | ✅ rejected: *"that script no longer exists"* |
| 11 | Chapter ordering intact (prev/next) | ✅ 13 chapters, indexes 0–12 in order |
| 12 | Text/audio sync data intact | ✅ 8 of 9 audio files still carry alignment |

### Verified by inspection (UI state, no API surface)
- Row quick action opens the dialog before the agreement, fires directly after —
  gated on `getQuickActionAllowed` in `initChapterControls`.
- Settings summary updates after saving a preset — every write is followed by
  `syncNarrationControls()`.
- Override visible in row (chip) and dialog (`qc-scope` + subtitle).
- Mixed overrides open the conflict dialog; per-chapter mode groups jobs,
  uniform mode sends one and leaves `state.chapterOverrides` intact.
- Speed and pitch persist — untouched by this work, still routed through
  `speedForBook` / `pitchForBook`.
- Pagination untouched — still driven by `visibleChapters()` + `page`.

### Notes from the run
- The one genuine failure surfaced was environmental, not a defect: translate
  jobs are refused without a Groq key, with an accurate message naming the two
  ways out ("My script" / "Original English").
- **The API key pasted in chat should be rotated** — it is now in plain text in
  the conversation log.

---

## Skipped deliberately (and why)

- **Persisting chapter overrides.** An invisible exception that survives a
  restart is the same class of bug this redesign removes. Revisit only if the
  row chip proves it is discoverable enough to be safe.
- **A separate "active script for future generation" selector.** The tab you
  are on already answers it. A third, independent selector would be a second
  source of truth about the same question.
- **Book presets on the server.** `read()`/`write()` remain the only
  storage-aware functions, so the swap stays cheap; doing it now would make
  every caller async for a backend that does not exist yet.

---

## Phase 5 — Listen pane + failure UI  ✅

### Listen pane
- **Version selector** (shown only when a chapter has 2+ versions). Each option
  reads `V3 · date · language · voice · style · source · duration`.
- Selecting a version loads *that* audio, and moves the reader to the matching
  script tab (`ai` → AI script, `original` → Original). No script is rewritten.
- The selection is held in `state.listenVersionId` so a progress tick cannot
  move Download/Regenerate onto a different version than the one chosen. It is
  cleared when a different chapter opens.
- **From** row added to the metadata, naming the script source that produced
  the selected version, alongside voice, duration and version label.
- **Download** acts on the selected version, via its own `downloadUrl` — never
  the merged audiobook, never "whichever is newest".
- **Regenerate** opens the dialog seeded from the audio row and pinned to its
  exact `scriptId`, with the action preset to `Generate audio`. Changing the
  source in the dialog drops the pin, because it then names a script of the old
  source. A pinned regenerate does **not** write a chapter override — remaking
  one old version is not a decision about how the chapter converts from now on.
- **Empty state** explains which action applies rather than showing three
  similar buttons: it names whether a custom script, an AI script, or nothing
  exists yet.

### Failure UI
- **Failed tab** beside All / Ready / Converting. Hidden at zero, because a
  permanent "Failed (0)" is a standing suggestion that the app breaks; if the
  last failure clears while it is selected, selection falls back to All.
- `state.chapterErrors` now holds `{ message, stage, jobId, retryable }`
  instead of a bare string. Both shapes are tolerated when rendering.
- **Stage-aware messages**: the pipeline tracks the stage a chapter reached and
  sends it with `chapter:error`, so a row reads "Translation failed" or "Audio
  generation failed" rather than "Failed".
- **Stage-specific recovery** (`recoveryFor()` in `catalog.js`):
  - translate → Retry translation · Change settings · Use my script
  - TTS → Retry audio · Change voice
  - otherwise → Retry
  Plus **View logs** on every failed row, which opens the console filtered to
  that chapter using the existing `chapterOnly` filter.
- **Retry** prefers `POST /jobs/:id/retry`, which reproduces the original job's
  settings — including a text-only action and any pinned script. Falling back to
  a fresh conversion only when no job id is known.
- **Interrupted jobs** are surfaced on book open as a persistent toast with a
  Resume action. The backend already marked them `interrupted`; nothing showed
  them, so a conversion killed by a restart simply looked finished. Resume sends
  only the chapters that did not complete.
- `showToast` gained `{ persist, actionLabel, onClick }` — a resume offer that
  disappears after five seconds is an offer never really made.

### Smaller follow-up
- The batch cap `confirm()` is gone. The cap is now explained inside the batch
  dialog, so a large mixed selection produces one interruption instead of a
  confirm followed by a dialog asking a different question. When the cap applies
  but the settings all agree, the dialog shows the notice only and hides the
  mode question — asking "how do you want to continue?" with one possible
  answer is not a question.

### Verified live (server on :3000, *Alice*)
| Check | Result |
|---|---|
| Pipeline reports failure stage | ✅ forced a bad-key run: log carries `stage=script`, ch 6 |
| Failed run leaves no partial artifacts | ✅ ch 6 ended with 0 scripts, 0 audio |
| Retry reuses original settings | ✅ retry of a text-only job came back `action=script`, same language/voice/source — not upgraded to full conversion |
| Interrupted job detected | ✅ killed the server mid-job; on restart *"Recovered orphaned jobs, count: 1"*, job `96032e30` reported `interrupted`, outstanding 2 |
| Resume finishes the outstanding chapters | ✅ resumed 7,8 → `completed=[7,8]` |
| Existing audio untouched | ✅ book back to 8 audio files, 1 script on ch 3 |

All test artifacts were deleted; the book is in its original state.

---


## Known limitations (Phase 5)

- **Autoplay-next toggle was not added.** Playback order and queue behaviour are
  owned by the bottom transport, and `playbackOrder()`/`playAdjacent()` already
  define "next". Adding a second, pane-local autoplay switch would create a
  second source of truth about the same behaviour, and the brief explicitly
  defers queue-follows-selection. Better done with the transport work.
- **Sync/highlight status is still in the reader toolbar**, not duplicated in
  the pane. It already reports honestly (it refuses to claim sync when the text
  on screen is not the text being spoken); mirroring it would just be a second
  place to keep correct.
- **"My script" tab is not auto-selected** when a custom-script version is
  chosen. That tab opens the editor rather than a read-only view, so switching
  to it would drag the user into an editor they did not ask to open.
- **Retry has no job id after a page reload.** `state.chapterErrors` is session
  state, so a retry after F5 falls back to a fresh conversion using the
  chapter'\''s effective settings. Fixing this properly means reading failures back
  from the job history on load.
- **Stage is only known for failures raised inside the pipeline.** A request
  refused up front (bad voice, missing custom script) has no stage, and the row
  correctly says just "Failed" rather than guessing one.
- **Merge/parse stages are defined but unused** in `STAGE_META`; nothing emits
  them yet. They are there so the labels exist when the merge path starts
  reporting failures.

## Still deferred (unchanged)

Compare tab, three-way comparison, multi-version custom script editing,
persisted chapter overrides, server-side book presets, queue-follows-selection,
visual redesign, dropping `translated_content`, chunks table.
