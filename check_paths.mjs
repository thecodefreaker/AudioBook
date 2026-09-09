import Database from 'better-sqlite3';
const database = new Database('./data/database.sqlite');
const files = database.prepare("SELECT chapter_index, file_path FROM audio_files LIMIT 5").all();
console.log(files);
