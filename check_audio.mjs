import * as db from './server/models/database.js';
import fs from 'fs';

db.initDatabase();
const bookId = db.getAllBooks()[0].id;
const files = db.getAudioFilesByBookId(bookId).slice(0, 5);

console.log(`Found ${files.length} audio records in the database for book ${bookId}.`);
let missing = 0;

files.forEach(f => {
  const exists = fs.existsSync(f.file_path);
  if (!exists) missing++;
  console.log(`Chapter ${f.chapter_index} - Path: ${f.file_path} - Exists on disk: ${exists}`);
});

console.log(`\nSummary: ${missing} out of ${files.length} files are missing from the disk.`);
