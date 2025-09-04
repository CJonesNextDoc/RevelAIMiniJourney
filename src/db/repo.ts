import { v4 as uuidv4 } from 'uuid';
import { initDb, getDb } from '../plugins/db';

export function initRepository(dbFile?: string) {
  initDb(dbFile);
}

function db() {
  return getDb();
}

// Journeys
export function createJourney(id: string | undefined, name: string, payload: unknown, metadata?: unknown) {
  const _id = id ?? uuidv4();
  const stmt = db().prepare(`INSERT INTO journeys (id, name, payload, metadata) VALUES (?, ?, ?, ?)`);
  stmt.run(_id, name, JSON.stringify(payload), metadata ? JSON.stringify(metadata) : null);
  return _id;
}

export function getJourney(id: string) {
  const row: any = db().prepare(`SELECT id, name, payload, metadata, created_at FROM journeys WHERE id = ?`).get(id);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    payload: JSON.parse(row.payload),
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    created_at: row.created_at,
  };
}

// Runs
export function createRun(journeyId: string, patientId?: string, idempotencyKey?: string) {
  if (idempotencyKey) {
    const existing: any = db().prepare(`SELECT id FROM runs WHERE journey_id = ? AND idempotency_key = ? LIMIT 1`).get(journeyId, idempotencyKey);
    if (existing && existing.id) return existing.id;
  }

  const id = uuidv4();
  const stmt = db().prepare(`INSERT INTO runs (id, journey_id, patient_id, idempotency_key, state, created_at) VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`);
  stmt.run(id, journeyId, patientId ?? null, idempotencyKey ?? null, 'queued');
  return id;
}

export function getRun(id: string) {
  const row: any = db().prepare(`SELECT * FROM runs WHERE id = ?`).get(id);
  if (!row) return null;
  return row;
}

export function updateRunState(id: string, state: string, fields: Record<string, unknown> = {}) {
  try {
    console.log(`[repo] updateRunState id=${id} -> state=${state} fields=${JSON.stringify(fields)}`);
  } catch (e) {
    // ignore JSON stringify errors
  }
  const parts = ['state = ?'];
  const values: any[] = [state];
  if (fields.current_node_id !== undefined) { parts.push('current_node_id = ?'); values.push(fields.current_node_id); }
  if (fields.next_wake_at !== undefined) { parts.push('next_wake_at = ?'); values.push(fields.next_wake_at); }
  if (fields.started_at !== undefined) { parts.push('started_at = ?'); values.push(fields.started_at); }
  if (fields.completed_at !== undefined) { parts.push('completed_at = ?'); values.push(fields.completed_at); }
  if (fields.error !== undefined) { parts.push('error = ?'); values.push(fields.error); }

  const sql = `UPDATE runs SET ${parts.join(', ')} WHERE id = ?`;
  values.push(id);
  db().prepare(sql).run(...values);
}

// Atomically claim a run for processing: set state -> in_progress and started_at if the run
// is currently queued or waiting_delay and its next_wake_at is null or <= now.
export function claimRunForProcessing(id: string, nowIso?: string) {
  const now = nowIso ?? new Date().toISOString();
  // Use a JS-supplied timestamp for the comparison so tests that mock Date.now() work correctly.
  const stmt = db().prepare(`UPDATE runs SET state = 'in_progress', started_at = ? WHERE id = ? AND state IN ('queued','waiting_delay') AND (next_wake_at IS NULL OR next_wake_at <= ?)`);
  const info = stmt.run(now, id, now);
  const ok = info.changes === 1;
  console.log(`[repo] claimRunForProcessing id=${id} now=${now} changes=${info.changes} claimed=${ok}`);
  return ok;
}

export function appendRunStep(runId: string, nodeId: string | null, type: string, payload: unknown) {
  try {
    console.log(`[repo] appendRunStep runId=${runId} nodeId=${nodeId} type=${type}`);
  } catch (e) {}
  const stmt = db().prepare(`INSERT INTO run_steps (run_id, node_id, type, payload, created_at) VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`);
  const info = stmt.run(runId, nodeId, type, payload ? JSON.stringify(payload) : null);
  return info.lastInsertRowid as number;
}

export function getRunSteps(runId: string) {
  const rows = db().prepare(`SELECT id, node_id, type, payload, created_at FROM run_steps WHERE run_id = ? ORDER BY id ASC`).all(runId);
  return rows.map((r: any) => ({ ...r, payload: r.payload ? JSON.parse(r.payload) : null }));
}

// Polling: find runs that are queued or waiting_delay and ready to run (next_wake_at <= now OR next_wake_at IS NULL)
export function findReadyRuns(limit = 100) {
  const rows = db().prepare(`SELECT * FROM runs WHERE state IN ('queued','waiting_delay') AND (next_wake_at IS NULL OR next_wake_at <= strftime('%Y-%m-%dT%H:%M:%SZ','now')) ORDER BY created_at ASC LIMIT ?`).all(limit);
  return rows;
}

export default {
  initRepository,
  createJourney,
  getJourney,
  createRun,
  getRun,
  updateRunState,
  appendRunStep,
  getRunSteps,
  findReadyRuns,
  claimRunForProcessing,
};
