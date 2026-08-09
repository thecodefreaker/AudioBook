# 📖 Custom Reader Toolbar & Themes Documentation

## Overview
The Chapter Reader Modal (`#chapter-modal`) provides a complete, Kindle/Apple Books-style reader experience with dual-view original vs translated text, real-time karaoke paragraph highlighting, and custom typography controls.

---

## 🎨 Reader Features & Customization

### 1. Dual-View Tabs
- **📄 Original (English)**: View original EPUB text.
- **🌐 Translated (Hinglish/Hindi)**: View generated Hinglish storytelling text.

### 2. Font Size Controls (`A-` / `A+`)
- Dynamic scaling from **12px to 28px**.
- Live indicator display (`16px`, `18px`, etc.).

### 3. Reading Themes
- **🌙 Dark Glass (Default)**: Modern translucent dark theme.
- **📜 Sepia**: Soft parchment paper tone for minimal eye strain.
- **☀️ Light**: Clean white theme for bright daylight reading.
- **🌌 OLED**: True pitch-black theme for AMOLED/OLED displays.

### 4. Typography & Line Spacing
- **Font Families**: Sans-Serif (Modern), Serif (Book / Novel), Monospace (Tech).
- **Line Heights**: Compact (1.4), Normal (1.7), Spacious (2.0).

### 5. Fullscreen Mode & Reading Meta
- **⛶ Fullscreen Toggle**: Expands reader modal to full viewport width/height.
- **Estimated Reading Time**: Displays word count, character count, and calculated reading duration (`~3 min read`).

### 6. Interactive Karaoke Sync & Click-to-Seek
- **Active Paragraph Glow**: Smooth highlight on paragraph currently being spoken by the voice actor.
- **Click-to-Seek**: Clicking any paragraph in either Original or Translated view immediately jumps audio playback to that section.
- **Persistence**: Reader preferences are stored in `localStorage` (`reader_font_size`, `reader_theme`, `reader_font_family`, `reader_line_height`).

---

## ✍️ Custom Script Editor & Direct TTS Generation

### 1. Direct Custom Script Execution
- Users can click **"✍️ Edit Custom Script"** in the reader modal to edit or paste custom text.
- Clicking **"Save & Generate Audio"** or selecting `✍️ Saved Custom Script` in the config panel **bypasses AI translation completely**.
- The exact user-pasted text is fed directly into Microsoft Edge-TTS without any LLM modification.
- Generated versions receive the `✍️ Custom Script` badge in chapter cards and version history modals.

### 2. Script & Language Freedom (Devanagari vs Hinglish)
- **Are users free to use any script?** **YES, 100%!** Users can use:
  - **Devanagari Hindi Script** (e.g. `वह एक नया level 1 hunter था`)
  - **Romanized Hinglish Script** (e.g. `Woh ek naya level 1 hunter tha`)
  - **Mixed Scripts** (Devanagari + English technical terms)
- **Voice Compatibility**:
  - `hi-IN-SwaraNeural` / `hi-IN-MadhurNeural`: Native Hindi voices that read both Devanagari AND English/Hinglish loanwords naturally.
  - `en-IN-NeerjaExpressiveNeural` / `en-IN-PrabhatNeural`: Indian English storytelling voices optimal for Roman Hinglish text.
