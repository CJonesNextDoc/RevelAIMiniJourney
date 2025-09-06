/**
 * src/db/repo.ts (persistence)
 * - Purpose: Wraps better-sqlite3 to store journeys, runs, and run steps.
 * - Claiming: claimRunForProcessing updates state atomically when ready.
 * - Timestamps: use UTC ISO via strftime; keep next_wake_at for delays.
 * - Idempotency: (journey_id, idempotency_key) unique ensures repeat triggers reuse run.
 * - Logging: appendRunStep records a durable audit trail.
 */

import { v4 as uuidv4 } from 'uuid';
import { initDb, getDb } from '../plugins/db';
import { inspect } from 'node:util';

// Create the database at start-up. Creates missing tables.
export function initRepository(dbFile?: string) {
  initDb(dbFile);
}

function db() {
  return getDb();
}

// Enable noisy DB/repo logging when NOISY_REPO is set. Default is off to keep tests quiet.
const REPO_VERBOSE = !!process.env.NOISY_REPO;
function repoLog(...args: any[]) { if (REPO_VERBOSE) console.log(...args); }

// Journeys
// Create and persist a journey; payload and metadata stored as JSON
export function createJourney(id: string | undefined, name: string, payload: unknown, metadata?: unknown) {
  const _id = id ?? uuidv4(); // assign new UUID if id is not provided
  const stmt = db().prepare(`INSERT INTO journeys (id, name, payload, metadata) VALUES (?, ?, ?, ?)`);
  stmt.run(_id, name, JSON.stringify(payload), metadata ? JSON.stringify(metadata) : null);
  // return the created journey ID
  return _id;
}

export function getJourney(id: string) {
  // fetch row from journeys table for a matching id
  const row: any = db().prepare(`SELECT id, name, payload, metadata, created_at FROM journeys WHERE id = ?`).get(id);
  if (!row) return null; // not found
  // Found, return row
  return {
    id: row.id,
    name: row.name,
    payload: JSON.parse(row.payload),
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    created_at: row.created_at,
  };
}

// Runs
// Create run with optional idempotency (reuse existing if key matches)
export function createRun(journeyId: string, patientId?: string, idempotencyKey?: string) {
  if (idempotencyKey) {
    // avoid duplicates
    const existing: any = db().prepare(`SELECT id FROM runs WHERE journey_id = ? AND idempotency_key = ? LIMIT 1`).get(journeyId, idempotencyKey);
    if (existing && existing.id) return existing.id; // insert not necessary, return existing run id
  }
  // Not duplicate, insert and return new run id
  const id = uuidv4();
  const stmt = db().prepare(`INSERT INTO runs (id, journey_id, patient_id, idempotency_key, state, created_at) VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`);
  stmt.run(id, journeyId, patientId ?? null, idempotencyKey ?? null, 'queued');
  return id;
}

export function getRun(id: string) {
  const row: any = db().prepare(`SELECT * FROM runs WHERE id = ?`).get(id); //fetch row from runs table for a matching run id
  if (!row) return null; // run record not found
  return row; // Found, return row
}

export function updateRunState(id: string, state: string, fields: Record<string, unknown> = {}) {
  // use inspect utility to make sure stringify does not break
  repoLog('[repo] updateRunState', { id, state, fields: inspect(fields, { depth: 3, breakLength: 100 }) });

  const parts = ['state = ?'];
  const values: any[] = [state];
  // prepare parts of update statement
  if (fields.current_node_id !== undefined) { parts.push('current_node_id = ?'); values.push(fields.current_node_id); }
  if (fields.next_wake_at !== undefined) { parts.push('next_wake_at = ?'); values.push(fields.next_wake_at); }
  if (fields.started_at !== undefined) { parts.push('started_at = ?'); values.push(fields.started_at); }
  if (fields.completed_at !== undefined) { parts.push('completed_at = ?'); values.push(fields.completed_at); }
  if (fields.error !== undefined) { parts.push('error = ?'); values.push(fields.error); }

  // finalize SQL UPDATE statement
  const sql = `UPDATE runs SET ${parts.join(', ')} WHERE id = ?`;
  values.push(id);
  db().prepare(sql).run(...values);
}

// Atomically claim a run for processing: set state -> in_progress and started_at if the run
// is currently queued or waiting_delay and its next_wake_at is null or <= now.
// Atomic claim: moves run to in_progress if (queued|waiting_delay) and ready by time
export function claimRunForProcessing(id: string, nowIso?: string) {
  const now = nowIso ?? new Date().toISOString();
  // Use a JS-supplied timestamp for the comparison so tests that mock Date.now() work correctly.
  const stmt = db().prepare(`UPDATE runs SET state = 'in_progress', started_at = ? WHERE id = ? AND state IN ('queued','waiting_delay') AND (next_wake_at IS NULL OR next_wake_at <= ?)`);
  const info = stmt.run(now, id, now);
  const ok = info.changes === 1;
  repoLog(`[repo] claimRunForProcessing id=${id} now=${now} changes=${info.changes} claimed=${ok}`);
  return ok;
}

export function appendRunStep(runId: string, nodeId: string | null, type: string, payload: unknown) {
  // use inspect utility to make sure stringify does not break
  repoLog('[repo] appendRunStep', { runId, nodeId, type, payload: inspect(payload, { depth: 3, breakLength: 100 }) });
  // insert a new step record for the run
  const stmt = db().prepare(`INSERT INTO run_steps (run_id, node_id, type, payload, created_at) VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`);
  const info = stmt.run(runId, nodeId, type, payload ? JSON.stringify(payload) : null);
  return info.lastInsertRowid as number;
}

export function getRunSteps(runId: string) {
  // fetch all step records for a run, ordered by creation time - monitoring/tracing
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
