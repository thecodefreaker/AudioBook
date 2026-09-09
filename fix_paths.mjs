import Database from 'better-sqlite3';
const database = new Database('./data/database.sqlite');
const info = database.prepare("UPDATE audio_files SET file_path = REPLACE(file_path, '/home/kaliuser/project/a/audio/', '/home/kaliuser/project/IvoryGrimyMozbot-1/')").run();
console.log(`Updated ${info.changes} file paths in the database!`);
