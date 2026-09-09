import * as db from './server/models/database.js';
import fs from 'fs';

db.initDatabase();
const books = db.getAllBooks();
let missing = 0;
let total = 0;
books.forEach(b => {
  const files = db.getAudioFilesByBookId(b.id);
  files.forEach(f => {
    total++;
    const exists = fs.existsSync(f.file_path);
    if (!exists) {
      missing++;
      if (missing < 10) console.log(`Missing: Book ${b.title}, Chapter ${f.chapter_index}`);
    }
  });
});
console.log(`\nSummary: ${missing} out of ${total} files are missing from the disk across all books.`);
