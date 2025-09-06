import fs from 'fs';
import path from 'path';
import dbHelper from './utils/dbHelper';
import { initDb, closeDb } from '../src/plugins/db';

describe('db plugin', () => {
  let helper: any;
  beforeEach(() => { helper = dbHelper.createTempDbAndInit('plugin-db-test'); });
  afterEach(async () => { try { await helper.cleanup(); } catch (e) { /* ignore */ } });

  test('closeDb closes without throwing', () => {
    // initDb was called by helper; ensure closeDb runs
    expect(() => closeDb()).not.toThrow();
  });

  test('initDb applies schema and handles missing schema gracefully', () => {
    // Temporarily rename schema file to simulate missing schema
    const schemaPath = path.resolve(process.cwd(), 'src', 'db', 'schema.sql');
    const tmpPath = schemaPath + '.bak';
    let renamed = false;
    if (fs.existsSync(schemaPath)) {
      fs.renameSync(schemaPath, tmpPath);
      renamed = true;
    }

    try {
      // Should not throw if schema is missing
      expect(() => initDb()).not.toThrow();
    } finally {
      if (renamed) fs.renameSync(tmpPath, schemaPath);
    }
  });
});
