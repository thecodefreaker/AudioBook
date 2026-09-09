import Database from 'better-sqlite3';
const database = new Database('./data/database.sqlite');
const info = database.prepare("UPDATE audio_files SET file_path = SUBSTR(file_path, INSTR(file_path, '/data/audio/') + 12)").run();
console.log(`Updated ${info.changes} file paths to be relative!`);
