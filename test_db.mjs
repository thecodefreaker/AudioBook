import fs from 'fs';
const dbFile = fs.readFileSync('./server/models/database.js', 'utf8');
const lines = dbFile.split('\n');
const start = lines.findIndex(l => l.includes('export function getAudioFilesByBookId'));
console.log(lines.slice(start, start + 15).join('\n'));
