-- journeys table stores the journey definitions
CREATE TABLE IF NOT EXISTS journeys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  payload JSON NOT NULL,
  metadata JSON,
  created_at TEXT NOT NULL DEFAULT (json_quote(strftime('%Y-%m-%dT%H:%M:%SZ', 'now')))
);

-- runs table stores execution runs for a journey
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  journey_id TEXT NOT NULL,
  patient_id TEXT,
  state TEXT NOT NULL,
  current_node_id TEXT,
  next_wake_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  FOREIGN KEY (journey_id) REFERENCES journeys(id)
);

-- run_steps stores progress events for runs
CREATE TABLE IF NOT EXISTS run_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  node_id TEXT,
  type TEXT NOT NULL,
  payload JSON,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  FOREIGN KEY (run_id) REFERENCES runs(id)
);

-- indexes for quick lookups
CREATE INDEX IF NOT EXISTS idx_runs_state_next_wake ON runs(state, next_wake_at);
CREATE INDEX IF NOT EXISTS idx_run_steps_runid ON run_steps(run_id);
