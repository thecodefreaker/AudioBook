# Audiobook Studio — Design Audit & Recommendations

> Companion to `10_AUDIOBOOK_STUDIO_SPEC.md`. That document says what the
> product should feel like. This one is an audit of what is actually built,
> where the two disagree, and what I recommend doing about it.
>
> Status date: 2026-08-08

---

## 0. Verdict on the proposed design

The direction is right, and one observation in it is the most valuable thing
in either document:

> "Currently what I am seeing in UI is the 'Drop an EPUB here' card all the
> time on the page even when the user already opened a book."

This was a real structural bug, not a styling preference. `#section-upload`
had **no show/hide logic anywhere in the codebase** — it rendered permanently.
The consequence is worth stating precisely, because it generalises:

**The most visually prominent control on the screen was one the user had
already finished with.** Upload is a *transition* between states, not a tool
you use *while* working. Leaving it pinned meant the sidebar led with the past
instead of the present, and pushed conversion controls — the actual job —
below it.

Fixed. The rest of this document applies the same test everywhere:
*does this element belong to the state the user is actually in?*

### Where I disagree with the spec

**1. The hero must not be unconditional.** §1 says a new user should land on a
hero. Correct. But a returning user with books in their library would then hit
a wall they must click through on every launch to reach work already in
progress. That is friction disguised as polish.

- **Implemented:** hero shows when no book is open; opening a book from the
  library or uploading one transitions straight into the workspace.
- **Open question (Q1 below):** should the app auto-open your most recent book
  on launch, skipping even that?

**2. "Chapter cards" should stay a list, not become a grid.** §5 asks for
cards instead of "giant rows". The stated goals — name, status, duration,
voice, obvious states — are all achieved. But a 13-chapter book is fine as a
grid and a 300-chapter book is not: chapters are *ordered and scanned*, and a
multi-column grid breaks reading order and destroys scan speed.

- **Recommendation:** keep one chapter per row, make each row *card-like*
  (padding, state, rich sub-line). This is what is now built. Sequence is the
  chapter list's most important property and a grid throws it away.

**3. Waveform (§6) is expensive and I would defer it.** Rendering a real
waveform needs either server-side peak extraction at generation time (schema +
pipeline work) or decoding entire MP3s client-side (slow, memory-hungry). The
*stated* goal — "verify audiobook quality" — is already served by sentence
highlighting, which is more precise than a waveform for checking whether the
narration matches the text. Recommend deferring until asked for explicitly.

---

## 1. Current architecture (as built)

```
┌──────────────────────────────────────────────────────────┐
│ HEADER   brand · open book · Workspace|Library · New book │
├────────────┬─────────────────────────────────────────────┤
│ SIDEBAR    │ CONTENT                                     │
│            │                                             │
│ no book:   │  no book → WELCOME (hero, 2 actions)        │
│  (upload)  │  book    → WORKSPACE:                       │
│            │     book overview (cover, stats, progress)  │
│ book open: │     toolbar (search · filter · sort)        │
│  progress  │     chapter list (scrolls)                  │
│  audiobook │     selection bar (only when selected)      │
│  defaults  │                                             │
├────────────┴─────────────────────────────────────────────┤
│ DOCK   player (chapter jump · transport · speed)         │
└──────────────────────────────────────────────────────────┘
                                      ● console bubble (floating)
```

Regions scroll independently. The shell owns `overflow: hidden` so the page
itself never scrolls — this is what stops the layout drifting as a long
chapter list grows.

---

## 2. The user journey, state by state

### State A — First launch, no books

**Sees:** centred hero. Icon, headline "Turn any EPUB into a professional
audiobook", one line of explanation, two buttons (Upload EPUB · Open Library),
and a hint that dropping a file anywhere works.

**Why:** a first-time user needs exactly one question answered — *what is
this?* — and one obvious next step. Toolbars filtering an empty list, or a
sort dropdown with nothing to sort, are noise that actively obscures that.

**Interaction:** dropping a file **anywhere on the page** works, not just on a
200px target. The page shows a dashed outline while a file is over it.

### State B — Upload in progress

**Sees:** the drop zone is replaced in place by a progress bar and four named
stages: Reading EPUB → Extracting chapters → Building workspace → Ready. Done
stages get a tick, the current one is filled and accented.

**Why:** a spinner says "wait" but not what for, or for how long. Naming the
stage is the difference between waiting patiently and assuming it has hung.
Stages are driven by real parser events, never by timers — a fake progress bar
that finishes before the work does is worse than none.

### State C — Book open, nothing converted

**Sees:** the hero is replaced by the workspace. Header shows the book. Book
overview shows cover, title, author, and four stats: chapters, words,
estimated length, % converted. Chapter rows read "Untouched" with a Convert
button. The sidebar has swapped from upload to conversion controls.

**Why this answers the three questions the spec asks:**
- *Where am I?* — book in header + overview; open book always visible.
- *What next?* — every unconverted row's primary action is Convert.
- *What's happening?* — nothing yet, and the UI does not pretend otherwise.

**Estimated length** uses 150wpm, matching `server/utils/textChunker.js`, so
client and server can never disagree on screen.

### State D — Converting

**Sees:** row switches to an inline progress bar with a stage message and a
Stop button. Sidebar shows overall progress and ETA. The console bubble pulses.
Everything else stays usable.

**Why:** generation is slow and per-chapter. Blocking the UI would make a
20-chapter batch mean 20 minutes of staring. Progress appears *in place* so
starting a conversion never reflows the page or pushes the list out of view.

**Failure:** the row goes red with the actual error, and the console bubble
turns red with a count. Errors previously only existed inside a panel that was
collapsed by default — so the app could fail silently. That is now impossible.

### State E — Converted, reviewing

**Sees:** row shows duration and voice instead of word count — *what will I
hear if I press play*, which is the only question that matters now. Play,
re-convert, read, delete.

**Reader (two-pane):** text left with a proper measure (68ch), listening pane
right showing voice, duration, version and a play control. Sentence-level
highlighting follows the audio; follow-mode is opt-in so reading ahead is never
interrupted by the page scrolling itself.

**Key constraint honoured:** the listening pane has **no `<audio>` of its
own** — it drives the docked player. Two audio elements would mean two things
playing at once and a sync engine with no authoritative source.

### State F — Multi-select

**Sees:** a toolbar appears with count, Generate, Change voice, Export, Delete,
Clear. Disappears entirely when nothing is selected.

**Note:** "Change voice" focuses the voice picker rather than launching a
second conversion path — one pipeline, so behaviour cannot drift.

### State G — Library

**Sees:** cover-led tiles, 2:3 aspect. Progress, chapter count, duration.
Books without artwork get a generated spine from the title's initial, so they
stay distinguishable rather than becoming rows of identical icons.

---

## 3. Database & data-layer audit

Schema is genuinely well designed. Specific strengths worth preserving:

- **`chapter_scripts` + `audio_files.script_id`.** Audio points at the exact
  script it came from. This is why badges cannot lie and a custom script can
  never be silently overwritten by an AI retelling. Excellent decision.
- **`spoken_content` stored separately** from `content` — what was *actually*
  sent to TTS, post-transliteration. Essential for debugging.
- **`is_merged`** keeps the whole-book file out of chapter lists.
- **`job_logs`** persists logs across reloads.
- **Idempotent `addColumn` migrations** — safe on every boot.
- **WAL mode + `foreign_keys = ON`** with `ON DELETE CASCADE` throughout.

### Gaps found

| # | Gap | Impact | Fix |
|---|-----|--------|-----|
| D1 | **Covers were never usable.** `cover_image` stored the href *inside* the EPUB zip. | Every book fell back to a placeholder. | **Fixed** — bytes extracted to `data/covers/`, served statically. Regression-tested. |
| D2 | `books.last_opened_at` is written but never read. | "Continue where you left off" is impossible despite the data existing. | Sort library by it; power auto-resume (Q1). |
| D3 | No bookmarks/favourites table. | §4 asks for both. | Needs `chapter_bookmarks`; see Q3. |
| D4 | Last-read chapter is in `localStorage`, not the DB. | Does not follow the user across devices/browsers. | Fine for single-user local; move to DB if multi-device matters. |
| D5 | No index on `audio_files(chapter_id, created_at DESC)`. | "Newest version per chapter" is computed client-side by scanning. Fine at 13 chapters, not at 300. | Add composite index if large books are expected. |
| D6 | `chapters.translated_content` still exists alongside `chapter_scripts`. | Two sources of truth for the same concept. | Confirm dead, then drop. |

### Client-side data note

`renderBookOverview()` derives every figure from data already in memory — no
extra requests, and it cannot disagree with the chapter list because it reads
the same arrays.

---

## 4. Accessibility & responsive posture

Done: focus trapping and restore in modals, Escape closes only the top-most
dialog, ARIA on tabs/dialogs/toggles, 44px touch targets under
`pointer: coarse`, state shown by shape *and* colour (upload steps, chapter
states), `dvh` units so mobile browser chrome cannot clip dialogs, independent
scroll regions, `prefers-reduced-motion` respected.

Breakpoints are set where the layout actually fails (1280 / 1000 / 900 / 860 /
640 / 560), not at device names.

**Remaining:** a full screen-reader pass, and live-region announcements when a
chapter finishes converting.

---

## 5. Recommended priority

| Priority | Item | Why |
|---|---|---|
| **P0 — done** | Upload card hidden when a book is open | Was actively misleading |
| **P0 — done** | Welcome state, conditional | First impression |
| **P0 — done** | Cover extraction | Unblocked the whole visual library |
| **P1** | Completion experience (§12) | The payoff moment is currently a toast |
| **P1** | Corner status area (§10) | Progress is sidebar-only; invisible from Library |
| **P2** | Voice preview cards (§8) | Needs a cached TTS endpoint first |
| **P2** | Library sort by `last_opened_at` | Data already exists (D2) |
| **P3** | Bookmarks / favourites (§4) | Needs schema (D3) |
| **P3** | Nav rail (§3) | See Q2 — displaces working UI |
| **Defer** | Waveform (§6) | Cost ≫ benefit; sync already solves the goal |

---

## 6. Questions for you

**Q1 — Auto-open the last book?** `last_opened_at` is recorded but unused. On
launch, should the app (a) always show the hero, (b) auto-open your most recent
book and show the hero only when the library is empty, or (c) show the hero
with a "Continue: *Alice*" button? I lean **(c)** — fast for returning users,
never takes the choice away.

**Q2 — The nav rail (§3).** This is the one I most need your input on. Your
sidebar currently holds upload, conversion progress, the audiobook panel, and
conversion defaults. A slim icon rail has nowhere to put those. Options:
- **(a)** Rail + a second collapsible panel — keeps everything, more chrome.
- **(b)** Rail only; conversion settings move into the Convert dialog, progress
  moves to the corner status area (§10). Cleanest, but every conversion then
  requires opening a dialog.
- **(c)** Keep the current sidebar, which is now correctly state-dependent.

I lean **(b)**, because it also fixes the "settings you configured once are
permanently on screen" problem — but it is a real workflow change, so it is
your call.

**Q3 — Bookmarks: chapter-level or position-level?** Chapter-level ("Chapter 7
is bookmarked") is simple. Position-level ("bookmark at 4m12s in Chapter 7") is
much more useful for a 20-hour audiobook but needs a timestamp column and
reader UI. Which do you want?

**Q4 — Multi-device?** Reader settings and last-read live in `localStorage`. If
you only ever use one browser, that is correct and cheap. If not, they should
move to the DB. Which is it?

**Q5 — Book size?** Several recommendations (D5, grid-vs-list, chapter
dropdown) hinge on this. Is 13 chapters typical, or are 200+ chapter books
expected?

---

# Round 2 — Your answers, my responses, and the resulting plan

> Source: `docs/1.md`, 2026-08-08. Every point you raised is answered below.
> Decisions are marked **DECIDED**; where I think your instruction has a
> consequence you may not have intended, I say so rather than just agreeing.

## 7. Answers to Q1–Q5

### Q1 — Launch behaviour → **DECIDED: (c), plus Recents**

You said: don't auto-open; let the user choose; make auto-open a *setting*;
split the library into Recents and All Books.

Agreed, and this is the better answer than my (c) alone. Final behaviour:

| Situation | What launches |
|---|---|
| No books at all | Hero (State A). Single action: Upload EPUB. |
| Has books, none open | **Home**, not the hero (see §8). |
| Has books + `settings.autoOpenLast = true` | Last book's workspace, with a "← Home" affordance in the header. |

`autoOpenLast` defaults to **off**. Auto-opening by default is the kind of
convenience that becomes an obstacle the first time you want a *different*
book, and the cost of being wrong is higher than the saving of being right.

This makes D2 (`last_opened_at` unused) actionable: it now drives both the
Recents row and the auto-open setting.

### Q2 — Nav rail → **DECIDED: (b), with a defaults escape hatch**

You chose (b) — rail only, conversion settings move into the Convert dialog —
and then correctly caught the flaw: *"But for every conversion we need some
setting right?"*

Yes. Rail-only as literally specified would mean a dialog on every single
conversion, which is worse than the sidebar it replaces. The resolution:

- **Saved conversion presets.** Language + voice + style + model persist as a
  named default (e.g. "Hinglish · Aditi · Storyteller"). Stored in DB, not
  `localStorage` (see Q4).
- **Convert becomes a split button:** clicking the main body converts
  immediately using the active preset; the caret opens the dialog to change it.
- The **active preset name is shown on the button**, so a silent default is
  impossible — you always see what is about to happen before you click.

This gives one click for the 95% case and full control for the other 5%,
without a permanent settings panel occupying the sidebar.

### Q3 — Bookmarks → **DECIDED: both, position-level first**

Position-level is the primary feature; chapter-level is the degenerate case of
it (offset `0` with a flag). One table serves both, so building the simple one
first and the useful one later would mean building it twice.

```sql
CREATE TABLE chapter_bookmarks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id      INTEGER NOT NULL REFERENCES books(id)    ON DELETE CASCADE,
  chapter_id   INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  kind         TEXT    NOT NULL DEFAULT 'position',  -- 'position' | 'chapter'
  audio_ms     INTEGER,        -- playback position, null for chapter-level
  text_offset  INTEGER,        -- char offset into content, for the reader
  sentence_idx INTEGER,        -- survives re-conversion; see note
  label        TEXT,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_bookmarks_book ON chapter_bookmarks(book_id, created_at DESC);
```

**Non-obvious point:** store `sentence_idx` alongside `audio_ms`. Re-converting
a chapter with a different voice changes every timestamp, so an `audio_ms`-only
bookmark silently drifts to the wrong place. The sentence index is stable
across voices and lets the bookmark be re-resolved to a new timestamp.

### Q4 — Multi-device → **DECIDED: server-side. Postgres/Supabase later, not now**

You're planning web + mobile, so `localStorage` is disqualified. But the
migration and the sync are two different problems, and doing them together is
how projects stall:

- **Now (no DB swap):** move reader settings, last-read position, playback
  speed and conversion presets out of `localStorage` into a
  `user_settings(key, value_json)` table in the existing SQLite DB, behind a
  `/api/settings` endpoint. The client stops reading `localStorage` directly.
- **Later (when a second device actually exists):** swap the storage engine.
  Because the client only ever talks to `/api/settings`, that swap touches no
  UI code.

On Supabase specifically: yes, it solves multi-device, and its auth + storage
would also handle the audio files. But it introduces network latency into a
pipeline that currently reads/writes local files, and requires an account model
you don't have yet. **Recommendation: keep SQLite, add the settings API now.**
Revisit Supabase when you start the mobile app — at that point the abstraction
already exists and the swap is cheap. Doing it now buys nothing and costs the
whole data layer.

Add to §3's gap table:

| # | Gap | Fix |
|---|-----|-----|
| D7 | Settings/last-read in `localStorage` | `user_settings` table + `/api/settings`; DB-engine-agnostic |

### Q5 — Book size → **1000 chapters. This changes several decisions.**

This is the highest-impact answer you gave, and it invalidates things that are
fine at 13 chapters:

1. **Grid chapter cards are now definitively wrong.** Confirms §0.2. A
   1000-item grid has no usable reading order.
2. **The chapter list must be virtualised.** 1000 rows × several nodes each is
   tens of thousands of DOM nodes; scrolling will jank and selection will lag.
   Render only the visible window. *This is now P1, not a nicety.*
3. **The player's chapter dropdown must become a searchable picker.** A 1000-
   option `<select>` is unusable. Type-to-filter, keyed on number and title.
4. **D5's index is now required, not optional:**
   `CREATE INDEX idx_audio_chapter_created ON audio_files(chapter_id, created_at DESC);`
   Deriving "newest version per chapter" client-side by scanning must also stop
   — it becomes a server-side query.
5. **Select-all needs a guard.** "Convert 1000 chapters" must state the
   estimated time and cost before it starts, not after.
6. **The chapter list needs section grouping** (Chapters 1–50, 51–100…) or a
   jump-to-number box. Scrolling 1000 rows to find chapter 700 is not viable.

---

## 8. Design: the returning-user Home state

You asked directly: *"what should the returning user see, and where do they add
a new book from?"*

The gap in the current build is that there are only two states — hero (no book)
and workspace (book open) — so a returning user with 12 books and none open
gets a first-timer's hero. Wrong audience. Add a third state.

```
┌────────────────────────────────────────────────────────────────┐
│  ▣  Audiobook AI          Home  Library  Voices      [+ New]   │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│   Continue listening                                           │
│   ┌──────┐  Alice's Adventures in Wonderland                   │
│   │cover │  Chapter 7 · 4m 12s in · 72% converted        ▶     │
│   └──────┘  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░                                │
│                                                                │
│   Recents                                                      │
│   ┌────┐ ┌────┐ ┌────┐ ┌────┐                                  │
│   │    │ │    │ │    │ │    │   ← covers, 2:3, progress ring   │
│   └────┘ └────┘ └────┘ └────┘                                  │
│                                                                │
│   In progress · 2 books converting                             │
│   Dracula   ▓▓▓▓▓▓░░░░  Chapter 14 of 27                       │
│                                                                │
│   All books →                                                  │
└────────────────────────────────────────────────────────────────┘
```

**Why this shape.** A returning user's most likely intent is "resume what I was
doing", second is "pick a different recent book", third is "add a new one".
The layout puts those in exactly that order. The hero inverts it — it puts the
*least* likely intent (first upload) in the largest slot.

**Where uploading lives — and the duplication you spotted.** You're right that
upload currently exists in two places. Consolidate to **one entry point**:

- **`[+ New]` in the header**, present in every state.
- It opens the file picker directly. No intermediate modal — a modal whose only
  content is a button that opens the *real* picker is a wasted click.
- Drag-and-drop onto **anywhere on the page** continues to work in every state,
  including with a book open. This is the important one: it means you never
  need a visible drop target, which is what let the upload card be removed.
- The hero's "Upload EPUB" button and the library's empty-state button both
  call the same handler. Same code path, three surfaces, no drift.

**During upload with a book already open,** progress appears in the corner
status area (§10), not by replacing the workspace. Uploading a second book must
not evict the one you're reading.

---

## 9. Bugs and vague areas you identified

### 9.1 Sidebar clipping — **confirmed bug, P0**

> *"the sections in the sidebar are not responsive when zoomed… cards are cut
> off and I can't scroll, the bottom card is half cut off."*

Real defect, not a preference. The shell sets `overflow: hidden` on the page to
stop layout drift, but the sidebar column was never given its own scroll
context, so its content overflows and is simply clipped — unreachable.

Fix: the sidebar becomes `min-height: 0; overflow-y: auto; overscroll-behavior:
contain`, with bottom padding equal to the player dock height so the last card
clears the dock. The `min-height: 0` is the load-bearing part — a flex child
defaults to `min-height: auto` and refuses to shrink below its content, which
is exactly why the clipping happens instead of a scrollbar.

This is largely mooted by §10's rail migration, but must be fixed regardless,
because it can recur in any scrolling column.

### 9.2 "Complete Audiobook" card — **you're right, it's under-specified**

Your questions were the correct ones. Answering them precisely:

- **What it does:** concatenates every converted chapter into one MP3, stored
  with `is_merged = 1` so it never appears in the chapter list.
- **What order:** chapter `order_index` ascending — *not* conversion order.
- **Which book:** the currently open one. **This is the flaw.** The card sits in
  the sidebar with no book name on it, so with no book open it refers to
  nothing, and it looks like a global feature when it is per-book.
- **Dependent, not independent:** correct.

**Recommendation — remove it from the sidebar entirely.** It belongs in the
completion experience (§12), on the book overview card, and should only exist
once the book is convertible:

| Converted | What shows |
|---|---|
| 0% | Nothing. The action is meaningless. |
| 1–99% | Disabled, with the reason: *"Build audiobook — 4 chapters remaining"* |
| 100%, not built | **Build audiobook** (primary) |
| Built | **Listen · Download · Export ZIP**, with size and duration |

Labelled with the book title. A control that is permanently visible but only
sometimes meaningful trains users to ignore it.

### 9.3 "Conversion defaults" — **agreed, and §7/Q2 replaces it**

> *"vague… not a fan of choosing audio type and style from the very start."*

Correct diagnosis: it asks for four technical decisions (language, voice, style,
model) *before* the user has heard anything or has any basis for choosing. That
is a settings panel wearing a workflow's clothes.

**Replacement — a preset chip plus a narrator sheet.** The sidebar section is
deleted. In its place, the Convert control reads:

```
[ ▶ Convert  ·  Hinglish · Aditi ▾ ]
```

Clicking the caret opens a **narrator sheet** — voice *cards* (§8), audition
before committing, style as three plain-language choices ("Faithful",
"Storyteller", "Conversational") rather than a model dropdown. The AI model
picker moves to Advanced settings, collapsed; it is a debugging control, not a
creative one, and 99% of conversions should never touch it.

This turns "fill in a form" into "choose a narrator", which is what §8 was
asking for in the first place.

### 9.4 Console bubble — **agreed, fix by docking, not by dragging**

> *"Is it fixed? Can it be moved by cursor? It hides part of the player."*

It's fixed, and it does overlap the player — a real bug.

I'd advise **against** free dragging. A draggable overlay can be dropped
somewhere useless or off-screen, its position must be persisted, and it needs a
"reset position" affordance to recover from misuse — a lot of machinery to
solve "it's in the wrong place", when the right answer is to put it in the
right place.

Instead: the bubble becomes the **corner status area (§10)**, anchored above
the player dock (`bottom: calc(var(--dock-h) + var(--space-4))`), so overlap is
structurally impossible rather than avoided by luck. It reports live conversion
progress, and expands into the full log panel. Errors turn it red with a count
— that behaviour is good and stays.

If you still want it movable after seeing it docked, snap-to-corner (four fixed
positions) gives the flexibility without the failure modes.

### 9.5 Book overview is too wide — **agreed**

> *"it covers most of the page… should go where the upload card was, and be a
> card instead of a wide area."*

Agreed, and it composes well with the rail decision: the overview becomes a
**compact card in the left column** — cover, title, progress ring, stats
stacked vertically — freeing the entire content area for the chapter list,
which is the part that scales to 1000 rows.

Glad the *information* is right; it's placement and density, not content. Below
1000px the card returns to a horizontal strip above the list, since a narrow
screen has no left column to spare.

### 9.6 Can't read a chapter while it converts — **agreed, and it's a real gap**

> *"while converting I can't read it, or see what text the AI is using."*

This is the most substantive functional gap you've raised. Converting a chapter
currently locks the row, but conversion is *exactly* when you most want to see
the transformed script — that's when you'd catch a bad retelling, and right now
you find out only after the audio exists.

**Fix — a live script pane.** `spoken_content` is already stored per chapter
(§3), so the data exists; it just isn't surfaced during the job:

- The converting row gets a **View script** action alongside Stop.
- It opens the reader in two-pane mode: **original left, AI script right**,
  with completed chunks streaming in as the job emits them.
- **Stop & revise** aborts before the remaining chunks are spent.

This turns conversion from an opaque wait into a reviewable process, and it
directly serves §6's stated purpose ("verify audiobook quality") *without* a
waveform — which is further support for deferring it.

### 9.7 Upload progress must be real — **already true, confirmed**

> *"Not a fake one. Real progress bar."*

Agreed and already the case: the four stages are driven by actual parser
events, never timers. Fake progress is worse than none, because it destroys
trust in every other indicator in the app the first time it's caught lying.

The one honest gap: "Extracting chapters" has no sub-progress on a 1000-chapter
book. That stage should emit `n of N` as it goes.

---

## 10. Playback speed — **specified**

Presets: `0.25 · 0.5 · 0.75 · 1 · 1.25 · 1.5 · 1.75 · 2`, default `1×`, plus a
**custom** value.

- Custom range clamped to **0.25–4.0**, step 0.05. Beyond ~4× audio is
  unintelligible, and below 0.25× artefacts dominate.
- Persisted via `/api/settings` (Q4), **not** `localStorage`.
- **Two scopes:** a global default and an optional per-book override. A speed
  that suits a fast narrator often doesn't suit a slow one, and a single global
  value forces a re-adjustment on every book switch.
- `preservesPitch = true` on the media element, otherwise 2× sounds chipmunked
  and the feature is unusable at its most-used setting.
- Speed applies to the docked player only — the single audio source (§2 State
  E) means there is nothing to keep in sync.

---

## 11. Revised priority

Reordered by your answers; **1000-chapter books** promoted virtualisation, and
your bug reports promoted several items to P0.

| Priority | Item | Driver |
|---|---|---|
| **P0** | Sidebar scroll/clipping fix | §9.1 — content unreachable |
| **P0** | Console bubble docked above player | §9.4 — obscures player |
| **P0** | Home state for returning users | §8 — wrong audience gets the hero |
| **P0** | Single upload entry point (`+ New`) | §8 — duplication you flagged |
| **P1** | Virtualised chapter list | Q5 — 1000 chapters |
| **P1** | Book overview → compact card | §9.5 |
| **P1** | Live script pane during conversion | §9.6 — real functional gap |
| **P1** | `user_settings` + `/api/settings` | Q4 — unblocks speed, presets, sync |
| **P1** | Speed presets + custom + persistence | §10 |
| **P1** | Conversion presets, split Convert button | Q2/§9.3 |
| **P1** | Move audiobook build into completion (§12) | §9.2 |
| **P2** | Nav rail | Q2 — after settings relocate |
| **P2** | Corner status area full behaviour | §10 spec |
| **P2** | Searchable chapter picker in player | Q5 |
| **P2** | `idx_audio_chapter_created` + server-side latest-version | Q5/D5 |
| **P2** | Recents / auto-open setting | Q1/D2 |
| **P3** | Bookmarks (position + chapter) | Q3/D3 |
| **P3** | Narrator sheet with previews | §9.3 — you halted §8 previews |
| **Defer** | Waveform | Cost ≫ benefit; §9.6 serves the same goal |
| **Defer** | Supabase migration | Q4 — after the settings API exists |

---

## 12. Open questions — round 2

**Q6 — Voice previews are halted, but §9.3's narrator sheet depends on them.**
Without audition, choosing a voice is still guesswork from a name. Options:
(a) ship the sheet with names/accents only and add previews later, (b) generate
one short sample per voice **once** at first use and cache it, (c) leave the
current dropdown until previews exist. I lean **(b)** — the cost is a handful
of one-off TTS calls, and it's what turns voice choice from technical to
emotional. Confirm before I halt it entirely.

**Q7 — 1000-chapter grouping.** Do these books have real parts/volumes in their
EPUB structure? If the metadata has a hierarchy I should render it; if not, I'll
fall back to arbitrary 50-chapter buckets, which is noticeably worse.

**Q8 — Select-all on 1000 chapters.** Should "Convert all" be allowed in one
action (with a confirmation stating hours and API cost), or capped per batch
(e.g. 50 at a time) to keep failures recoverable? I lean **capped, with a
queue** — a 1000-chapter job that fails at chapter 800 is painful to resume.

**Q9 — Home vs Library.** §8 proposes Home (continue/recents/in-progress) as
distinct from Library (all books, searchable). Two tabs, or should Home simply
be the top of the Library page? Two is clearer at 100 books, redundant at 5.

---

# Round 3 — Answers to Q6–Q9, and what is now built

> Source: your reply of 2026-08-08. Decisions below are **implemented**, not
> proposed; the code state is summarised in §16.

## 13. Q6–Q9 resolved

**Q6 — Voice previews: halted.** Agreed for now. The consequence to keep in
view: without audition, the narrator sheet (§9.3) is still a form with better
labels. So the sheet is *not* built yet either — shipping it without previews
would mean building it twice. The preset chip below is the interim step, and it
is useful on its own.

**Q7 — 1000-chapter grouping: pagination, searching across all pages.** Built
exactly as you specified, and the second half of that sentence is the important
half. Search, filter and sort run over the **whole book** and only then is the
result paged. A search scoped to the visible page would be a trap: it would
report "no matches" for a chapter that plainly exists. Changing a search or
filter also resets to page 1, since staying on page 7 of a result set that now
has two pages renders an empty list for no visible reason.

On EPUB hierarchy: agreed that real metadata should be used when present. Not
built yet — see Q10.

**Q8 — Batch cap: default 20, user-configurable.** Built. Selecting more than
the cap now states the count and the rough hours before doing anything, then
converts the first N in chapter order and tells you to run it again. The reason
for a cap rather than a warning: a 1000-chapter job that dies at chapter 800
has spent the API budget and left nothing useful to resume from.

**Q9 — You asked me to choose: two tabs.** Home and Library are separate.

They answer genuinely different questions. Home answers *"what was I doing?"*
and is a curated, short, mostly non-scrolling page. Library answers *"where is
that book?"* and is exhaustive, searchable and sorted. Merging them makes the
top of the Library page privileged in a way that sorting then contradicts —
sort by title and "Continue listening" is either wrong or pinned and lying.

The redundancy you rightly worry about at 5 books is handled by **hiding the
Home tab entirely until the library is non-empty**, so a new user never sees a
tab leading to a page about books they do not have.

---

## 14. What was built

### 14.1 Three landing states, not two

`decideLandingView()` now runs after the library loads:

| Situation | Lands on |
|---|---|
| No books | Hero — the one case it is right for |
| Books, none open | **Home** |
| Books + `autoOpenLast` | The most recent book's workspace |

`autoOpenLast` defaults **off**, per §7/Q1.

### 14.2 Home (`src/components/home.js`, `styles/home.css`)

Continue listening (largest target, resumes to the exact chapter) → In progress
(live conversions, visible from outside the book they belong to) → Recent shelf
(covers, 2:3) → "All books →".

**"Resume" actually resumes** — it opens the last-read chapter, not just the
book. A resume button that only opens the book is a differently-worded "Open",
and a promise the button quietly breaks.

### 14.3 Upload consolidated to one entry point

You spotted the duplication; it is gone. The permanent sidebar drop-zone card
has been **removed entirely**. Upload is now `+ New book` in the header,
mirrored by the hero button and the library's empty state — all three calling
one handler.

Nothing was lost: dropping a file **anywhere on the page** works in every
state, which is exactly what makes a dedicated 200px target unnecessary. Two
consequences worth noting:

- Dropping a book while one is open now **asks first** rather than silently
  evicting your workspace.
- `+ New book` no longer closes the current book. Closing is a separate `×` on
  the header's book chip. They used to be the same button, which is why adding
  a book destroyed the one you were reading.

Upload progress moved from the sidebar to the **centre of the hero**, where the
user is already looking, and the file input resets after each pick — otherwise
choosing the same file twice in a row fires no event and silently does nothing.

### 14.4 Book overview → compact sidebar card

Per §9.5. Cover, title, author, a **progress ring**, and the three stats that
are not the ring. The full-width banner is gone, so the entire content column
belongs to the chapter list.

The **audiobook build moved onto this card** (§9.2) and now:
- names the book and states **"in chapter order"** — the first thing anyone
  asks about a merge, and not guessable;
- hides itself completely at 0% converted;
- says *"12 of 40 chapters have audio — 28 still to convert, and they will be
  skipped"* rather than being disabled and unexplained.

### 14.5 "Conversion defaults" → narration preset

Per §9.3. The permanently-open four-field form is collapsed behind a one-line
summary — *"Hinglish · Aditi · Storyteller"* — with a **Change** toggle. The
model picker and API key are further collapsed into `<details>Advanced`,
because they are debugging controls, not creative ones.

Naming the preset on screen is what makes collapsing it safe: a hidden default
would be a silent one.

### 14.6 Playback speed (§10)

Full ladder `0.25 … 2` plus a custom field clamped to **0.25–4**, applied live
so the effect can be heard while choosing. `preservesPitch` is set, without
which 2× is chipmunked and unusable at its most-used setting. **Remembered per
book**, and re-applied on book switch.

### 14.7 Settings store (`src/services/settings.js`)

Every persisted preference now goes through one module, with a one-time
migration so existing users keep their font size, theme and last-read position.

This is the seam for Q4: `read()`/`write()` are the only two functions that
know about `localStorage`, so pointing them at `/api/settings` later touches no
calling code. Deliberately still synchronous — making it async now would infect
every caller with promises to serve a backend that does not exist yet.

### 14.8 Sidebar clipping — fixed (§9.1)

Root cause confirmed: the shell's middle grid row was `1fr`, which has an
implicit `min-content` minimum, and the sidebar was a flex child at
`min-height: auto`. Neither would shrink, so the column overflowed and was
*clipped* — `overflow-y: auto` alone could not help, because there was nothing
to scroll. Now `minmax(0, 1fr)` on the row and `min-height: 0` on the column,
plus bottom padding that clears the player.

### 14.9 Console bubble (§9.4)

Moved to the bottom-**left**. It sat over the player's speed and tone controls;
lifting it above the dock avoided that by luck, and the player's own popovers
still collided with it. On the opposite corner the collision is structurally
impossible.

Still not draggable, deliberately: a free overlay can be dropped off-screen, so
it needs persistence *and* a reset affordance to recover from misuse — a lot of
machinery to solve "it is in the wrong place" when the fix is to put it in the
right place.

### 14.10 Library

Search by title/author, and sorting that finally **uses `last_opened_at`**
(gap D2). Filtering re-renders from memory rather than re-fetching, so typing
is instant. The empty state now distinguishes *"no books yet"* from *"no
matches"* — same screen, different words, different actions.

---

## 15. Still open

Unchanged from §11 except where marked done: narrator sheet with previews
(blocked on Q6), corner status area, bookmarks schema, nav rail, live script
pane during conversion (§9.6 — still the most valuable remaining item),
`/api/settings` backend, `idx_audio_chapter_created`, searchable chapter picker
in the player, screen-reader live regions.

---

## 16. Verification

`npm run build` passes; all eight suites pass (UI wiring audit, CSS variables,
unstyled markup, reader sync, chapter list, cover extraction, custom scripts,
audiobook merge).

**Touched:** `src/index.html`, `src/main.js`, `src/store.js`,
`src/components/home.js` (new), `src/components/chapterList.js`,
`src/services/settings.js` (new), `src/styles/home.css` (new),
`src/styles/workspace.css` (new), `src/styles/shell.css`,
`src/styles/chapters.css`, `src/styles/console.css`,
`src/styles/components.css`.

---

## 17. Questions — round 3

**Q10 — EPUB hierarchy.** To use real parts/volumes (Q7) I need to know whether
your 1000-chapter EPUBs actually carry a nested NCX/NavMap, or whether they are
flat with the structure only implied by titles ("Book II, Chapter 3"). If it is
the latter, do you want me to parse titles for it? That is heuristic and will
occasionally be wrong, which may be worse than plain pagination.

**Q11 — Chapters per page.** Currently 50 and settable. At 1000 chapters that
is 20 pages. Would you rather 100 per page (10 pages, more scrolling), or
should the pager also offer "jump to chapter number" directly rather than by
page?

**Q12 — The live script pane (§9.6).** This is the biggest remaining functional
gap and it is unblocked — `spoken_content` is already stored. Should I build it
next, ahead of the corner status area and bookmarks? I think yes: it is the
only item on the list that changes what the product can *do* rather than how it
looks.
