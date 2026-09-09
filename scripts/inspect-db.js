import Database from 'better-sqlite3';

const db = new Database('data/database.sqlite', { readonly: true });

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all()
  .map((r) => r.name);

console.log('Tables:\n  ' + tables.join('\n  '));

for (const t of tables) {
  if (/script/i.test(t)) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    const n = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    console.log(`\n${t} (${n} rows):\n  ${cols.join(', ')}`);
  }
}
