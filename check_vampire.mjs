import Database from 'better-sqlite3';
const database = new Database('./data/database.sqlite');
const books = database.prepare("SELECT id, title FROM books").all();
console.log(books);
