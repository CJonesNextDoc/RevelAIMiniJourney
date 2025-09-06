/**
 * === REVIEW ANNOTATIONS: journeys.test.ts (E2E and unit-adjacent) ===
 * - Covers: bad bodies/params, idempotency, delay resume, and max-steps failure.
 * - Technique: Fastify app.inject for route tests; real repo operations.
 * - Timing: waits slightly > delay to allow setTimeout to fire.
 * - Branching: asserts condition-driven path behavior.
 */

import buildApp from '../src/app';
import journeysRoutes from '../src/routes/journeys';
import * as repo from '../src/db/repo';
import { createTempDbAndInit } from './utils/dbHelper';
import executor from '../src/services/executor';

// Increase default timeout for tests that schedule timers
jest.setTimeout(20000);

let app: any;
let dbCleanup: (() => Promise<void>) | null = null;

beforeAll(async () => {
  const tmp = createTempDbAndInit();
  dbCleanup = tmp.cleanup;

  app = buildApp();
  app.register(journeysRoutes);
  await app.ready();
});

afterAll(async () => {
  if (app) {
    // guard close with timeout
    await Promise.race([
      app.close(),
      new Promise((res) => {
    const t = setTimeout(res, 2000);
    try { (t as any).unref && (t as any).unref(); } catch (e) { /* ignore */ }
      })
    ]);
  }
  if (dbCleanup) {
    try { await dbCleanup(); } catch (e) { /* ignore */ }
  }
});

// Always restore real timers after each test to avoid hangs when a test uses fake timers
afterEach(() => {
  try { (jest.useRealTimers as any)(); } catch (e) { /* ignore */ }
  try { (jest.clearAllTimers as any)(); } catch (e) { /* ignore */ }
  try { (executor as any).clearScheduledTimeouts && (executor as any).clearScheduledTimeouts(); } catch (e) { /* ignore */ }
});

test('POST /journeys creates a journey and returns id', async () => {
  const payload = {
    name: 'smoke-test',
    nodes: [
      { id: 'n1', type: 'MESSAGE', message: 'Hello from test', next: null }
    ]
  };

  const res = await app.inject({ method: 'POST', url: '/journeys', payload });
  expect(res.statusCode).toBe(201);
  const body = JSON.parse(res.payload);
  expect(body).toHaveProperty('id');
});

test('POST /journeys/:journeyId/trigger creates a run and GET returns run and steps', async () => {
  // create a journey first
  const journeyPayload = {
    name: 'trigger-test',
    nodes: [
      { id: 'n1', type: 'MESSAGE', message: 'Hello from trigger test', next: null }
    ]
  };

  const createRes = await app.inject({ method: 'POST', url: '/journeys', payload: journeyPayload });
  expect(createRes.statusCode).toBe(201);
  const { id: journeyId } = JSON.parse(createRes.payload);
  expect(journeyId).toBeTruthy();

  // trigger the journey
  const triggerBody = { requestId: 'req-1', patientId: 'p-1', context: { score: 5 } };
  const triggerRes = await app.inject({ method: 'POST', url: `/journeys/${journeyId}/trigger`, payload: triggerBody });
  expect(triggerRes.statusCode).toBe(202);
  expect(triggerRes.headers).toHaveProperty('location');
  const { runId } = JSON.parse(triggerRes.payload);
  expect(runId).toBeTruthy();

  // fetch run status
  const statusRes = await app.inject({ method: 'GET', url: `/journeys/runs/${runId}` });
  expect(statusRes.statusCode).toBe(200);
  const statusBody = JSON.parse(statusRes.payload);
  expect(statusBody).toHaveProperty('run');
  expect(statusBody).toHaveProperty('steps');
  expect(Array.isArray(statusBody.steps)).toBe(true);
  // initial triggered step should be present
  const hasTriggered = statusBody.steps.some((s: any) => s.type === 'triggered');
  expect(hasTriggered).toBe(true);
});

test('GET /journeys/runs/:runId returns 404 for missing run', async () => {
  const fakeRunId = '00000000-0000-4000-8000-000000000000';
  const res = await app.inject({ method: 'GET', url: `/journeys/runs/${fakeRunId}` });
  expect(res.statusCode).toBe(404);
  const body = JSON.parse(res.payload);
  expect(body).toHaveProperty('error', 'not_found');
});

test('manual start flow: create run with start=false then start it explicitly', async () => {
  const journeyPayload = {
    name: 'manual-start-test',
    nodes: [
      { id: 'n1', type: 'MESSAGE', message: 'manual start message', next: null }
    ]
  };

  const createRes = await app.inject({ method: 'POST', url: '/journeys', payload: journeyPayload });
  expect(createRes.statusCode).toBe(201);
  const { id: journeyId } = JSON.parse(createRes.payload);

  // trigger with start=false
  const triggerRes = await app.inject({ method: 'POST', url: `/journeys/${journeyId}/trigger?start=false`, payload: { requestId: 'r1' } });
  expect(triggerRes.statusCode).toBe(202);
  const { runId } = JSON.parse(triggerRes.payload);
  expect(runId).toBeTruthy();

  // start explicitly
  const startRes = await app.inject({ method: 'POST', url: `/journeys/runs/${runId}/start` });
  expect(startRes.statusCode).toBe(202);

  // fetch run status eventually contains completed step
  const statusRes = await app.inject({ method: 'GET', url: `/journeys/runs/${runId}` });
  expect(statusRes.statusCode).toBe(200);
  const statusBody = JSON.parse(statusRes.payload);
  expect(statusBody).toHaveProperty('steps');
  const hasMessage = statusBody.steps.some((s: any) => s.type === 'message_sent');
  expect(hasMessage).toBe(true);
});

test('POST /journeys with invalid payload returns 400 and validation details', async () => {
  // missing 'name' and 'nodes'
  const bad = { foo: 'bar' };
  const res = await app.inject({ method: 'POST', url: '/journeys', payload: bad });
  expect(res.statusCode).toBe(400);
  const body = JSON.parse(res.payload);
  expect(body).toHaveProperty('error', 'invalid_payload');
  expect(body).toHaveProperty('details');
});

test('POST /journeys/:journeyId/trigger returns 404 when journey missing', async () => {
  const fakeJourneyId = '00000000-0000-4000-8000-000000000001';
  const res = await app.inject({ method: 'POST', url: `/journeys/${fakeJourneyId}/trigger`, payload: { requestId: 'r' } });
  expect(res.statusCode).toBe(404);
  const body = JSON.parse(res.payload);
  expect(body).toHaveProperty('error', 'not_found');
});

test('POST /journeys/:journeyId/trigger with invalid body returns 400', async () => {
  // create a valid journey first
  const payload = { name: 'invalid-trigger-body', nodes: [{ id: 'n1', type: 'MESSAGE', message: 'm', next: null }] };
  const createRes = await app.inject({ method: 'POST', url: '/journeys', payload });
  expect(createRes.statusCode).toBe(201);
  const { id: journeyId } = JSON.parse(createRes.payload);

  // send an invalid body (JSON string) - syntactically valid JSON but not the expected object
  const triggerRes = await app.inject({ method: 'POST', url: `/journeys/${journeyId}/trigger`, payload: JSON.stringify('this-is-not-an-object'), headers: { 'content-type': 'application/json' } });
  expect(triggerRes.statusCode).toBe(400);
  const triggerBody = JSON.parse(triggerRes.payload);
  expect(triggerBody).toHaveProperty('error', 'invalid_body');
});

test('Stored journey, run and step payloads match what was sent', async () => {
  const journeyPayload = {
    name: 'verify-storage',
    nodes: [{ id: 'n1', type: 'MESSAGE', message: 'store check', next: null }],
    metadata: { team: 'qa' }
  };

  const createRes = await app.inject({ method: 'POST', url: '/journeys', payload: journeyPayload });
  expect(createRes.statusCode).toBe(201);
  const { id: journeyId } = JSON.parse(createRes.payload);

  // ensure repo returns the same payload shape
  const stored = repo.getJourney(journeyId);
  expect(stored).not.toBeNull();
  expect(stored!.name).toBe(journeyPayload.name);
  expect(stored!.metadata).toEqual(journeyPayload.metadata);
  expect(Array.isArray(stored!.payload.nodes)).toBe(true);

  // trigger and validate run stored in repo
  const trigger = await app.inject({ method: 'POST', url: `/journeys/${journeyId}/trigger?start=false`, payload: { requestId: 'r-123', patientId: 'p-x', context: { a: 1 } } });
  expect(trigger.statusCode).toBe(202);
  const { runId } = JSON.parse(trigger.payload);

  const run = repo.getRun(runId);
  expect(run).not.toBeNull();
  expect(run.journey_id).toBe(journeyId);
  expect(run.state).toBe('queued');

  const steps = repo.getRunSteps(runId);
  expect(Array.isArray(steps)).toBe(true);
  const triggered = steps.find((s: any) => s.type === 'triggered');
  expect(triggered).toBeTruthy();
  expect(triggered.payload).toHaveProperty('requestId', 'r-123');
  expect(triggered.payload).toHaveProperty('context');
});

test('Idempotency: repeated triggers with same Idempotency-Key return same run', async () => {
  const journeyPayload = { name: 'idemp-test', nodes: [{ id: 'n1', type: 'MESSAGE', message: 'hi', next: null }] };
  const createRes = await app.inject({ method: 'POST', url: '/journeys', payload: journeyPayload });
  expect(createRes.statusCode).toBe(201);
  const { id: journeyId } = JSON.parse(createRes.payload);

  const headers = { 'idempotency-key': 'key-123' };
  const first = await app.inject({ method: 'POST', url: `/journeys/${journeyId}/trigger`, payload: { requestId: 'r1' }, headers });
  expect(first.statusCode).toBe(202);
  const { runId: runA } = JSON.parse(first.payload);

  const second = await app.inject({ method: 'POST', url: `/journeys/${journeyId}/trigger`, payload: { requestId: 'r1' }, headers });
  expect(second.statusCode).toBe(202);
  const { runId: runB } = JSON.parse(second.payload);

  expect(runA).toBe(runB);
});

test('Executor conditional branch chooses correct path based on context', async () => {
  const journeyPayload = {
    name: 'cond-test',
    nodes: [
      { id: 'start', type: 'CONDITION', condition: { leftKey: 'flag', operator: '==', rightValue: true }, trueNext: 't', falseNext: 'f' },
      { id: 't', type: 'MESSAGE', message: 'true branch', next: null },
      { id: 'f', type: 'MESSAGE', message: 'false branch', next: null }
    ],
    startNodeId: 'start'
  };

  const createRes = await app.inject({ method: 'POST', url: '/journeys', payload: journeyPayload });
  expect(createRes.statusCode).toBe(201);
  const { id: journeyId } = JSON.parse(createRes.payload);

  const triggerRes = await app.inject({ method: 'POST', url: `/journeys/${journeyId}/trigger`, payload: { requestId: 'r1', context: { flag: true } } });
  expect(triggerRes.statusCode).toBe(202);
  const { runId } = JSON.parse(triggerRes.payload);

  const statusRes = await app.inject({ method: 'GET', url: `/journeys/runs/${runId}` });
  const body = JSON.parse(statusRes.payload);
  const hasTrue = body.steps.some((s: any) => s.type === 'message_sent' && s.payload?.message === 'true branch');
  expect(hasTrue).toBe(true);
});

test('Executor handles DELAY by scheduling resume (real timers)', async () => {
  const journeyPayload = {
    name: 'delay-test',
    nodes: [
      { id: 'n1', type: 'DELAY', delaySeconds: 1, next: 'n2' },
      { id: 'n2', type: 'MESSAGE', message: 'after delay', next: null }
    ],
    startNodeId: 'n1'
  };

  const createRes = await app.inject({ method: 'POST', url: '/journeys', payload: journeyPayload });
  expect(createRes.statusCode).toBe(201);
  const { id: journeyId } = JSON.parse(createRes.payload);

  const triggerRes = await app.inject({ method: 'POST', url: `/journeys/${journeyId}/trigger`, payload: { requestId: 'r-delay' } });
  expect(triggerRes.statusCode).toBe(202);
  const { runId } = JSON.parse(triggerRes.payload);

  // After trigger, run should be waiting_delay or in_progress
  const before = JSON.parse((await app.inject({ method: 'GET', url: `/journeys/runs/${runId}` })).payload);
  // State should be waiting_delay (if delay node) or in_progress (fast paths)
  expect(before.run.state === 'waiting_delay' || before.run.state === 'in_progress').toBeTruthy();

  // Wait slightly longer than the delay to allow the scheduled resume to run
  await new Promise((res) => setTimeout(res, 1500));

  const after = JSON.parse((await app.inject({ method: 'GET', url: `/journeys/runs/${runId}` })).payload);
  // should have message_sent step
  const hasMsg = after.steps.some((s: any) => s.type === 'message_sent' && s.payload?.message === 'after delay');
  expect(hasMsg).toBe(true);
});

// This test intentionally exercises the executor's safety guard which logs a warning
// when the max-steps limit is exceeded. By default we suppress that console.warn to
// keep test output clean. To run this single test in "noisy" (verbose) mode and see
// the warning, set the env var NOISY_MAX_STEPS=1 and run Jest for this test only, e.g.: 
//
//   NOISY_MAX_STEPS=1 npx.cmd jest -t "Executor max-steps edge: cycles cause failure when maxSteps exceeded"
//
// On Windows PowerShell you can set the env var for the command like:
//   $env:NOISY_MAX_STEPS=1; npx.cmd jest -t "Executor max-steps edge: cycles cause failure when maxSteps exceeded"
test('Executor max-steps edge: cycles cause failure when maxSteps exceeded', async () => {
  const journeyPayload = {
    name: 'cycle-test',
    nodes: [
      { id: 'a', type: 'MESSAGE', message: 'a', next: 'b' },
      { id: 'b', type: 'MESSAGE', message: 'b', next: 'a' }
    ],
    startNodeId: 'a'
  };

  const createRes = await app.inject({ method: 'POST', url: '/journeys', payload: journeyPayload });
  expect(createRes.statusCode).toBe(201);
  const { id: journeyId } = JSON.parse(createRes.payload);

  // create run but do not auto-start
  const triggerRes = await app.inject({ method: 'POST', url: `/journeys/${journeyId}/trigger?start=false`, payload: { requestId: 'cycle' } });
  expect(triggerRes.statusCode).toBe(202);
  const { runId } = JSON.parse(triggerRes.payload);

  // manually invoke processRun with small maxSteps
  // Directly invoke engine with low maxSteps to simulate cycle protection
  // Suppress the console.warn emitted by the executor during this expected failure
  // unless NOISY_MAX_STEPS=1 is set in the environment.
  let warnSpy: jest.SpyInstance | undefined;
  const noisy = !!process.env.NOISY_MAX_STEPS;
  if (!noisy) {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  }
  try {
    await (executor as any).processRun(runId, 5);
  } finally {
    if (warnSpy) warnSpy.mockRestore();
  }

  const run = repo.getRun(runId);
  expect(run.state).toBe('failed');
  const steps = repo.getRunSteps(runId);
  const hasError = steps.some((s: any) => s.type === 'error' || (s.type === 'error' && s.payload?.message === 'max steps exceeded'));
  // at least one error step should be present
  expect(hasError).toBe(true);
});
