import { getDb, closeDb } from '../src/plugins/db';
import { initDb } from '../src/plugins/db';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('plugins/db', () => {
  afterEach(() => {
    try { closeDb(); } catch (e) { /* ignore */ }
  });

  test('getDb throws when DB not initialized', () => {
  // Ensure db is cleared
  try { closeDb(); } catch (e) { /* ignore */ }

    expect(() => getDb()).toThrow('Database not initialized');
  });

  test('initDb logs when schema exec fails', () => {
    const schemaPath = path.resolve(process.cwd(), 'src', 'db', 'schema.sql');
    const tmpDbFile = path.join(os.tmpdir(), `test-schema-fail-${Date.now()}.sqlite`);

    // Backup existing schema if any
    let hadSchema = false;
    let origSchema = '';
    try {
      if (fs.existsSync(schemaPath)) {
        hadSchema = true;
        origSchema = fs.readFileSync(schemaPath, 'utf-8');
      }
      // Ensure schema path exists so initDb attempts to read it
      fs.mkdirSync(path.dirname(schemaPath), { recursive: true });
      fs.writeFileSync(schemaPath, '-- placeholder');

  // Ensure db cleared
  try { closeDb(); } catch (e) { /* ignore */ }

      // Force readFileSync to throw so initDb's try/catch handles the error and logs
      const readSpy = jest.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('boom'); });
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const db = initDb(tmpDbFile);
      expect(db).toBeTruthy();
      expect(spy).toHaveBeenCalled();

  spy.mockRestore();
  readSpy.mockRestore();
    } finally {
      try { closeDb(); } catch (e) { /* ignore */ }
      try { if (fs.existsSync(tmpDbFile)) fs.unlinkSync(tmpDbFile); } catch (e) { /* ignore */ }
      // restore original schema
      try {
        if (hadSchema) fs.writeFileSync(schemaPath, origSchema);
        else if (fs.existsSync(schemaPath)) fs.unlinkSync(schemaPath);
      } catch (e) { /* ignore */ }
    }
  });

  test('initDb creates missing directory for DB file', () => {
    const tmpRoot = path.join(os.tmpdir(), `test-db-dir-${Date.now()}`);
    const nested = path.join(tmpRoot, 'a', 'b', 'c');
    const dbFile = path.join(nested, 'nested.sqlite');

  // Ensure the root does not exist
  try { if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) { /* ignore */ }

    try {
      try { closeDb(); } catch (e) { /* ignore */ }
      const db = initDb(dbFile);
      expect(db).toBeTruthy();
      expect(fs.existsSync(nested)).toBeTruthy();
    } finally {
      try { closeDb(); } catch (e) { /* ignore */ }
      try { if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    }
  });
});
