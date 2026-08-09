# Custom Scripts & Audio Version Provenance

_Last updated: 8 August 2026_

Covers prompts **#48, #50 and #52** — the custom script feature, and the
"I can't tell how this audio was made" problem.

---

## 1. The problems reported

| # | Report | Root cause |
|---|--------|-----------|
| 50 | "I add my custom script and convert to audio, it still not getting converted to that custom script" | The UI never sent `scriptSource` to the backend. The API always defaulted to `ai`, so the pasted script was ignored and the AI re-translated the chapter. |
| 52 | "In the audio setting there is option to select the custom script but which script would it select?" | "Custom script" was smuggled in as a *translation style* (`style = custom`) rather than a script source. It was not tied to any particular chapter's script. |
| 52 | "When we click on new version it automatically start converting without asking which language or style" | `+ New Version` called the generation function directly, reusing whatever settings were last used. |
| 42 / 50 | "There is no indication which language / voice / style / method the chapter was converted with" | `audio_files` stored `translation_style` but not which *text* was spoken, so the UI inferred it — and inferred wrong for custom scripts. |
| — | Audio generation blocked | Pre-flight probed `ffmpeg` on `PATH`, but the pipeline actually runs the bundled `ffmpeg-static` binary. False failure. |

---

## 2. Script source is now an explicit, first-class choice

Every conversion must state **which text gets spoken**. There are exactly three
valid values, validated server-side in `POST /api/books/:id/convert`:

| `scriptSource` | What is spoken | AI used? |
|---|---|---|
| `ai` | A fresh AI retelling in the selected style | Yes |
| `custom` | Your saved script, **verbatim** | No |
| `original` | The untouched book text | No |

Anything else is rejected with `400 Invalid script source`.

### Guarantees for `custom`

- The text is used **byte-identical** to what was pasted. No cleanup, no
  re-translation, no style applied.
- **Both scripts are accepted** — Hinglish in Latin letters *and* Hindi in
  Devanagari. The backend detects which (`detectScript`) and reports it; the
  voice handles either. You are not locked to one.
- If you pick `custom` but no script is saved, the request is **refused up
  front** with the exact chapter numbers listed — it never starts a job and
  fails halfway.
- Custom scripts live in their own `chapter_scripts` row with `source='custom'`,
  so an AI run can never overwrite hand-written text.

---

## 3. The unified Convert dialog

`+ New Version`, `Re-convert` and first-time `Convert` **all open the same
dialog**. Nothing ever starts from stale or implicit settings.

The dialog asks, in order:

1. **Target language** — populated from the backend catalog, never hardcoded.
2. **What text should be spoken?** — the three sources above as radio cards.
   - "My saved script" is **disabled with the reason shown** (`None saved`)
     unless a script exists for *that specific chapter*, answering "which
     script would it select?" unambiguously.
   - A `✍️ Paste / edit my script` link opens the editor inline.
3. **Storytelling style** — shown **only** when the source is `ai`, because
   style has no effect otherwise. Showing it would imply a setting that gets
   ignored.
4. **AI voice.**

A plain-English summary line states exactly what will be generated before you
commit, e.g.
`Will generate: Your saved script, spoken verbatim · voice Swara (Female, Indian)`.

The subtitle confirms existing versions are safe:
_"2 versions already saved. This adds another — nothing is overwritten."_

---

## 4. The script editor

Opened from the Convert dialog or the chapter reader.

- Live check as you type reports **detected script, word count and character
  count** — "this is exactly what will be spoken", no surprises.
- `Save script` stores it and reopens the Convert dialog with **My saved
  script** now enabled.
- `Delete script` removes it; **existing audio is kept**.

---

## 5. Provenance: every version says how it was made

`audio_files.script_id` already pointed at the script row, and that row knows
its own `source`. Rather than duplicate the field, the audio queries now
`LEFT JOIN chapter_scripts` and expose `scriptSource` on every audio object.

> ⚠️ The table is `chapter_scripts`, **not** `scripts`. Joining the wrong name
> returns a `500` on every audio endpoint.

The UI renders one shared badge row (`audioBadges()` in `src/main.js`) used by
the chapter row, the version dropdown and the versions modal — previously three
copies that drifted apart:

| Badge | Meaning |
|---|---|
| 🌐 Hinglish / English | Output language |
| ✍️ My script | Spoken word-for-word, no AI |
| 🤖 AI retelling | Rewritten by AI in the style shown |
| 📖 Original text | Untouched book text |
| 🎤 Voice | Neural voice used |
| 🎭 Style | **Only** shown for AI runs |
| 📅 Date | Conversion time, newest first |

---

## 6. Pre-flight now probes the real binaries

`ffmpeg-static` and `ffprobe-static` are project dependencies, and the pipeline
invokes those exact paths. Pre-flight was probing `PATH` instead, reporting a
false failure that blocked the Convert dialog even though FFmpeg worked.

It now probes the **same binaries the pipeline uses**, and reports them as
`bundled: true`. Audio generation is unblocked with no manual install.

---

## 7. Verification

| Suite | Covers | Result |
|---|---|---|
| `npm test` (`scripts/test-sync.js`) | Sentence↔time alignment is an exact inverse; refuses to guess when unsyncable | 19 passed |
| `scripts/test-custom-script.js` | Both scripts accepted, verbatim storage, `source='custom'`, custom wins in reader, 0 AI work estimated, bad source rejected | 8 passed |
| `scripts/check-audio-meta.js` | Every stored version reports its `scriptSource` | ✅ all versions |

A real end-to-end conversion using `scriptSource: 'custom'` completed and
coexists with an `original` version of the same chapter — confirming versions
accumulate rather than replace.
