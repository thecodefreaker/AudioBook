const path = require('path');
const config = { audioDir: '/home/kaliuser/project/IvoryGrimyMozbot-1/data/audio' };
const p = 'b7f55b5e-cb76-4791-ae5b-cb4f920d713f/chapters/ch0692_mskrxb51_fld5.mp3';
console.log(path.resolve(config.audioDir, p));

const db = require('better-sqlite3')('./data/database.sqlite');
console.log(db.prepare("SELECT file_path FROM audio_files LIMIT 1").get());
