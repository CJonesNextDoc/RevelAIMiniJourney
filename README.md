# RevelAIMiniJourney

Backend-only mini engine to orchestrate a patient journey (Fastify + TypeScript + SQLite).  
Focus: backend logic, API design, tests.

## Build Plan Essentials
- Node 20+, TypeScript, Fastify, SQLite3, Zod, Jest.
- Validate payloads at the edge with Zod.
- Time in UTC; ISO strings in DB.
- Run states: queued | in_progress | waiting_delay | completed | failed | cancelled.
- Operators: ==, !=, >, >=, <, <=.
- MESSAGE nodes are stubbed via console.log.
- Executor persists progress on each node; DELAY persists next_wake_at.
- APIs: POST /journeys, POST /journeys/:journeyId/trigger, GET /journeys/runs/:runId.
- Delivery: small steps, one file drop at a time.

## Steps
0) Scaffold & boot  
1) Types & validation (Zod)  
2) DB layer (schema + repo)  
3) Routes (create/trigger/status)  
4) Executor (sequential; setTimeout for delay)  
5) Tests (unit + e2e)  
6) Seed + docs

## Getting started

Prerequisites: Node.js 20+ and npm. From the project root:

PowerShell (preferred for Windows users):
```powershell
# install dependencies
npm.cmd install

# start in dev mode (uses tsx watch)
npm.cmd run dev
```

Windows cmd.exe / macOS / Linux:
```bash
# install dependencies
npm install

# start in dev mode
npm run dev
```

Build and run the compiled app:
```bash
npm run build
npm start
```

The server listens on port 3000 by default. Example health check:
```bash
curl http://localhost:3000/health
```

## Running tests

Tests are implemented with Jest and ts-jest. They create temporary SQLite files and clean up after themselves.

Run the test suite:

PowerShell (if npm is blocked by execution policy use `npm.cmd`):
```powershell
npm.cmd test
```

cmd.exe / macOS / Linux:
```bash
npm test
```

If you prefer to run a single test file or watch tests while developing, use the scripts in `package.json`:
```bash
npm run test:watch
```

If you run into PowerShell quoting issues when using raw `curl`, prefer `Invoke-RestMethod` or `curl.exe` (not the PowerShell alias) — the tests exercise the API directly and are a stable way to validate behavior.

## Testing & debugging notes

- Verbose logs: the executor and repo components can be noisy during troubleshooting. Two environment flags control runtime verbosity:
	- `NOISY_MAX_STEPS=1` — enables verbose executor logs (useful when debugging delay/resume and max-steps behavior).
	- `NOISY_REPO=1` — enables verbose DB/repo logs (shows updateRunState, appendRunStep, claimRunForProcessing details).

	Example (PowerShell):
	```powershell
	$env:NOISY_MAX_STEPS=1; $env:NOISY_REPO=1; npx.cmd jest -i --colors
	```

- Centralized test cleanup: tests use a shared setup file `tests/setupTests.ts` which automatically runs after each test and:
	- restores real timers (calls `jest.useRealTimers()`)
	- clears pending timers (`jest.clearAllTimers()`)
	- clears any scheduled executor timeouts (`executor.clearScheduledTimeouts()`)

	This helps avoid Jest open-handle warnings and reduces flakiness caused by leaked timeouts. If you add new tests that spawn timers, ensure they either use `jest.useFakeTimers()` with explicit advances, or let the shared cleanup clear timers after each test.

	### Useful npm test scripts

	- Run the full test suite (CI-friendly):
		```bash
		npm run test:ci
		```

	- Run a single test file (fast):
		```bash
		npm run test:single -- tests/integration.hip.test.ts
		```

	- Run a single test by name (regex match):
		```bash
		npm run test:single -- -t "POST /journeys/:journeyId/trigger with invalid body returns 400"
		```


