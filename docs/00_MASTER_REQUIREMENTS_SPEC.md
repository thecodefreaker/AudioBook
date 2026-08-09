# EPUB → AI Audiobook Generator — Master Requirements Specification (Handover Document)

> **Purpose of this document:** This is the single document you can hand to a developer.
> It reverse-engineers every requirement you expressed across ~52 prompts, resolves the
> contradictions, fills the gaps you never got around to stating, and defines the exact UI,
> UX, data model, and behaviour the product must have.
>
> **Status legend used throughout:**
> - ✅ **BUILT** — exists and works today
> - ⚠️ **PARTIAL** — exists but broken, half-wired, or inconsistent
> - ❌ **MISSING** — never built
> - 💡 **RECOMMENDED** — not requested by you, but needed for the product to feel finished

---

## 0. The One-Paragraph Product Definition

> A local-first web application where a user uploads an English EPUB, browses its chapters in a
> fast searchable list, and converts any chapter (or batch of chapters) into a spoken audiobook —
> either in the original English, or **retold in natural spoken Hinglish** (not translated). Every
> conversion is a **named, permanent, immutable "version"** tagged with its language, voice, style,
> AI model, and timestamp. Multiple versions of the same chapter coexist forever and can be compared,
> played, downloaded, or deleted. The user can read the chapter text in either language while the
> audio plays, with the currently-spoken sentence highlighted and auto-scrolled. Everything the
> backend does is visible in a **persistent, per-chapter, uncensored log terminal**.

**The three non-negotiable product pillars (derived from your prompts):**

| # | Pillar | Your words |
|---|--------|-----------|
| 1 | **Hinglish that doesn't sound translated** | *"it should feel not translated but correctly written"*, *"like those youtube videos who explain chapters"*, *"daily going to dainik which we don't use in normal life"* |
| 2 | **Radical transparency** | *"transparent logs"*, *"without any coating"*, *"like terminal, which will persist, per chapter, even when success or failure"*, *"I can't see deep logs neither in the progress bar nor anywhere"* |
| 3 | **Nothing is ever destroyed** | *"each audio should be maintained... unless deleted it should be there"*, *"store the correct hindi translated chapter along with english"*, *"they should coexist and can be in a grouped format"* |

**Every bug you reported is a violation of one of these three pillars.** That is the real
diagnosis of why the app "feels off".

---

## 1. Personas & Primary Journeys

### Persona A — "The Novel Listener" (you)
Reads 3000–5000 chapter web novels. Wants to *listen* on commute in Hinglish. Cares about:
storytelling tone, batch converting 20 chapters overnight, resuming where they left off,
not re-converting what's already done.

### Persona B — "The Study Listener"
Non-fiction / practical book. Wants **Formal Hindi (Devanagari)** or plain English. Cares about:
accuracy over flavour, per-paragraph re-listen, speed control, no hallucinated rewrites.

### Persona C — "The Perfectionist"
Doesn't trust the AI. Wants to paste their **own** Hindi/Hinglish script per chapter and
have it spoken verbatim, with zero AI interference.

### The 6 Core Journeys (must all be < 4 clicks)
1. **Upload → Browse** — drop EPUB → chapter list appears with word counts and read time.
2. **Read** — click a chapter → dual-view reader (English | Hinglish | Edit) with typography controls.
3. **Convert One** — click Convert on a row → choose language/voice/style → row shows live progress → Play appears inline.
4. **Convert Many** — select chapters → configure once in sidebar → batch queue with global ETA and cancel.
5. **Listen + Follow** — press Play → sticky player → open reader → spoken sentence highlights and auto-scrolls; click any paragraph to seek there.
6. **Manage** — Library → book → see all versions per chapter → compare / download / delete.

---

## 2. Information Architecture (the app has exactly 4 surfaces)

```
┌─ HEADER ─────────────────────────────────────────────────────────────────┐
│  Logo   [ Create ] [ Library ] [ Queue •3 ] [ Settings ⚙ ]               │
└──────────────────────────────────────────────────────────────────────────┘

Surface 1: CREATE / WORKSPACE   ← 90% of time is spent here
Surface 2: LIBRARY              ← book CRUD, storage stats
Surface 3: QUEUE / ACTIVITY     ← global job queue + master log terminal  [❌ MISSING]
Surface 4: SETTINGS             ← API keys, defaults, prompt editor       [❌ MISSING]

Persistent overlays:
  • Sticky Player (bottom, always available, survives navigation)
  • Reader Modal / Fullscreen Reader
  • Version History Modal
  • Convert Dialog
  • Toasts
```

> **Key IA decision you never made, and must:** *Audio Settings* currently lives **only** in the
> Create sidebar, but the Convert dialog **duplicates** the same fields, and the two disagree
> (`startSingleChapterGeneration` reads the sidebar for the Groq key and model, but the dialog for
> language/voice/style). **Resolution:** the sidebar becomes **"Default Conversion Preset"**; the
> Convert dialog is the **only** thing that ever starts a job, and it is **pre-filled** from the
> preset. One code path. One mental model. See §5.4.

---

## 3. Surface 1 — Create / Workspace (detailed spec)

### 3.1 Layout — three zones, full-bleed width

```
┌──────────────┬──────────────────────────────────────────────────┬─────────────┐
│ LEFT RAIL    │  CENTER — CHAPTER LIST (the hero)                │ RIGHT RAIL  │
│ 300px sticky │  fluid, min 0                                    │ 340px       │
│              │                                                   │ collapsible │
│ • Book card  │  ┌ Toolbar ────────────────────────────────────┐ │             │
│   cover,     │  │ 🔍 Search  │ Sort ▾ │ [All][Ready][Queue]  │ │ • Now        │
│   title,     │  │            │        │ [Failed][Unread]     │ │   Playing    │
│   author,    │  └─────────────────────────────────────────────┘ │ • Live log   │
│   N chapters │  ┌ Bulk bar (appears when ≥1 selected) ────────┐ │   terminal   │
│ • Progress   │  │ 12 selected · Convert · Clear · Est 48 min  │ │   (this book)│
│   ring:      │  └─────────────────────────────────────────────┘ │ • Queue      │
│   142/5000   │                                                   │   summary    │
│   converted  │  ▸ virtualised rows (see 3.3)                    │             │
│ • Preset     │                                                   │             │
│   summary +  │                                                   │             │
│   [Edit]     │                                                   │             │
│ • Batch btn  │                                                   │             │
└──────────────┴──────────────────────────────────────────────────┴─────────────┘
```

**Answering your question _"Use full width of the screen, why did you keep space on both sides?"_:**
It was not intended — it is a leftover `max-width` container. **Requirement:** the workspace uses
`width: 100%` with `padding: 0 24px`, no max-width. Only the *reader* keeps a max measure
(68–75 characters per line) because long lines destroy readability. That is the one place where
whitespace on both sides is correct and deliberate.

### 3.2 Left rail — the Conversion Preset (replaces "Audio Settings")

| Field | Type | Notes |
|---|---|---|
| Output Language | segmented control `English \| Hinglish/Hindi` | Drives everything below |
| Voice | select + **▶ preview** button | Preview speaks a 6-second sample — ❌ MISSING, high value |
| Speaking rate / pitch baked into file | slider | Currently only post-hoc in player; baking is better for downloads |
| Translation Style | cards, not a `<select>` | See §6 — style is the single most important choice, it deserves rich cards with a 2-line sample of the output tone |
| AI Provider | `Groq` / `Google (literal fallback)` / `None` | Must be explicit, never silent |
| Groq API key | password input + **Test key** button + live quota chip | ❌ the Test button and quota chip are MISSING |
| Groq model | select, **fetched live from `/models`** | ⚠️ currently hardcoded and contains a decommissioned model |
| Advanced ▾ | chunk size, temperature, max retries, concurrency | 💡 |

**Preset persistence:** saved to `localStorage` **and** per-book in DB, so returning to a book
6 months later restores exactly how you were converting it. ❌ MISSING.

### 3.3 Center — the chapter row (the most important component in the app)

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│ ☐  #14  The System Awakens                                    [▶ Play ▾] [＋] [👁] │
│         3,412 words · ~14 min read · ~19 min audio                       [⋯]      │
│         ┌──────────────────────────────────────────────────────────────────────┐  │
│         │ 🌐 Hinglish  🎤 Madhur  ✍️ Web Novel  🤖 llama-3.3-70b  📅 2h ago  ×3 │  │  ← version chips
│         └──────────────────────────────────────────────────────────────────────┘  │
│         ▓▓▓▓▓▓▓▓▓░░░░░░  62% · Synthesizing chunk 7/12 · ETA 1m 40s     [Cancel]  │  ← only while active
│         ❯ 23:04:11 [TTS] chunk 7/12 ok (edge-tts, 41.2s)                          │  ← last log line, always visible
└───────────────────────────────────────────────────────────────────────────────────┘
```

**Row requirements — every single one you asked for, plus what's missing:**

| # | Requirement | Status |
|---|---|---|
| R1 | Chapter number **and** full title, never truncated — wraps to 2 lines, `title` tooltip for more | ⚠️ currently truncates; you reported this |
| R2 | Word count, estimated read time, **estimated audio minutes** (words ÷ 150 wpm) | ⚠️ only word count |
| R3 | Inline **Convert** button that opens the Convert dialog | ✅ |
| R4 | Inline **Play** with a **version dropdown** attached (split button) | ⚠️ works but see bugs B4/B5 |
| R5 | **＋ New Version** always available after first conversion | ✅ |
| R6 | Version **chips** showing language, voice, style, model, timestamp | ✅ (good) |
| R7 | `×3` badge → opens Version History modal | ✅ |
| R8 | **Preview / Read** eye icon | ✅ |
| R9 | Live inline progress bar + phase message + **per-chapter ETA** | ⚠️ progress yes, ETA no |
| R10 | **Cancel this chapter** button while running | ❌ MISSING — you can only cancel *everything* |
| R11 | **Persistent** error box on the row that survives page reload | ⚠️ in-memory only — B12 |
| R12 | **Retry** button on a failed row, one click, same settings | ❌ MISSING |
| R13 | Last log line always visible on the row (the "❯ terminal ticker") | ⚠️ only inside the progress panel |
| R14 | `⋯` overflow: Copy text, Copy script, Export SRT, Mark unread, Delete all versions | ❌ MISSING |
| R15 | Row is a **drop target for a `.txt` custom script** | 💡 lovely touch |
| R16 | Currently-playing row is visually pinned/highlighted | ⚠️ done via inline border hack |

### 3.4 Filter tabs — final set

`All` · `Audio Ready` · `In Progress` · `Failed` · `Has Script` · `Not Converted`

You asked for the first three. `Failed` is mandatory (otherwise errors are invisible in a
5000-chapter list), `Not Converted` is the actual "what do I do next" view, and `Has Script`
is needed for Persona C. Each tab shows a **count badge**. ⚠️ Only 3 tabs exist, no counts.

### 3.5 Sorting

Index ↑↓ · Title A–Z/Z–A · Recently converted · Longest/Shortest · Failed first. ✅ mostly built.

### 3.6 Bulk actions bar

Appears only when ≥1 checkbox ticked. Shows: **N selected · total words · estimated total time ·
estimated Groq tokens** then `[Convert…] [Clear]`.

> ⚠️ **This estimate is the single most important safety feature and it does not exist.**
> You wrote: *"How do I cancel all converting?? I accidentally clicked to convert all 5000 chapters."*
> The fix is not a better cancel button — it is a confirmation step that says
> **"5,000 chapters · 14.2M words · ≈ 62 hours · ≈ 19M Groq tokens. Proceed?"** with a typed
> confirmation for anything over 100 chapters.

---

## 4. Surface 3 — Queue / Activity (❌ entirely missing, and it is the root of your pain)

You repeatedly said *"I want transparent logs"*, *"I can't see deep logs"*, *"sometimes I see console
sometimes I don't"*. The reason is architectural: **there is no queue and no log store.**
Logs are ephemeral socket events rendered into a panel that gets wiped and re-created every time
you start another conversion.

**Requirements:**

1. A **global job queue** with a visible list: Queued / Running / Done / Failed / Cancelled.
2. **Concurrency limit** (default 1 for Groq, 2 for TTS) — configurable. Jobs wait their turn.
3. **Every job row** shows: book, chapters, language, style, model, progress, ETA, and
   `[Pause] [Cancel] [Retry failed only]`.
4. **Master log terminal** — monospace, colour-coded by level, **persisted to disk and DB**,
   filterable by book / chapter / level, searchable, with `[Copy] [Download .log] [Clear]`,
   and an **auto-scroll lock** toggle.
5. Log lines are **structured**, not prose:
   `[23:04:11.221] [INFO ] [ch:14] [tts ] chunk 7/12 → 41.2s audio, 118KB, 3.1s wall`
   `[23:04:19.884] [ERROR] [ch:15] [groq] 429 rate_limit_exceeded TPM 6000/6000 retry_after=8s attempt 1/5`
6. **Nothing is sanitised.** Raw provider error bodies are shown verbatim (you asked for this
   explicitly — *"without any coating"*).
7. Logs **survive reload** — on page load, the last 500 lines for the current book are fetched
   from `GET /api/logs?bookId=…`.

**Per-chapter log drawer:** clicking `❯` on a chapter row expands the *full* log history for
*that chapter only*, including all previous attempts. This is the feature you asked for three
separate times and it has never fully existed.

---

## 5. Conversion — the exact contract

### 5.1 The pipeline (must be shown to the user as 5 named stages)

```
1. PREPARE   split chapter into token-aware chunks        →  "12 chunks, 9,140 tokens est."
2. SCRIPT    obtain the text that will be spoken:
             a) custom script (verbatim, no AI)     ── or ──
             b) AI Hinglish retell (Groq, styled)   ── or ──
             c) original English (no transform)
3. SYNTH     edge-tts per chunk → mp3 + vtt
4. STITCH    ffmpeg concat + VTT timestamp shift
5. INDEX     store version row, duration, size, alignment map
```
Each stage emits `stage:start`, `stage:progress`, `stage:end` with numbers. The UI shows a
5-dot stepper on the chapter row. ⚠️ Today only 2 vague phases exist.

### 5.2 The version object — **THE central data fix**

> **This is the most important change in this document.** Today, `chapters.translated_content`
> is a **single column**. Every conversion overwrites it. That single design flaw causes at
> least five of the bugs you reported: custom scripts silently replaced by AI text, "translated"
> reader view showing the wrong style, re-convert appearing to replace the old audio,
> and the custom-script option being enabled when no custom script exists.

**New table (replaces the overloaded column):**

```sql
CREATE TABLE chapter_scripts (
  id              TEXT PRIMARY KEY,
  chapter_id      TEXT NOT NULL,
  source          TEXT NOT NULL,   -- 'ai' | 'custom' | 'original'
  language        TEXT NOT NULL,   -- 'en' | 'hi'
  script_kind     TEXT,            -- 'devanagari' | 'roman_hinglish' | 'mixed'  (auto-detected)
  style           TEXT,            -- 'novel' | 'formal' | 'casual' | 'custom'
  provider        TEXT,            -- 'groq' | 'google' | 'none'
  model           TEXT,
  prompt_version  TEXT,            -- so you can diff prompt revisions later
  content         TEXT NOT NULL,
  token_count     INTEGER,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE audio_files ADD COLUMN script_id TEXT;      -- ← audio now points at the exact script
ALTER TABLE audio_files ADD COLUMN label TEXT;          -- user-renameable "Madhur / Novel / v3"
ALTER TABLE audio_files ADD COLUMN is_favourite INTEGER DEFAULT 0;
ALTER TABLE audio_files ADD COLUMN alignment_json TEXT; -- sentence↔time map, see §7
ALTER TABLE audio_files ADD COLUMN speaking_rate REAL DEFAULT 1.0;
ALTER TABLE audio_files ADD COLUMN provider_status TEXT; -- 'groq_ok' | 'google_fallback' | 'custom'
```

**Consequences (all of them things you asked for):**
- Re-convert genuinely coexists — a new script row and a new audio row, nothing overwritten.
- The reader's "Translated" tab gets a **script selector** (`Which version am I reading?`).
- The badge on an audio version can never lie about its style, because it references the exact script.
- A custom script is never clobbered by an AI run.
- You can diff two Hinglish versions side by side. 💡

### 5.3 Answering your direct questions

> **"Would the different audio of the same chapter coexist?"**
> Yes — that is now enforced by the schema. Grouped under the chapter, sorted **newest first
> by default**, user-sortable, each with a delete. Never auto-replaced.

> **"Custom script — must it be Devanagari or Hinglish? Am I free to use any?"**
> **You are free to use either, and you may mix them in one paragraph.** edge-tts with a
> `hi-IN` voice (Swara / Madhur) reads Devanagari natively. Roman Hinglish (`"Woh ek naya
> hunter tha"`) is **not** reliably read by a `hi-IN` voice and is **not** read correctly by an
> `en-IN` voice either — it produces English phonetics on Hindi words.
> **Therefore the required behaviour is:**
> 1. Auto-detect the script (Devanagari code-block ratio > 25% → Devanagari, else Roman).
> 2. If Roman Hinglish is detected → **transliterate to Devanagari** before TTS, while
>    keeping ASCII-preserved terms (names, `System`, `Level`, `HP`, `Dungeon`) as-is so the
>    voice pronounces them in English.
> 3. Show the user a **preview of exactly what will be sent to TTS**, with a
>    "Devanagari (auto-converted from Hinglish)" badge, and let them edit it.
> This resolves your confusion: *"is it different audio that converts Hinglish to Hindi audio or
> Devanagari to Hindi audio?"* — **there is only one TTS engine; the difference is a
> pre-processing step, and it must be visible.**

> **"Would the custom script be used directly with no more changes?"**
> Yes — `source='custom'` bypasses translation entirely. The **only** transformation permitted
> is the transliteration above, and it must be opt-out with a checkbox
> `☐ Send my text to TTS byte-for-byte (advanced)`.

> **"Is the custom-script UX too complex? Should we do it?"**
> Keep it, but demote it. It is a **power feature for one persona**. The correct placement is:
> **inside the reader's Edit tab** (where it already is — correct) **and** as a
> `Style: ✍️ Custom Script` option in the Convert dialog that is **only enabled when a custom
> script actually exists**, showing its first 60 characters and save date next to it.
> Today it is enabled whenever *any* `translated_content` exists — including AI output —
> which is exactly why your custom script "didn't get used". That is bug **B2**.

### 5.4 The Convert dialog — one unified, non-confusing flow

You wrote: *"when we click on new version it automatically starts converting without asking
which language or which style… there should be a uniform and non-confusing system."*

**Required dialog (identical for single chapter, re-convert, and batch):**

```
Convert — "Chapter 14: The System Awakens"        [× ]
─────────────────────────────────────────────────────
Scope     ● This chapter   ○ 12 selected chapters

Output    [ English ] [ Hinglish / Hindi ]          ← segmented

Script    ◉ AI retell        ○ Use my saved script (saved 2d ago, 4.1k chars) [view]
                             ○ Original English (no transform)

Style     ┌─────────┐┌─────────┐┌─────────┐┌─────────┐
          │📖 Novel ││🎓 Formal││💬 Casual││⚙ Custom │   ← cards w/ 1-line sample
          └─────────┘└─────────┘└─────────┘└─────────┘

Voice     [ Madhur (Male, Hindi) ▾ ]  [▶ preview 6s]
Speed     [────●────] 1.0×    Pitch [───●─────] 0

Engine    Groq · llama-3.3-70b-versatile ▾   ● key valid · 5,240/6,000 TPM free
          ☑ Fall back to Google Translate if Groq fails  ⚠ output will be literal Hindi

─────────────────────────────────────────────────────
This will create a NEW version. Existing 3 versions are kept.
Estimated: 12 chunks · ~9.1k tokens · ~3 min

                          [ Cancel ]  [ Start conversion ]
```

**Rules:**
- **Nothing ever starts a job without this dialog.** No hidden defaults.
- Every field is pre-filled from the preset; changing it here optionally updates the preset.
- The bottom line always states plainly that a **new version** is being created.
- For batch >100 chapters, the button changes to a typed confirmation.

---

## 6. The Hinglish Storytelling Engine (Pillar 1 — spec)

### 6.1 Style catalogue (final)

| Key | Name | Voice of | Use for | Script |
|---|---|---|---|---|
| `novel` | 📖 Web Novel / LitRPG | A YouTube chapter-explainer narrating a story | web novels, fantasy, LitRPG | Hinglish → Devanagari |
| `formal` | 🎓 Formal / Educational | A textbook narrator | non-fiction, study material | Pure Devanagari |
| `casual` | 💬 Casual Storytelling | A friend telling you what happened | slice-of-life, memoirs, blogs | Hinglish → Devanagari |
| `dramatic` | 🎭 Cinematic / Dramatic 💡 | A film narrator | thrillers, action | Hinglish |
| `kids` | 🧸 Simple / Kids 💡 | Bedtime story | children's books | Simple Hindi |
| `custom` | ✍️ Custom Script | You | anything | As pasted |

Each style card must show a **real 2-line sample of its output** so the choice is obvious
without trial and error. ❌ MISSING — today it's a bare `<select>` with abstract labels.

### 6.2 The master prompt (your words, formalised — `prompt_version: v2`)

```
SYSTEM:
You are a Hindi story narrator, not a translator. You retell English stories in the spoken
Hinglish of everyday Indian conversation — the way a popular YouTube chapter-explainer talks.

HARD RULES
1. Retell, never translate. Read the passage, understand it, then say it again in Hinglish.
   Word-for-word translation is a failure.
2. Use everyday spoken Hindi. If a word is not used in normal conversation, do not use it.
   BANNED (examples): दैनिक, स्वास्थ्य (when it means a game stat), अध्ययन, कार्य, प्राप्त,
   गमन, उपलब्धि, स्तर, कौशल, अनुसूची.
   USE INSTEAD: रोज़, health, padhai, kaam, mila, gaya, achievement, level, skill.
3. Keep in English, unchanged: character names, place names, System/Quest/Level/HP/MP/XP/
   Skill/Item/Inventory/Boss/Dungeon/Guild/Rank/Class/Stats/Title, brand names, and any
   term that a Hindi speaker would naturally say in English.
4. Context decides the word. "health" in a fight = "health", in a doctor's office = "sehat".
   Never mechanically map a word to one Hindi equivalent.
5. Dialogue must sound like a real person speaking, including "yaar", "arre", "matlab",
   "bhai", "achha" where natural. Never formal literary Hindi in dialogue.
6. Narration must be smooth and cinematic, in short sentences, because it will be read aloud.
   Aim for 12–18 words per sentence.
7. Preserve every event, every emotion, every line of dialogue, and the order of the scene.
   Do not summarise, do not add, do not moralise, do not skip.
8. Keep paragraph breaks. Use natural punctuation for breathing room.
9. Numbers, stats and system messages stay in digits and English formatting.
10. Output ONLY the retold story. No preamble, no "Here is the translation", no markdown,
    no notes, no headings.

OUTPUT SCRIPT: {devanagari | roman_hinglish}
STYLE: {style block}
CONTINUITY: previous chunk ended with: "...{last 200 chars}"  ← so tone and tense carry over
GLOSSARY (always keep exactly as written): {book glossary terms}
```

### 6.3 Two things that will make the Hinglish dramatically better (💡, and cheap)

1. **Per-book glossary.** Extract the top proper nouns / capitalised terms once at parse time,
   store them, show them in a book-settings panel where the user can edit them, and inject
   them into **every** chunk prompt. This is the single highest-leverage quality fix: it stops
   "Quinn" becoming "क्विन" in chunk 3 and "Queen" in chunk 7. Consistency across a 5000-chapter
   novel is impossible without it.
2. **Chunk continuity.** Pass the last ~200 characters of the previous chunk's output as
   context. Today each chunk is translated in total isolation, which is why tone drifts
   mid-chapter and sentences get re-introduced awkwardly at chunk seams.

3. 💡 **Quality self-check pass (optional, toggle):** a second cheap model call that scores the
   output for "did any banned formal word appear / did any name change / is length within 0.8–1.4×
   of source" and auto-retries once if it fails. Logged transparently.

### 6.4 Rate-limit handling — mandatory, and currently wrong

Your 413 error (`Limit 6000 TPM, Requested 9459`) happened because chunks are sized in
**characters**, not **tokens**, and because `max_tokens: 2000` is added on top.

**Required:**
- Size chunks by **estimated tokens** (`chars/3.2` for Devanagari-bound English, be conservative).
- Budget: `input_tokens + max_tokens ≤ 70% of TPM limit`.
- A **token-bucket rate limiter** that paces requests against the *actual* TPM/RPM of the tier,
  shared across all concurrent jobs.
- On `429`/`413`: read `retry-after`, **wait and retry the same model** with exponential backoff
  (5 attempts) — **do not** switch model, because all models share the org's TPM budget.
  This is the flaw in the current fallback chain you correctly suspected.
- On `model_decommissioned`: refetch the live model list from `GET https://api.groq.com/openai/v1/models`
  and pick the best available. **`mixtral-8x7b-32768` in the current fallback array is dead.**
- `max_tokens` must be **dynamic**: `min(model_limit, input_tokens × 1.8)` — Hinglish output is
  longer than English input, and the current fixed 2000 silently truncates chapters mid-sentence.
- Google Translate fallback must be **opt-in**, and when used, the version is tagged
  `⚠️ Literal Hindi (Google fallback)` in the UI — never presented as if it were your style.
- The UI shows a live **quota chip**: `5,240 / 6,000 TPM · resets in 34s`.

---

## 7. Reading + Karaoke Highlighting (Pillar 3 — spec)

### 7.1 The reader

- Three tabs: **Original (English)** · **Translated (script selector ▾)** · **Edit / Custom Script**. ✅
- 💡 **Fourth mode: Side-by-side** (English ‖ Hinglish, synchronised scroll) — you implied it with
  *"both views can be previewed"*, and it is the best way to sanity-check a translation.
- Typography toolbar: A− / A+, font family (Sans / Serif / Mono / **Devanagari-optimised**),
  line height, **letter spacing** 💡, **column measure** 💡, theme (Dark / Sepia / Light / OLED),
  fullscreen. ✅ mostly built — add a Devanagari font (Noto Serif Devanagari); the current
  Georgia stack renders Hindi in an ugly fallback.
- 💡 Reading position memory per chapter, `Continue reading` on the book card.
- 💡 Keyboard: `←/→` chapter, `space` play/pause, `f` fullscreen, `+/-` font, `Esc` close.
- 💡 Bookmarks & highlights with a notes sidebar.
- 💡 Sleep timer & "stop at end of chapter" in the player.

### 7.2 Highlighting — the part that has never actually worked

**Current implementation is proportional guessing:**
`paraIdx = floor(cueIdx / totalCues × totalParas)`. It drifts badly, and it is
**structurally impossible** to make it work when the reader shows **English** while the audio
speaks **Hinglish**, because the two texts have different paragraph counts.

**Required implementation — build a real alignment map at synthesis time:**

1. Before TTS, split the **spoken script** into sentences and assign each an index.
2. Synthesise per chunk; edge-tts returns a VTT with **word-level** boundaries.
3. Accumulate chunk durations (already done) and produce:
   `alignment_json = [{ sIdx, start, end, charStart, charEnd }, …]` for the **spoken** text.
4. Store the **spoken text** as its own script row (§5.2) so the Translated tab renders exactly
   the sentences that were spoken → highlighting is then **exact**, not estimated.
5. For the **English** tab, build a **sentence-to-sentence map** English↔Hinglish. Cheapest
   reliable method: ask the model to emit `⟦n⟧` sentence markers in its output, strip them
   before TTS, and keep the mapping. This gives true bilingual karaoke — which is what you asked
   for and is currently faked.
6. Highlighting granularity: **sentence** by default, **paragraph** as a fallback,
   **word** as a 💡 stretch (VTT already has word boundaries).
7. Seeking: clicking any sentence jumps the audio to `alignment[sIdx].start` — exact, both
   directions. Auto-scroll with a "user has scrolled → pause auto-scroll → [Resume follow]"
   affordance 💡 (otherwise the page fights the reader).
8. 💡 Export `.srt` / `.vtt` alongside the mp3.

---

## 8. Player

✅ built: sticky bar, play/pause, prev/next, seek, speed, subtitle line.

Required fixes and additions:
- ⚠️ **"Pitch" is not pitch.** It is a 500 Hz peaking EQ filter — it changes timbre, not pitch,
  and the label is misleading. Use `audio.preservesPitch = false` with `playbackRate` for a true
  pitch shift, or rename the control to **"Tone / Warmth"**. Be honest in the label.
- ⚠️ **Next/Prev is broken by design**: it walks `state.audioFiles`, which is ordered
  `is_merged DESC, created_at DESC` — so "next chapter" plays a random old version of a random
  chapter. It must walk a **playlist**, not the raw audio table. (Bug B5.)
- ❌ **Playlist / queue**: "Play all from here", "Play only Hinglish versions", shuffle off,
  continuous playback across chapters, visible up-next list. You asked for *"like a playlist"*.
- ❌ Volume control, ±15s skip, A-B repeat, sleep timer, mini/expanded player.
- ❌ **Media Session API** — lock-screen controls, chapter title, book art. Essential for a
  commute listener; 20 lines of code.
- ❌ Resume playback position per audio version (`localStorage` + DB).
- ❌ Persist speed/volume preference.

---

## 9. Library & storage (Surface 2)

Required:
- Grid/list toggle, cover art, author, chapter count, **converted count**, **total audio duration**,
  **disk usage**, last opened. ⚠️ only title/author/status today.
- Search & sort books; filter "has audio".
- Book actions: Open, Rename, **Re-parse EPUB**, Export (zip of mp3 + scripts + metadata),
  **Delete (with an explicit "also delete N audio files, X MB" confirmation)**.
- ❌ **M4B export** with embedded chapter markers and cover art — this is the real
  "Download Complete Audiobook" deliverable, and the current button is not even wired up (B7).
- ❌ Storage panel: total used, per-book breakdown, "delete all versions older than the newest",
  orphaned-file cleanup.
- ❌ Global search across all books' chapter text.
- 💡 Import/export the whole app state (you already asked for a text-packer script — make that a
  first-class **Backup / Restore** feature in Settings).

---

## 10. Settings (Surface 4 — ❌ entirely missing)

- API keys (Groq, and future providers) with **Test connection** and quota display; stored
  encrypted, **never** returned by any API response.
- Default preset (language, voice, style, speed).
- Concurrency & rate-limit tuning.
- **Prompt editor** — view and edit the master prompt and each style block, with versioning and
  "reset to default". You care deeply about the prompt; make it editable instead of shipping a
  new build every time you refine it.
- Glossary manager (global + per-book).
- Log retention, log level.
- Data: DB location, backup, restore, wipe.
- Theme.

---

## 11. Error handling & edge cases — the complete checklist

| Scenario | Required behaviour | Today |
|---|---|---|
| Groq key missing but Hinglish selected | Block at the dialog with an inline explanation + link | ⚠️ silently falls back to literal Google Hindi |
| Groq key invalid / expired | Named error, key chip turns red, job pauses (not fails) | ❌ |
| Groq 429/413 TPM | Backoff + retry same model, live countdown in log | ❌ switches model, then dies |
| Groq model decommissioned | Auto-refresh model list, log the swap | ❌ |
| Model returns preamble ("Here is…") | Strip known preambles, log that it was stripped | ❌ |
| Model output empty / truncated | Detect (< 40% of source length) → retry with smaller chunk | ❌ |
| `edge-tts` binary not installed | Detect at startup, show a blocking setup banner with install command | ❌ crashes per chapter |
| `ffmpeg` / `ffprobe` missing | Same as above | ❌ |
| edge-tts transient 503 | Retry chunk 3× with backoff | ❌ |
| Chapter is empty / < 50 chars | Skip with a labelled reason, not silence | ⚠️ silently dropped at parse — user sees a gap in chapter numbering with no explanation |
| EPUB has no TOC / weird flow | Fallback splitter + manual chapter merge/split UI 💡 | ❌ |
| DRM-protected EPUB | Clear error message | ❌ |
| Duplicate upload of the same book | Detect by content hash (`utils/hash.js` exists, unused!) → offer "open existing" | ❌ |
| Server restarts mid-job | On boot, mark orphaned `processing` jobs as `interrupted` and offer Resume | ❌ jobs are silently lost; book stays locked in `processing` |
| Book stuck in `processing` | Self-healing on boot + a manual "Reset status" | ⚠️ **this is your "book is not ready for generation" error** |
| Disk full | Pre-flight free-space check, graceful abort | ❌ |
| Audio file deleted off disk but row exists | Row shows `⚠ file missing` + Re-generate | ⚠️ 404 on play, no explanation |
| Two conversions of the same chapter at once | Block with "already converting" or queue it | ❌ allowed, races |
| Cancel mid-chapter | Abort the current chunk, clean up temp dir | ❌ finishes the whole chapter first |
| Browser closed mid-job | Job continues server-side, UI reattaches on return and backfills logs | ⚠️ job continues, UI shows nothing |
| Very long chapter (50k+ words) | Warn + allow split | ❌ |
| Network drop | Socket auto-reconnect + state resync | ⚠️ reconnect only |
| Non-Latin / RTL titles | Correct rendering & filesystem-safe filenames | ⚠️ filename sanitiser strips all non-ASCII, so Hindi titles → `_______` |

---

## 12. Non-functional requirements

- **Performance:** a 5,000-chapter book must render in < 300 ms and scroll at 60 fps →
  **virtualised list mandatory** (see B10). Full re-render of the whole list on every socket
  event must be replaced with targeted row patching.
- **Resumability:** every job survives a restart; every chapter is idempotent.
- **Offline-first:** everything except the AI call works with no internet.
- **Accessibility:** keyboard-navigable, ARIA labels on every icon button, focus rings,
  status conveyed by icon+text not colour alone, AA contrast, `prefers-reduced-motion`.
- **Responsive:** the workspace must collapse to a single column below 1024 px, and the rails
  become bottom sheets below 768 px. **Currently hard-coded to a 320 px sidebar with inline
  flex — it is unusable on a phone.**
- **Security:** API keys encrypted at rest, never logged, never serialised into API responses,
  path traversal blocked on all file routes, upload MIME + magic-byte validation, size cap.
- **Maintainability:** the frontend is one 1,733-line file with inline styles in template
  strings. It must be split into components with a real CSS layer (see §13.2).

---

## 13. What a developer should build, in order

### Phase 0 — Stop the bleeding (1 week)
B1 script versioning schema · B3 socket listener leak · B5 playlist ordering · B7 dead download
button · B8 Windows path bug · B12 persistent errors · job queue with concurrency 1 ·
token-aware chunking + backoff · startup dependency check (edge-tts/ffmpeg) · orphaned-job recovery.

### Phase 1 — Transparency (1 week)
Log persistence + `/api/logs` · Queue surface · per-chapter log drawer · per-chapter cancel &
retry · real ETA · batch cost estimate + big-batch confirmation.

### Phase 2 — Correctness of the product promise (2 weeks)
Alignment map & true karaoke · glossary · chunk continuity · prompt v2 + prompt editor ·
transliteration pipeline with a "what will be spoken" preview · style cards with samples.

### Phase 3 — Craft (2 weeks)
Virtualised list · responsive layout · component/CSS refactor · Settings surface · player
playlist + Media Session · M4B export · library stats & storage manager.

### Phase 4 — Delight (💡)
Side-by-side reader · bookmarks/notes · voice preview · multi-voice dialogue casting ·
version A/B compare · podcast RSS feed for the phone · reading/listening statistics.

### 13.2 Suggested frontend structure

```
src/
  components/   ChapterRow.js  ChapterList.js  ConvertDialog.js  VersionModal.js
                Reader.js  Player.js  LogTerminal.js  QueuePanel.js  Toast.js
  store/        state.js (single observable store, no scattered globals)
  styles/       tokens.css  components/*.css   ← delete every inline style in JS
  services/     api.js  socket.js (with a single subscribe/teardown lifecycle)
```

---

## 14. Definition of Done — the acceptance checklist

- [ ] I can convert the same chapter 5 times with 5 different styles and all 5 audios remain, correctly labelled, newest first.
- [ ] I can paste a Hinglish script and the audio speaks **exactly** that text; the UI shows a "Custom Script" badge and a preview of exactly what was sent to TTS.
- [ ] Nothing ever starts converting without me choosing language, voice, and style.
- [ ] I can see, at any moment, a raw scrolling terminal of what the backend is doing, per chapter, and it is still there after I reload the page.
- [ ] A failed chapter shows a red row with the raw provider error and a one-click Retry.
- [ ] I can cancel one chapter, or the whole batch, and it stops within 5 seconds.
- [ ] Selecting 5,000 chapters warns me with time and token estimates before anything runs.
- [ ] While audio plays, the exact sentence being spoken is highlighted, in both the English and the Hinglish view, and clicking any sentence seeks there.
- [ ] Closing the browser and reopening it restores: the book, the chapter list, all versions, the running job, its progress, and its logs.
- [ ] A 5,000-chapter book scrolls smoothly.
- [ ] The Hinglish output never contains दैनिक/स्वास्थ्य-style textbook Hindi, and character names never change spelling across chapters.
- [ ] The app is usable on a phone.
- [ ] `Download Complete Audiobook` produces an M4B with chapter markers.

---

*Companion document: `08_CODE_REVIEW_AND_GAP_ANALYSIS.md` — the concrete bug list with file
and line references.*
