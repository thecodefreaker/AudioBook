# Audiobook AI — Complete UI/UX Overhaul

You are working on an existing Audiobook AI application.

The current UI has accumulated inconsistent layouts, poor responsive behavior, weak information hierarchy, misplaced buttons, unclear interaction feedback, and competing workflows.

I want a **complete UI/UX overhaul**, not a cosmetic CSS cleanup.

Use the existing application, components, routes, data models, API calls, and working functionality as the foundation. **Do not remove working features or invent backend functionality.** Reorganize the interface and improve the UX around the functionality that already exists.

## Product purpose

This application has THREE major user activities:

1. Read books
2. Listen to books
3. Convert chapters/text into audiobooks

These activities must feel like parts of one coherent product.

The application is NOT just an audiobook generator and NOT just a chapter manager.

The reading/listening experience is the primary product experience.

---

# 1. Start with an audit before changing code

First inspect the existing application.

Identify:

* current routes
* page hierarchy
* major components
* shared components
* layout system
* responsive breakpoints
* scroll containers
* fixed/sticky elements
* buttons and action controls
* chapter state/status logic
* audio player logic
* reading/e-reading logic
* conversion workflow
* modal/drawer usage
* duplicated UI patterns
* inconsistent component behavior
* elements causing horizontal overflow
* elements with fixed widths that break smaller screens
* controls whose displayed state does not match application state

Do NOT immediately start rewriting everything.

First establish a mental model of the application and then redesign the UI around that model.

---

# 2. Establish a clear application hierarchy

Use this conceptual structure:

APP
├── Global Navigation
├── Library
├── Book Workspace
│   ├── Book Overview
│   ├── Chapters
│   ├── Reading
│   ├── Listening
│   ├── Conversion
│   └── Notes / Bookmarks
└── Global Audio Player

The user should always understand:

* where they are
* what book they are using
* what chapter they are on
* what action is currently active
* what happens next

---

# 3. Create a dedicated Book Workspace

Do NOT use the current giant chapter-management layout as the main book experience.

When a user opens a book, create a dedicated **Book Workspace**.

Desktop layout:

LEFT
Compact navigation / book navigation

CENTER — PRIMARY CONTENT
Large reading surface

RIGHT — CONTEXT PANEL
One of:

* Chapter information
* Listen
* Convert
* Notes
* Bookmarks

BOTTOM
Persistent audio player

The reading content must be the dominant visual element.

Do NOT place the reading experience as a small section underneath the chapter list.

---

# 4. Reading experience

The reading view is one of the most important parts of the application.

Requirements:

* large readable content area
* comfortable line length
* proper typography
* adjustable font size
* font family
* line height
* reading width
* light/dark/sepia reading themes
* chapter title
* chapter progress
* previous/next chapter
* bookmarks
* highlights
* notes
* translation where supported
* text/audio synchronization where supported

The text container must never become a narrow vertical column because of sibling panels.

The reading area should dynamically use available width.

Never allow accidental horizontal scrolling in the reading experience.

Use:

* max-width for readable text
* centered content
* responsive padding
* responsive typography
* `min-width: 0`
* proper flex/grid sizing
* overflow rules that prevent viewport-level horizontal scrolling

---

# 5. Listening experience

The audiobook player should behave like a first-class product experience.

Desktop:

* persistent bottom player
* chapter title
* book title
* cover
* progress
* elapsed/remaining time
* play/pause
* previous/next
* seek backward/forward
* playback speed
* volume
* queue/chapter list
* sleep timer
* playback settings

The player should have:

* normal state
* playing state
* paused state
* loading state
* buffering state
* error state
* completed state

The button feedback must accurately reflect the actual audio state.

Do not visually show "Pause" when audio is not playing.

Do not show "Playing" while audio is still loading.

---

# 6. Chapter navigation

Do not force the user to interact with huge repeated chapter cards.

Create a clean chapter navigator.

Each chapter should primarily communicate:

* chapter number
* title
* completion/progress
* audio availability
* current state

Secondary metadata should be visually subordinate.

Avoid showing excessive badges simultaneously.

Primary chapter action:

READ / LISTEN

Secondary actions can live inside a contextual menu.

For desktop the chapter navigator can be a collapsible side panel.

For mobile it becomes a bottom sheet/full-screen chapter drawer.

---

# 7. Conversion workflow

Conversion should be treated as a task, not as a permanent pile of controls.

Create a clear conversion panel/drawer.

Group settings into sections:

SOURCE

* chapter/text

LANGUAGE

* output language

VOICE

* voice

STYLE

* narration style

ADVANCED

* model/options

OUTPUT

* estimated duration
* generation status
* existing versions

Primary action:

Generate Audiobook

After generation:

* show progress
* show success state
* show error state
* show retry
* show play
* show download

Do not expose internal technical implementation details unless the user specifically opens Advanced settings.

---

# 8. Information hierarchy

Every screen must have:

ONE primary action.

Secondary actions should not visually compete with it.

Do not give equal visual weight to:

* play
* convert
* download
* regenerate
* translate
* configure
* delete
* share

The user must immediately understand which action is recommended.

---

# 9. Button and interaction system

Create a consistent design system.

Every interactive element needs correct states:

* default
* hover
* focus
* pressed
* active
* selected
* loading
* success
* disabled
* error

Buttons must provide immediate visual feedback.

Examples:

PLAY:
Play → Loading → Playing → Pause

CONVERT:
Convert → Preparing → Generating → Ready / Error

DOWNLOAD:
Download → Preparing → Downloading → Downloaded

Do not rely only on color changes.

Use:

* motion
* labels
* icon changes
* progress
* status text
  where appropriate.

Every click should produce a perceivable result.

---

# 10. Responsive system

Do not design desktop first and then squeeze it into mobile.

Design the information hierarchy so the same product works across:

* 1440px+
* 1280px
* 1024px
* 834px
* 768px
* 430px
* 390px
* smaller phones

Requirements:

* no horizontal page scrolling
* no clipped text
* no inaccessible controls
* no overlapping fixed elements
* no giant empty spaces
* no desktop sidebar squeezed into mobile
* no buttons extending outside containers
* no chapter content hidden behind sticky UI
* reading text must remain readable
* touch targets should be comfortably tappable
* dialogs/drawers must fit the viewport

Use responsive composition, not only smaller dimensions.

Prefer:

* CSS Grid
* Flexbox
* container queries where useful
* responsive spacing
* responsive typography
* collapsible panels
* drawers
* bottom sheets
* adaptive navigation

---

# 11. Mobile interaction model

Mobile should have a deliberate navigation model.

Recommended:

Top:
Book / chapter context

Middle:
Reading content

Bottom:
Mini audio player

Expandable actions:

* Chapters
* Listen
* Notes
* Bookmark
* Convert
* Settings

Do not reproduce the desktop interface on mobile.

---

# 12. Tablet interaction model

Tablet should be its own layout mode.

Do not simply use the desktop layout at a smaller width.

Allow:

Reading + one contextual panel

OR

Reading + collapsible chapter drawer

The right-side panel should become a drawer when insufficient space exists.

---

# 13. Library redesign

The Library should answer:

"What do I want to listen to/read next?"

Create clearer sections such as:

Continue Reading

Continue Listening

Recently Opened

Recently Converted

Books

Favorites

Completed

The book card should emphasize:

* cover
* title
* author/source
* reading progress
* listening progress
* last chapter
* primary resume action

Do not overload cards with technical metadata.

---

# 14. Book overview

When entering a book, show:

BOOK COVER
BOOK TITLE
AUTHOR / SOURCE
PROGRESS
CHAPTER COUNT
AUDIO AVAILABILITY

Primary actions:

Continue Reading

Listen

Secondary:

Open Chapters
Convert
Download
Bookmark
More

The user should not have to navigate through several technical screens before reading or listening.

---

# 15. Useful feature improvements

Improve the application with appropriate features using the existing architecture.

Consider:

* resume reading
* resume listening
* synchronized text/audio
* chapter progress
* bookmarks
* highlights
* notes
* reading themes
* font controls
* reading width controls
* playback speed
* sleep timer
* skip controls
* queue
* auto-next chapter
* favorites
* download
* offline indicator
* conversion progress
* conversion history
* multiple generated audio versions
* retry failed conversion
* chapter filtering
* search
* sorting
* status filters
* bulk conversion
* keyboard shortcuts on desktop
* accessible focus states

Only implement features that can be supported correctly by the existing application architecture.

---

# 16. Visual design direction

Keep the dark visual language but improve hierarchy.

Use:

* deep dark background
* slightly lighter surfaces
* clear card hierarchy
* restrained purple accent
* stronger text contrast
* fewer competing badges
* larger readable typography
* consistent spacing
* consistent corner radius
* consistent iconography
* minimal decorative effects

Avoid making every element a card.

Avoid excessive borders.

Avoid excessive pills/badges.

Avoid visual noise.

The design should feel like a serious combination of:

* Kindle-style reading
* Spotify-style listening
* professional content-production tooling

But do not copy any brand literally.

---

# 17. Scroll architecture

Audit EVERY scroll container.

There should be a clear relationship between:

* page scroll
* reading scroll
* chapter-panel scroll
* conversion-panel scroll
* audio-player positioning

Never create multiple nested scrollbars accidentally.

The reading view must have natural scrolling.

Chapter lists should scroll independently only when necessary.

Never hide important content behind fixed/sticky elements.

---

# 18. State consistency

This is critical.

The UI must always represent the real application state.

Examples:

If chapter has audio:
show audio available.

If generation is running:
show generating.

If generation failed:
show error and retry.

If player is paused:
show play.

If player is playing:
show pause.

If chapter is completed:
show completion.

If text sync is unavailable:
clearly communicate that.

Never display contradictory states.

---

# 19. Component architecture

Create reusable UI primitives where appropriate:

Button
IconButton
Badge
Tooltip
Dropdown
Tabs
Drawer
BottomSheet
Modal
Toast
Progress
ChapterRow
AudioPlayer
ReadingToolbar
BookHeader
ChapterNavigator
ConversionPanel
StatusIndicator

Use shared components instead of repeating slightly different versions throughout the application.

But do NOT perform uncontrolled architectural restructuring.

Preserve working application logic.

---

# 20. Implementation rule

Before modifying a screen:

1. Identify its user goal.
2. Identify the primary action.
3. Identify secondary actions.
4. Remove unnecessary visual competition.
5. Establish information hierarchy.
6. Establish responsive behavior.
7. Define interaction states.
8. Implement.
9. Test at desktop/tablet/mobile sizes.
10. Verify no functionality was lost.

---

# 21. Acceptance criteria

The redesign is NOT complete until:

* no major screen has horizontal overflow
* reading experience is dominant and comfortable
* chapter navigation is intuitive
* audio playback is always visible when relevant
* conversion workflow is understandable
* buttons are positioned according to task hierarchy
* button states accurately represent application state
* feedback exists for important actions
* no clipped content
* no inaccessible controls
* no accidental nested scrolling
* layouts work on desktop, tablet, and mobile
* the same component behaves consistently throughout the product
* technical details are hidden unless needed
* users can always tell what they should do next

Do not just make the existing screenshots prettier.

**Reconstruct the interaction model and information hierarchy while preserving the application's actual functionality.**
