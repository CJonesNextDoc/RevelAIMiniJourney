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
