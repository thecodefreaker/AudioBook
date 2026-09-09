import * as db from './server/models/database.js';

db.initDatabase();

// In the database model, we only have getActiveJobs, which might not return 'interrupted' jobs if they are not considered 'active'.
// Let's use the native sqlite3 command line tool to update the database since we can't easily execute raw queries through the API.
// Wait, sqlite3 wasn't installed, let's use a standard node sqlite3 or better-sqlite3 script directly.
import Database from 'better-sqlite3';
const database = new Database('./data/database.sqlite');
const info = database.prepare("UPDATE generation_jobs SET status = 'failed', error_log = 'Superseded by backend cleanup.' WHERE status = 'interrupted'").run();

console.log(`Updated ${info.changes} interrupted jobs to 'failed' to prevent infinite resume prompts.`);
