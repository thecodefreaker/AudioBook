# Audiobook Studio — Product Experience Specification

> **Vision:** When a new user lands on the page, the app should not feel like a dashboard. It should feel like an **audiobook studio** — calm, focused, and premium.

---

## 1. First Impression (Landing Experience)

The entire center of the screen should present a welcoming **hero experience**:

- A beautiful illustration of a book transforming into audio.
- A large headline, e.g. **"Transform EPUBs into Professional Audiobooks."**
- Only **two obvious actions**:
    - **Upload EPUB**
    - **Open Library**

Nothing else competes for attention.

**Goals**
- The user understands the product's purpose within **3 seconds**.
- The screen feels **spacious, calm, and premium**.

> 💡 **Recommendation:** Add a subtle background gradient or animation to reinforce the "studio" feeling without adding clutter.

---

## 2. Uploading a Book

The moment an EPUB is dropped, the page should **react**.

- The upload area expands slightly and shows live progress.
- Instead of a generic spinner, the app **narrates the process**:

| Step | Message |
| ---- | ------- |
| 1 | Reading EPUB |
| 2 | Extracting chapters |
| 3 | Building workspace |
| 4 | Ready |

**Goals**
- The user never feels lost.
- The interface feels **intelligent**.

---

## 3. Workspace Appears

After upload, the app smoothly transforms into a **production studio** environment.

- **Left:** a slim navigation rail — clean and modern (think Notion, Linear, or Spotify).
    - Not a giant sidebar full of cards.

> 💡 **Recommendation:** Use icon-first navigation with tooltips to keep the rail minimal.

---

## 4. Main Workspace

The center focuses entirely on the **current book**:

- Book cover
- Book title
- Key information:
    - **13 Chapters**
    - **34,000 Words**
    - **Estimated Length:** 3h 42m
    - **Audiobook Progress:** 72%
- Quick access details:
    - Converted chapters
    - Last read chapter
    - Bookmarked chapters
    - Add to collection / favorites

**Goals**
- Everything important is visible instantly.
- The user always knows where they are.

---

## 5. Chapter Experience

Instead of table rows, chapters feel like **content cards**.

Each card shows:

- Chapter Name
- Status
- Duration
- Voice Used

**Visual states**
- **Ready:** looks completed.
- **Generating:** shows progress.
- **Untouched:** clearly invites action.

> The user never needs to guess.

---

## 6. Opening a Chapter (Immersive Mode)

Clicking a chapter shifts into an **immersive reading mode** with a two-pane layout.

### Left — EPUB Reader
- Spacious and comfortable.
- Large margins.
- Excellent typography.
- Proper reading width.
- Feels like reading an ebook, not scanning a webpage.

> ⚠️ **Note:** Current reader functionality must be maintained.

### Right — Listening Experience
Everything related to audio:
- Waveform
- Play controls
- Voice information
- Duration
- Playback speed
- Audio status

**Why this matters:** Users can read and listen **side by side** to verify audiobook quality — a professional, essential workflow.

---

## 7. Global Audio Player

The most important missing element is a **permanent player**.

- Fixed to the bottom of the app, similar to Spotify.
- Always available across **Library, Reader, Voices, and Exports**.
- One click starts audio — no hunting for buttons, no reopening chapters.

### Chapter Navigation
The player must include **Next Chapter** and **Previous Chapter** controls, letting users move through the audiobook without returning to the chapter list.

> 💡 **Recommendation:** Include a chapter dropdown in the player for quick jumps across long books.

---

## 8. Voice Selection Experience

Voice selection should feel like **choosing a narrator**, not editing a settings dropdown.

Each voice appears as a **card** showing:

- Voice Name
- Voice Character
- Accent
- Sample Duration
- Play button (preview)

Hovering or clicking preview plays the voice instantly — building confidence and making the experience **emotional rather than technical**.

---

## 9. Batch Generation

Controls appear **only when needed**.

- Selecting multiple chapters slides in a **floating toolbar**:
    - **3 Chapters Selected**
    - Generate
    - Change Voice
    - Export
    - Delete
- When nothing is selected, the toolbar disappears.

> The interface stays clean.

---

## 10. Background Processing

Work should happen **without interrupting the user**.

- Generation runs in the background.
- A small corner status area reports progress:
    - Chapter 1: Complete
    - Chapter 2: 64%
    - Chapter 3: 92%
- The user can keep reading while generation continues.

> The app feels powerful.

---

## 11. Library Experience

The library should feel like a **collection of books**, not a list of files.

Each audiobook displays:

- Cover
- Title
- Progress
- Duration
- Completion Status

Users identify books **visually**, not by filename.

---

## 12. Completion Experience

When generation finishes, the book feels **transformed**.

- Status changes from **"Generating"** → **"Audiobook Ready"**.
- Actions presented:
    - Listen
    - Download
    - Export ZIP
    - Open Audiobook
- Success is celebrated **subtly** — polished, not flashy.

> The user feels rewarded.

---

## How the UI Helps the User

A great UI constantly answers three questions:

### Where am I?
- Current book, current chapter, and generation status are always visible.

### What can I do next?
- One primary action always stands out: **Upload · Generate · Play · Download**.
- No decision fatigue.

### What is happening?
- Every generation process, background task, and completion is visible.
- The system constantly communicates.

---

## Final Feeling

Using the redesigned version should feel like being inside a **professional Audiobook Creation Studio** — not an admin dashboard.

The experience should be **calm, focused, and trustworthy**:

> The user uploads a book, immediately understands the structure, generates audio naturally, listens without friction, and always knows what to do next.

Every area has a purpose. Every action is where people expect it. The product feels **effortless** even while doing complex work.

That is the difference between a tool people **use** and a tool people **love**.
