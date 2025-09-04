import buildApp from '../src/app';
import journeysRoutes from '../src/routes/journeys';
import * as repo from '../src/db/repo';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

let app: any;
let dbFile: string;

beforeAll(async () => {
  dbFile = path.join(os.tmpdir(), `revelai-test-${uuidv4()}.sqlite`);
  // initialize repository with a temporary sqlite file (schema will be applied)
  repo.initRepository(dbFile);

  app = buildApp();
  app.register(journeysRoutes);
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
  try {
    if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
  } catch (e) {
    // ignore
  }
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
  const trigger = await app.inject({ method: 'POST', url: `/journeys/${journeyId}/trigger`, payload: { requestId: 'r-123', patientId: 'p-x', context: { a: 1 } } });
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
