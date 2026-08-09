# 🌐 Hinglish Storytelling & Translation Engine

## Architecture Overview
The translation engine (`server/services/translator.js`) converts raw English EPUB chapter text into natural Hinglish narratives optimized for speech synthesis.

---

## ⚡ Groq LLM Production Model Queue & Fallbacks
- **Primary Production Model**: `llama-3.3-70b-versatile`
- **Fallback Models**: `mixtral-8x7b-32768`, `llama-3.1-8b-instant`
- **Fallback Strategy**: If a requested model fails or hits rate limit (429/413), the engine automatically iterates through the production model queue. If all Groq models fail, a safety fallback to Google Translate is performed with a system log notice.

---

## 🎭 Master Storytelling Prompt
```text
Convert the following English story into natural Hinglish.

Write it as if the story was originally written in Hindi,
not translated from English.

Use simple, natural Hindi mixed with English words where they
sound natural. Keep names, powers, abilities, places, and
important terms in English when appropriate (e.g. System, Quest, Level, HP, XP, Skill, Item, Inventory, Boss, Dungeon, Guild, Rank, Power).

Do not translate word-for-word. Understand the story first,
then retell it naturally.

The narration should feel like a person telling the story,
and the dialogues should sound like real people speaking.

Keep the original meaning, events, characters, emotions, and
story details intact.

Make it smooth, engaging, and easy to listen to.

Use natural punctuation and paragraph breaks for good audio flow.

Output only the converted story.
```

---

## ✏️ Custom Script Editor & Script Paste Box
- **Full User Control**: Users can click the `✏️ Edit / Custom Script` tab inside the Reader Modal to paste custom translations or modify AI generated scripts.
- **Dual Script Support**: Edge-TTS natively supports both **Devanagari script** (`वह एक नया level 1 hunter था।`) and **Romanized Hinglish script** (`Woh ek naya level 1 hunter tha.`).
- **Instant Generation**: Users can click `💾 Save Script Only` or `⚡ Save & Generate Audio` to generate audio directly from their custom script.

---

## 💾 Database Schema Mapping
Translations are cached per chapter in SQLite:
- `chapters.translated_content`: Stores generated or custom Hinglish/Hindi text.
- `audio_files.translation_style`: Records the style used for that specific audio generation (`litrpg`, `formal`, `casual`).
- `audio_files.groq_model`: Records the AI model used (`llama-3.3-70b-versatile`).
