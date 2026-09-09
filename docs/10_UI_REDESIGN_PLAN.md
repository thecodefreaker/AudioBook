# UI/UX Redesign — Plan

## The core problem: the app pretends to be a wizard

The page is a vertical stack of numbered steps:

```
Step 1  Upload Your Book
Step 2  Chapter Workspace     (settings sidebar + chapter list)
Step 3  Progress              (+ log console)
Step 4  Results               (+ audiobook panel)
```

A wizard is right for a one-time, linear task. But this app is a **library
tool**: you upload once and come back to the same book many times — to convert
another chapter, try another style, read along, download the book. On the
second visit the wizard is actively wrong:

- "Step 1: Upload Your Book" sits at the top even when you opened an existing
  book — the first thing you see is irrelevant.
- Progress and Results are *further down the page* than the chapter list, so
  clicking Convert appears to do nothing until you scroll.
- The complete-audiobook panel — the app's whole purpose — is at the very
  bottom, below the fold.
- The log console is buried inside the Progress step, so it vanishes whenever
  that section is hidden. **This is the actual cause of "sometimes I see the
  console, sometimes I don't."**

That single structural mistake explains a large share of the reported
confusion. It is not a styling problem.

## The fix: one workspace, three fixed regions

Replace the step stack with a stable layout where every element has a permanent
home, so nothing ever moves or disappears:

```
┌──────────────────────────────────────────────────────────┐
│ Header · book title · library · settings                 │
├──────────────┬───────────────────────────────────────────┤
│              │                                           │
│  Sidebar     │   Chapter list  (scrolls independently)   │
│  (sticky)    │                                           │
│  · Book      │   search · filter tabs                    │
│  · Progress  │   ─────────────────────────────────────   │
│  · Audiobook │   chapter rows                            │
│  · Settings  │                                           │
│              │                                           │
├──────────────┴───────────────────────────────────────────┤
│ Player (only when audio is loaded) · Log console (docked) │
└──────────────────────────────────────────────────────────┘
```

Principles:

1. **Fixed positions.** Progress appears *in place* in the sidebar rather than
   revealing a new section that shifts the page.
2. **Independent scrolling.** The chapter list scrolls; the sidebar and player
   stay put. No more losing the Convert button by scrolling.
3. **The log console is always reachable** — docked at the bottom edge,
   collapsed by default, one click away regardless of app state.
4. **Progressive disclosure.** Upload is a small action once a book exists, not
   a giant permanent drop zone.

## Visual direction: minimal, calm, production-grade

The current theme is a dark purple/blue with gradients, glows and 135 inline
`style="…"` attributes (79 in HTML, 56 generated in JS). Inline styles are why
the UI looks slightly different in each place — they cannot be kept consistent.

- **One neutral surface ramp** instead of five competing greys.
- **Accent used sparingly** — for the primary action and current state only.
  Currently everything glows, so nothing stands out.
- **A real type scale** (6 sizes) rather than ad-hoc `font-size: 11px/12px/13px`.
- **4px spacing grid** so alignment is inherent, not accidental.
- **Motion only where it aids comprehension** (~150ms), respecting
  `prefers-reduced-motion`.
- **Zero inline styles.** Every visual decision moves into CSS classes, which
  is what makes "minor tweaks" possible later.

## Accessibility (currently missing)

- Visible focus rings; full keyboard reachability
- `aria-live` on progress and toasts so status is announced
- Real `<dialog>` semantics: focus trap, restore focus on close
- Checked contrast — several greys are currently below 4.5:1

## Approach

Ship in slices, verifying after each, so the app keeps working throughout:

1. **Design tokens + primitives** ✅ DONE
2. **Layout shell CSS + markup** ✅ DONE
3. **Chapter list + rows** ✅ DONE
4. Reader + modals — next
5. Inline-style removal, accessibility pass, reduced-motion

---

## Progress

### Slice 1 — tokens & primitives ✅

- `styles/tokens.css` — one surface ramp, 4 text steps, status colours, a
  6-step type scale, a 4px spacing grid, elevation and motion tokens.
  Honours `prefers-reduced-motion`.
- `styles/primitives.css` — buttons, inputs, selects, cards, badges, empty
  states, skeletons, progress bars, focus rings.
- `styles/shell.css` — the fixed three-region workspace.

**Two real bugs found and fixed while doing this:**

1. `index.css` re-declared the whole palette *after* `tokens.css` loaded, so
   the new colours were silently cancelled. The legacy block is now removed and
   the old names are aliased onto the new ramp in one place.
2. `--primary-color` was referenced in `components.css` but **never defined
   anywhere**, even before this change — it silently resolved to nothing. Now
   mapped to the accent.

**New guard:** `scripts/audit-css.js` fails the build if any CSS variable is
used but not defined. Undefined custom properties don't error — they resolve to
nothing and render an element unstyled — so this class of bug is invisible
without a check. It caught 20 broken variables immediately.

Legacy names are aliased rather than renamed everywhere at once, so the new
palette applies instantly and the ~135 inline styles can be migrated
incrementally instead of in one risky pass.

### Slice 3 � chapter list ?

The chapter row is the densest thing in the app and was built from ~20 inline
`style="�"` attributes per row. It now lives in `components/chapterList.js`
with `styles/chapters.css`.

**Three real bugs found and fixed while doing this:**

1. **Listener stacking.** Every render attached fresh listeners to every row,
   and a render was triggered per conversion. After converting ten chapters a
   single click ran through ten live handlers � ten confirm dialogs, ten
   delete requests. Events are now delegated to the container once, so
   re-rendering cannot duplicate behaviour.

2. **Completed chapters could stay looking unconverted.** The reload that
   fetches new audio sat *inside* `if (inlineStatus)`. Whenever that element
   was missing, the new audio was never fetched and the chapter kept showing
   "Convert" until a manual refresh.

3. **Delete ignored the version picker.** A row with several versions let you
   choose one, then deleted the newest regardless. Delete now acts on the
   version being displayed.

Also removed: a *second* chapter list (`#audio-chapter-list`) that rendered on
every job completion into a permanently hidden container � duplicate work and
a duplicate source of truth.

**Behaviour changes that reduce friction:**

- Filtering and sorting are computed from chapter data instead of being read
  back out of rendered HTML, so the list and the counts can no longer disagree.
- Select-all applies to the *visible* chapters. Previously, filtering to three
  chapters and pressing it would queue all 500.
- Progress updates patch the row in place rather than re-rendering the list,
  so long books do not stutter and an open version dropdown is not closed
  mid-click.
- Search matches the chapter number as displayed (1-based).
- Real empty states for "no book open" and "nothing matches".

**New guard:** `scripts/test-chapter-list.js` (11 tests) covers filtering,
sorting and search. This logic was previously untestable because it only
existed as DOM manipulation; making it a pure function is what allows it to be
checked at all. `scripts/audit-dead-css.js` reports rules that can no longer
match � it found 85 after the migration.

**Legacy CSS removed:** the wizard chrome, old header and duplicate chapter and
player rules � 47 rule blocks, plus `index.css` reduced to a genuine base
layer.
