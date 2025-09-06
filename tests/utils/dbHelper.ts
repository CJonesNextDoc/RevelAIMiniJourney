import fs from 'fs';
import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as repo from '../../src/db/repo';
import { closeDb } from '../../src/plugins/db';

export function createTempDbAndInit(prefix = 'revelai-test') {
  const dbFile = path.join(os.tmpdir(), `${prefix}-${uuidv4()}.sqlite`);
  // initialize repository (applies schema)
  repo.initRepository(dbFile);

  return {
    dbFile,
    async cleanup() {
      try {
        // close DB handle first
        try { closeDb && closeDb(); } catch (e) { /* ignore */ }
      } finally {
        try {
          if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
        } catch (e) {
          // ignore cleanup errors - best-effort
        }
      }
    },
  };
}

export default { createTempDbAndInit };
