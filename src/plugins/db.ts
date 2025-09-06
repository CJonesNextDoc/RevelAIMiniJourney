import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let db: Database.Database | null = null;

export function initDb(dbFile = 'journeys.sqlite') {
  if (db) return db;

  const fullPath = path.resolve(process.cwd(), dbFile);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(fullPath);

  // Run schema if available
  try {
    const schemaPath = path.resolve(process.cwd(), 'src', 'db', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const sql = fs.readFileSync(schemaPath, 'utf-8');
      db.exec(sql);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to initialize DB schema:', err);
  }

  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

export default initDb;

// Close the database connection if it's open. Tests can call this in global teardown.
export function closeDb() {
  try {
    if (db && typeof (db as any).close === 'function') {
      (db as any).close();
    }
  } finally {
    db = null;
  }
}
