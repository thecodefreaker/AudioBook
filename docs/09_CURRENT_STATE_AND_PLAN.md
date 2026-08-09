# Current State, Problems, and Improvement Plan

Written after an automated wiring audit (`scripts/audit-ui.js`) plus a manual
read of the code. Every problem below is a **verified** finding, not a guess.

---

## 1. What the app does today

| Area | State |
|---|---|
| EPUB upload + chapter parsing | Works |
| Chapter list, search, filter, tabs | Works |
| Convert (AI / custom script / original) | Works, recently corrected |
| Coexisting audio versions per chapter | Works |
| Inline + sticky player | Works |
| Karaoke sentence sync | Works, tested (19 tests) |
| Persistent per-book logs | Works |
| Preflight (edge-tts / ffmpeg) | Works, recently unblocked |
| Library CRUD | Works |

---

## 2. Verified problems

### P1 — "Download Complete Audiobook" is a dead button
`button#btn-download-all` exists in `index.html` but **no code listens to it**.
Worse, the merged file it would download is filtered out of state in *four*
separate places (`.filter(a => !a.isMerged)`), so a whole-book audiobook is
unreachable even though the backend can produce one.
**Impact:** the app's headline promise — "download the audiobook" — is missing.

### P2 — Two different custom-script editors
There is now the new `#script-editor-modal` **and** an older inline editor in
the reader's Edit tab (`#custom-script-textarea`). They save to the same place
but look and behave differently. This is exactly the "confusing UI" problem:
two doors to one room, and neither mentions the other.

### P3 — `main.js` is 2,184 lines
Rendering, state, networking, player and reader logic are interleaved. This is
why badge logic had drifted into three inconsistent copies. **This is the root
cause of most "blunders"** — not carelessness, but a file too large to keep
consistent. It directly blocks the "scalable, feature-rich" goal.

### P4 — Adding a language/format means editing many files
Languages are backend-driven (good), but formats are hard-wired to EPUB in the
upload middleware, parser and validation. "Later we will add other formats"
currently means a refactor, not a plug-in.

### P5 — No ETA / progress depth
The backend computes an estimate but the UI shows only "converting 1/N".
Requested repeatedly (prompts #39, #50).

### P6 — Naturalness is unverifiable
The Hinglish prompt is good, but there is no way to compare styles on the same
chapter, or to see *why* a translation came out a certain way. Users can't tune
what they can't inspect.

---

## 3. Plan

Ordered so each step makes the next cheaper. **Nothing is a rewrite** — the app
keeps working after every step.

### Phase 1 — Fix the blunders ✅ DONE

1. **Whole-book audiobook now actually works.**
   - New `server/services/audiobook.js` with `planMerge()` / `buildAudiobook()`.
   - `GET /books/:id/audiobook` reports status honestly: how many chapters are
     ready, which are missing, whether an existing build is **stale**.
   - `POST /books/:id/audiobook` builds on demand — no longer dependent on an
     opt-in flag chosen before conversion.
   - `planMerge()` picks **one version per chapter** (newest, or a pinned
     choice) so a book with multiple versions per chapter can't produce a file
     that repeats chapters in different voices.
   - Rebuilding **replaces** the old merged file instead of accumulating
     hundreds of MB.
   - The pipeline's own merge path now calls the same service, so a merge from
     a job and one from the UI can never diverge.
   - UI replaced the dead button with a panel showing duration, size, readiness
     and an explicit *Build* / *Rebuild with latest* / *Download* state.
   - 8 API tests in `scripts/test-audiobook.js`.

2. **The two script editors are now one.** The reader's Edit tab opens the same
   modal. The old inline editor had two real bugs: it pre-filled the box with
   the AI translation (so *Save* silently promoted AI text to "your script"),
   and it generated with the obsolete `translationStyle: 'custom'` instead of
   `scriptSource: 'custom'`.

3. **The audit is now a test.** `npm test` runs `scripts/audit-ui.js` and fails
   the build on any dead control or ghost reference. Elements wired by class or
   injected at runtime are allow-listed explicitly, so the check is precise.

4. Added `loadAudioFilesForBook()` — audio loading had been inlined in five
   places, **two of which forgot to filter out the merged file**, so the whole
   book could appear in the list as if it were a chapter.

**Verification:** 35 checks pass (audit + 19 sync + 8 custom-script +
8 audiobook), production build clean.

### Phase 2 — Structure (unblocks everything else)
4. Split `main.js` into `src/components/` (chapterList, convertDialog,
   scriptEditor, player, reader, logConsole, library) over a tiny observable
   store. Move-then-verify, one component at a time.
5. A single `formatters`/`badges` module so provenance can never drift again.

### Phase 3 — Scalability
6. A format registry (`server/formats/`): EPUB today, TXT/PDF later by adding
   one file. Same pattern already proven by `server/languages/`.
7. Make language/voice/style fully data-driven end-to-end (mostly done).

### Phase 4 — Feature depth
8. ETA + throughput in the progress UI, from the existing estimate.
9. Style preview: convert one short passage in 2–3 styles, pick the best —
   makes "natural, not translated" something you can *hear* before committing.
10. Glossary UI (backend already exists) so names/terms stay consistent — the
    single biggest lever on naturalness.

### Phase 5 — Polish
11. Empty/loading/error states, keyboard shortcuts, accessibility pass.

---

## 4. Deliberately NOT doing

- **No framework migration.** Vanilla JS is working; React would be a rewrite
  with no user-visible gain.
- **No feature flags / plugin system.** Speculative complexity.
- **Not hiding the log console.** Transparency was an explicit requirement.
