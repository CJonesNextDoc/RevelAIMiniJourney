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
