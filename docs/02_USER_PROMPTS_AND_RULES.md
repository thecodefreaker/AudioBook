# 📜 User Prompts, Instructions & Storytelling Rules

This document records all exact prompts, guidelines, and rules specified for the Hinglish Audiobook AI Workspace.

---

## 🎯 Primary Hinglish System Prompt & Guidelines

### User Master Prompt:
> "Convert the following English story into natural Hinglish.
> Write it as if the story was originally written in Hindi, not translated from English.
> Use simple, natural Hindi mixed with English words where they sound natural. Keep names, powers, abilities, places, and important terms in English when appropriate.
> Do not translate word-for-word. Understand the story first, then retell it naturally.
> The narration should feel like a person telling the story, and the dialogues should sound like real people speaking.
> Keep the original meaning, events, characters, emotions, and story details intact.
> Make it smooth, engaging, and easy to listen to.
> Use natural punctuation and paragraph breaks for good audio flow.
> Output only the converted story."

---

## ✏️ Custom Script Paste & Editing Feature
- **User Request**: Allow users to view and paste converted Hindi/Hinglish text before converting into audio.
- **Implementation**: Added the `✏️ Edit / Custom Script` tab inside the Reader Modal (`#chapter-modal`).
- **Support**: Edge-TTS natively supports both **Devanagari script** (Hindi) and **Roman script** (Hinglish). Users can paste or edit text in either script and click `⚡ Save & Generate Audio` to synthesize immediately.

---

## 🎭 Groq Translation Prompt Architecture (`server/services/translator.js`)

```javascript
const stylePrompt = `Convert the following English story into natural Hinglish.

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

Output only the converted story.`;
```
