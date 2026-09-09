# 📚 Audiobook AI Workspace - Complete Project Documentation

## 🌟 Overview
**Audiobook AI Workspace** is a high-performance web application designed to convert EPUB e-books into professional, multi-voice audiobooks with specialized support for **Conversational Hinglish Storytelling**.

It combines:
- **Groq AI (Llama 3.3 70B)** for intelligent, context-aware story translation into colloquial Hinglish (YouTube explainer style).
- **Microsoft Edge TTS** for natural human-like voice synthesis (e.g. `hi-IN-SwaraNeural`, `hi-IN-MadhurNeural`, `en-US-AndrewNeural`).
- **Synchronized Dual-View Reader Modal** with karaoke paragraph tracking, click-to-seek playback, custom font controls, and reading themes (Dark, Sepia, Light, OLED).
- **Multi-Version Coexisting Audio Engine** with version dropdown switcher and management.

---

## 🛠️ Technology Stack
- **Frontend**: Vite, Vanilla JavaScript (ES Modules), Vanilla CSS (Custom Glassmorphism Design System)
- **Backend**: Node.js, Express.js, Socket.IO
- **Database**: SQLite (`better-sqlite3`)
- **AI Engines**:
  - **Groq API**: `llama-3.3-70b-versatile` / `llama-3.1-8b-instant`
  - **TTS Provider**: Edge-TTS engine with FFmpeg audio joining and duration calculation
- **Portability**: Self-contained archive packer (`generate_packer.js` -> `unpack_project.js`)

---

## 📁 Repository Structure
```
Audiobook/
├── docs/                             # Structured Project Documentation & Prompts
│   ├── 01_PROJECT_OVERVIEW.md
│   ├── 02_USER_PROMPTS_AND_RULES.md
│   ├── 03_HINGLISH_STORYTELLING_ENGINE.md
│   ├── 04_CUSTOM_READER_TOOLBAR_AND_THEMES.md
│   ├── 05_COEXISTING_AUDIO_VERSIONS.md
│   └── 06_MIGRATION_AND_PORTABILITY.md
├── server/                           # Backend Node.js Server
│   ├── config/                       # App Configuration & Constants
│   ├── models/                       # SQLite Schema & Database Operations
│   ├── routes/                       # Express REST API Endpoints
│   ├── services/                     # Job Queue, Translator & TTS Engine
│   └── index.js                      # Server Entry Point
├── src/                              # Frontend Client
│   ├── styles/                       # CSS Design Tokens & Components
│   ├── services/                     # API Client & Socket.IO Listeners
│   ├── utils/                        # Formatting & DOM Helpers
│   ├── main.js                       # Client Application Controller
│   └── index.html                    # Main UI Template
├── generate_packer.js                # Self-Contained Project Archiver
└── unpack_project.js                 # Output Single-File Portable Executable
```

---

## ⚡ REST API Endpoints
- `POST /api/books/upload` - Upload EPUB file
- `GET /api/books` - List all uploaded books
- `GET /api/books/:id/chapters` - Fetch book chapter list
- `GET /api/books/:id/chapters/:index/content` - Fetch English & Hinglish text for reader
- `POST /api/books/:id/generate` - Trigger audio conversion job
- `GET /api/books/:id/audio` - List all generated audio files
- `DELETE /api/books/audio/:id` - Delete a specific audio version
- `POST /api/books/:id/cancel` - Cancel active generation job
