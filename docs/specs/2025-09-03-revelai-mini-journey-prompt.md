---
title: RevelAIMiniJourney — Project Prompt (AI Origin)
source: ChatGPT session
date: 2025-09-03
commit: <fill in the git SHA when you commit>
---

## Purpose
Record of the original prompt that seeded this project. Kept (lightly formatted) for provenance.

---

# Project Name
**RevelAIMiniJourney**

## Project Description
Build a simplified backend engine for orchestrating a patient journey. No frontend UI is required. Focus on:
- (a) **Backend Logic**
- (b) **API design**
- (c) **Testing**

## Requirements
- Engine will accept a journey definition (a series of steps with potential conditions) and execute it for a given patient.
- **Language:** TypeScript with Node.js
- **Framework:** Fastify
- **Database:** SQLite3 (simple to set up and run on most machines).
- **Async processing:** For handling delays, use a simple `setTimeout()` for the initial project.

### Other Specifications
- **Validation & enums:** lock operators to `['==','!=','>','>=','<','<=']`; restrict `type` fields to literal unions; validate with Zod on input.
- **Run lifecycle:** define states: `queued | in_progress | waiting_delay | completed | failed | cancelled`. Persist timestamps (`created_at`, `updated_at`, `next_wake_at`) so `DELAY` is deterministic (even if the process restarts later).
- **Idempotency:** `POST /journeys/:id/trigger` should accept optional `requestId`; if repeated, return the same `runId`.
- **Determinism & time:** use UTC everywhere; store ISO strings.
- **Node uniqueness:** enforce unique `id` per journey; verify all `next_node_id` links refer to real nodes; detect cycles (optional, but nice).
- **Error & cancel:** add `POST /journeys/runs/:runId/cancel` (optional now, easy later).
- **Execution model:** initial version uses `setTimeout`; still persist `next_wake_at` so a later “wake-up” strategy is trivial to add.

---

## Features

### Summary
Model and execute a journey — a directed graph of nodes.

### [1] Define the Journey Structure
A series of nodes execute in order, potentially branching based on conditions.

**Node Types**
- `MESSAGE`: An action to send a message to a patient.
- `DELAY`: A waiting period before the next node is processed.
- `CONDITIONAL`: A branch in logic based on patient data.

> **Note:** Stub sending a `MESSAGE` with:
>
> ```ts
> console.log(`Sending message to patient ${patientId}: ${message}`);
> ```

### [2] TypeScript Interfaces

**[a] Action to be performed (e.g., send SMS or make a call)**
```ts
interface ActionNode {
  id: string;
  type: 'MESSAGE';
  message: string;
  next_node_id: string | null;
}
```

**[b] Simple time delay**
```ts
interface DelayNode {
  id: string;
  type: 'DELAY';
  duration_seconds: number;
  next_node_id: string | null;
}
```

**[c] Conditional branch based on patient data**
```ts
interface ConditionalNode {
  id: string;
  type: 'CONDITIONAL';
  condition: {
    // e.g., 'patient.age', 'patient.condition'
    field: string;
    // e.g., '>', '=', '!='
    operator: string;
    // value to compare against
    value: any;
  };
  // Next node if the condition is true/false
  on_true_next_node_id: string | null;
  on_false_next_node_id: string | null;
}
```

**[d] Journey**
```ts
type JourneyNode = ActionNode | DelayNode | ConditionalNode;

interface Journey {
  id: string;
  name: string;
  start_node_id: string;
  nodes: JourneyNode[];
}
```

**[e] Patient context for evaluating conditionals**
```ts
interface PatientContext {
  id: string;
  age: number;
  language: 'en' | 'es';
  condition: 'hip_replacement' | 'knee_replacement';
}
```

---

## API Endpoints

**[a] `POST /journeys`**
- **Action:** Create and store a new journey definition.
- **Body:** JSON matching the `Journey` interface.
- **Response:** `201 Created` → `{ "journeyId": "some-uuid" }`.

**[b] `POST /journeys/:journeyId/trigger`**
- **Action:** Start a new execution run of a specific journey for a patient.
- **Body:** JSON containing the `PatientContext`.
- **Response:** `202 Accepted` → `{ "runId": "some-run-uuid" }` and a `Location` header pointing to the monitoring endpoint, e.g., `Location: /journeys/runs/some-run-uuid`.

**[c] `GET /journeys/runs/:runId`**
- **Action:** Monitor the status of a specific journey run.
- **Response:** `200 OK` →
```json
{
  "runId": "...",
  "status": "in_progress | completed",
  "currentNodeId": "...",
  "patientContext": { }
}
```

---

## Journey Executor (Main Logic)

When a journey is triggered, the system should:
1. Create a new run record with a unique `runId`.
2. Store the state of this run (e.g., which node is currently being processed).
3. Process nodes sequentially, starting from `start_node_id`.
4. Handle each node type:
   - `MESSAGE`: log a message.
   - `DELAY`: wait for the specified duration.
   - `CONDITIONAL`: branch based on patient data.
5. Update the run’s state as it progresses through the nodes.

---

## Tests

Write Unit & E2E tests for:
- API endpoints (creating a journey, triggering it).
- Executor logic for a simple, linear journey.
- Executor logic for a journey with a conditional branch.
- Executor logic for a journey involving a delay.

---

## Nice-to-Haves (future)
1. Swap `setTimeout` for a database/queue; possibly extend to bullmq with an in-memory Redis substitute.
2. Manage state for many concurrent, long-running journeys.
3. “Wake up” a journey after a delay via persisted `next_wake_at`.
