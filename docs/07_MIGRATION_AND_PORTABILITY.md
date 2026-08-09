# 🚀 Migration & Portability Guide (`unpack_project.js`)

## Overview
To allow easy transfer of the entire project to another system (even when copy-pasting raw text is the only option), the project includes an automated single-file archive packer (`generate_packer.js`).

---

## 📦 How `unpack_project.js` Works
- Running `node generate_packer.js` packages all code files, CSS, HTML, backend routes, translation prompts, and the **entire `docs/` folder** into a single JavaScript file (`unpack_project.js`) encoded in Base64.
- Heavy/ignored folders (`node_modules`, `data`, `.git`) are automatically excluded to keep the packed file lean.

---

## 📋 Steps to Transfer Project to Another Machine

1. **Copy Text**: Open `unpack_project.js` on this computer, copy all text content.
2. **Paste on Target System**: Create a file named `unpack_project.js` on your target computer and paste the text into it.
3. **Extract Project**: Open a terminal in that folder and run:
   ```bash
   node unpack_project.js
   ```
4. **Install Dependencies & Start App**:
   ```bash
   npm install
   npm run dev
   ```
5. All folders, files, code, and the complete `docs/` documentation suite will be extracted in place!
