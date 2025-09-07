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

## Deliverables

When you submit this project please include the following items:

1. Loom video link (add your video URL here):

	- Loom URL for Development Process: 
    <https://www.loom.com/share/c03b7e15e96d4e8c9af49933910a60ca?sid=153c1e88-c571-4381-85e8-e4260b9f6f3d>
    
	For more comprehensive visibility into how the AI-assisted development proceeded, see the conversation here summarized for efficient review:
	- [Summarized AI interaction transcript](docs/Summarized-RevelAI-ChatCPT-5.md)
    
	Also see the original prompt that seeded this project:

	- [Initial project prompt (AI seed)](docs/specs/2025-09-03-revelai-mini-journey-initial-prompt.md)
    

2. Source repository

	- Clear commit history that reflects the development process.

3. README checklist (this section)

	- Setup and run instructions (above).
	- Test instructions (above).
	- Implementation overview, design choices, assumptions and limitations

	Implementation notes:

	- Summary: small Fastify + TypeScript orchestration engine with MESSAGE/DELAY/CONDITION nodes. Runs and steps persisted to SQLite. Executor uses in-process timers for DELAY and a DB-backed poller for durable resume.
	- Design choices: persistent run state in SQLite, synchronous repo for simplicity, Zod for input validation, Jest tests with per-test DB files.
	- Assumptions & limitations: single-process timers are not durable; we provide a poller to resume delayed runs. For scale, BullMQ/Redis is recommended (see `docs/bullmq-migration-plan.md`).

4. Optional demo GIF or short screen recording

	- Short screen recording API demo with endpoint testing via Postman:
    <https://www.loom.com/share/1eac860e9e1347648779af5a3f524f20?sid=5cffa20f-ae19-43c9-b709-de899a2d9e51>
    
    - Short screen recording demo of a HOOS/KOOS survey journey via Postman:
    <https://www.loom.com/share/3492a592a2e84d55963fe28ab2f1b34e?sid=f62f0f07-51f8-4adf-a29b-82e6e80b07d0>
    

5. Anything else you'd like reviewers to see (e.g., CI link, coverage report):

	- Coverage report is available after running `npm run test -- --coverage`.
    Latest: 2025-09-06
    --------------|---------|----------|---------|---------|----------------------------------------------
    File          | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
    --------------|---------|----------|---------|---------|----------------------------------------------
    All files     |   92.85 |    81.29 |   90.19 |   95.49 | 
    src           |     100 |      100 |     100 |     100 | 
    app.ts        |     100 |      100 |     100 |     100 | 
    src/db        |    96.1 |    81.25 |     100 |     100 | 
    repo.ts       |    96.1 |    81.25 |     100 |     100 | 25,72,81,95-116
    src/plugins   |   89.65 |       75 |     100 |   96.15 | 
    db.ts         |   89.65 |       75 |     100 |   96.15 | 25
    src/routes    |   93.33 |    82.14 |     100 |     100 | 
    journeys.ts   |   93.33 |    82.14 |     100 |     100 | 43-44,77-94
    src/services  |   90.76 |    80.72 |   81.81 |      92 | 
    executor.ts   |   90.76 |    80.72 |   81.81 |      92 | 51,58-63,218,227-232,317-321,362-364,367-368
    src/types     |    92.3 |      100 |       0 |    92.3 | 
    journey.ts    |    92.3 |      100 |       0 |    92.3 | 93
    tests/utils   |     100 |      100 |     100 |     100 | 
    dbHelper.ts   |     100 |      100 |     100 |     100 | 
    --------------|---------|----------|---------|---------|----------------------------------------------

    Test Suites: 16 passed, 16 total
    Tests:       45 passed, 45 total
    Snapshots:   0 total
    Time:        21.673 s
    Ran all test suites.

## Demo visualization test

There's a small demo test that prints a sample journey JSON, the trigger payload (patient context), and a concise per-step execution summary so reviewers can quickly see expected behavior.

Run it locally:

PowerShell / cmd:
```bash
npm run test:single -- tests/demo.visualize.test.ts
```

Expected console output format (trimmed):

```
=== DEMO: Journey JSON ===
{ ...journey JSON... }

=== DEMO: Trigger Payload ===
{ "requestId": "demo-req-1", "patientId": "demo-p1", "context": { "score": 75 } }

=== DEMO: Execution Steps Summary ===
#1 node=start type=message_sent payload={...}
#2 node=cond type=condition_evaluated payload={...}
#3 node=high type=message_sent payload={...}

=== DEMO: Run summary ===
runId=... state=completed currentNodeId=
```

This is useful for reviewers who want to run a single script and immediately inspect node-level outputs without digging into the DB tables.

## Example runner script

There's a small example runner at `scripts/run_example.ts` that loads a journey JSON and trigger JSON from `examples/` and runs it while printing step progress.

Run it (uses `tsx` to execute the TypeScript script):

```bash
npm run demo -- --journey examples/journeys/example_journey.json --trigger examples/triggers/example_trigger_hip.json
```

This script prints periodic run state updates and then the final run steps when the run completes — useful for manual demos.

You can reduce console noise and optionally save the final run output to a file:

```bash
# quieter (only prints state changes) and write final run to out.json
npm run demo -- --journey examples/journeys/example_journey.json --trigger examples/triggers/example_trigger_hip.json --quiet=true --out demo_output.json
```

To produce a human-friendly text summary (with ANSI colors) alongside the JSON output, pass `--pretty=true` or write to a `.txt` filename. The script writes a JSON file and a pretty `.txt` file next to it.

```bash
# write JSON and a pretty text summary (demo_output.json and demo_output.json.txt)
npm run demo -- --journey examples/journeys/example_journey.json --trigger examples/triggers/example_trigger_hip.json --quiet=true --out demo_output.json --pretty=true
```



