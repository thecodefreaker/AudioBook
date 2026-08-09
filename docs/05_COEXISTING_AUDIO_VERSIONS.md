# 📁 Coexisting Audio Versions & Version Switcher

## Overview
The **Coexisting Audio Versions** system allows multiple generated audio files for the same chapter to coexist simultaneously in the database and filesystem without overwriting each other.

---

## 🛠️ Key Components

### 1. Unique File Naming & Persistence
- In `server/services/jobProcessor.js`, each generated audio file receives a unique timestamp-based suffix:
  `chapter_001_k8f9a2.mp3`
- Database records (`audio_files` table in SQLite) persist every version with precise creation timestamps (`created_at`).

### 2. Grouped Version Selector & Timestamp Formatting
- When multiple audio versions exist for a single chapter, the dropdown switcher displays clear creation date & time labels:
  - `V3 (Aug 8, 1:35 PM): Hinglish (Swara · YouTube Story)`
  - `V2 (Aug 8, 1:05 PM): Hinglish (Swara · Casual)`
  - `V1 (Aug 8, 11:30 AM): English (Aria)`
- **Default Sorting**: Recent conversions appear first by default (`ORDER BY created_at DESC`).

### 3. Quick Convert Modal (`🔄 Re-convert`)
- Clicking `🔄 Re-convert` or `Convert` on an individual chapter opens the **Quick Convert Modal**.
- This completely replaces the confusing behavior of blindly using global sidebar settings.
- Users explicitly select Language, Voice, and Translation Style **just for that chapter**.
- **Custom Script Protection**: The `✍️ Saved Custom Script` option is ONLY enabled if the database verifies that a custom script actually exists for that chapter (labeled `Ready`). Otherwise, it is disabled (labeled `None saved`).

### 4. Audio Versions History Modal
- Clicking the `📁 N Versions` badge opens the **Audio Versions History Modal** (`#versions-modal`).
- Features a detailed table displaying:
  - Version # & Creation Date/Time (`Aug 8, 1:35 PM`)
  - Language, Voice Name, Translation Style & AI Model (`llama-3.3-70b-versatile`)
  - Duration & File Size
  - **Sort Controls**: Toggle between **"📅 Newest First (Recent Converted)"** and **"📅 Oldest First"**.
  - **Action Buttons**: `▶ Play`, `📥 MP3 Download`, and `🗑️ Delete Version`.

### 4. Version Playback & Management
- **▶ Play Button**: Plays whichever version is currently selected in the dropdown or modal.
- **`+ New Version` / `🔄 Re-convert`**: Allows creating additional audio variations.
- **🗑️ Delete Version**: Deletes the selected version record from SQLite and removes the `.mp3` file from disk (`DELETE /api/books/audio/:id`).
