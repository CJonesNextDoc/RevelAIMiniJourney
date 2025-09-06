import { createTempDbAndInit } from './utils/dbHelper';
import * as repo from '../src/db/repo';
import executor from '../src/services/executor';
import buildApp from '../src/app';
import journeysRoutes from '../src/routes/journeys';

// Keep tests isolated and able to clean timers and suppress expected console.error
let _errSpy: jest.SpyInstance | undefined;
beforeEach(() => {
  _errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  try { (jest.useRealTimers as any)(); } catch (e) { /* ignore */ }
  try { (jest.clearAllTimers as any)(); } catch (e) { /* ignore */ }
  try { (executor as any).clearScheduledTimeouts && (executor as any).clearScheduledTimeouts(); } catch (e) { /* ignore */ }
  try { _errSpy && _errSpy.mockRestore(); } catch (e) { /* ignore */ }
});

describe('coverage extras: executor/operator branches and route header', () => {
  test('condition operators (!, >, >=, <, <=) evaluate correctly', async () => {
    const tmp = createTempDbAndInit('cov-op');
    try {
      const ops: Array<{op:string;right:any;trueVal:any;falseVal:any}> = [
        { op: '!=', right: 5, trueVal: 4, falseVal: 5 },
        { op: '>', right: 5, trueVal: 6, falseVal: 5 },
        { op: '>=', right: 5, trueVal: 5, falseVal: 4 },
        { op: '<', right: 5, trueVal: 4, falseVal: 5 },
        { op: '<=', right: 5, trueVal: 5, falseVal: 6 },
      ];

      for (const o of ops) {
        const journeyPayload = {
          name: `op-${o.op}`,
          startNodeId: 'c',
          nodes: [
            { id: 'c', type: 'CONDITION', condition: { leftKey: 'age', operator: o.op, rightValue: o.right }, trueNext: 't', falseNext: 'f' },
            { id: 't', type: 'MESSAGE', message: 'true branch', next: null },
            { id: 'f', type: 'MESSAGE', message: 'false branch', next: null }
          ]
        };

        const jid = repo.createJourney(undefined, `j-${o.op}`, journeyPayload);
        const runId = repo.createRun(jid);
        // attach triggered payload with context to exercise leftKey lookup
        repo.appendRunStep(runId, null, 'triggered', { context: { age: o.trueVal } });

        await (executor as any).processRun(runId);
        const steps = repo.getRunSteps(runId);
        const gotTrue = steps.some((s: any) => s.type === 'message_sent' && s.payload?.message === 'true branch');
        expect(gotTrue).toBe(true);

        // test false case
        const jid2 = repo.createJourney(undefined, `j-${o.op}-2`, journeyPayload);
        const runId2 = repo.createRun(jid2);
        repo.appendRunStep(runId2, null, 'triggered', { context: { age: o.falseVal } });
        await (executor as any).processRun(runId2);
        const steps2 = repo.getRunSteps(runId2);
        const gotFalse = steps2.some((s: any) => s.type === 'message_sent' && s.payload?.message === 'false branch');
        expect(gotFalse).toBe(true);
      }
    } finally {
      try { await tmp.cleanup(); } catch (e) { /* ignore */ }
    }
  });

  test('condition accepts field/value aliases and on_true_next_node_id properties', async () => {
    const tmp = createTempDbAndInit('cov-alias');
    try {
      const journeyPayload = {
        name: 'alias-test',
        startNodeId: 'c',
        nodes: [
          // use alternate property names that executor supports
          { id: 'c', type: 'CONDITION', condition: { field: 'flag', operator: '==', value: true }, on_true_next_node_id: 't', on_false_next_node_id: 'f' },
          { id: 't', type: 'MESSAGE', message: 't!', next: null },
          { id: 'f', type: 'MESSAGE', message: 'f!', next: null }
        ]
      };

      const jid = repo.createJourney(undefined, 'j-alias', journeyPayload);
      const runId = repo.createRun(jid);
      repo.appendRunStep(runId, null, 'triggered', { context: { flag: true } });
      await (executor as any).processRun(runId);
      const steps = repo.getRunSteps(runId);
      expect(steps.some((s: any) => s.type === 'message_sent' && s.payload?.message === 't!')).toBe(true);
    } finally {
      try { await tmp.cleanup(); } catch (e) { /* ignore */ }
    }
  });

  test('unknown node type causes run to fail with error step', async () => {
    const tmp = createTempDbAndInit('cov-unk');
    try {
      const journeyPayload = { name: 'badnode', startNodeId: 'bad', nodes: [{ id: 'bad', type: 'FOO' as any }] };
      const jid = repo.createJourney(undefined, 'j-bad', journeyPayload);
      const runId = repo.createRun(jid);
      await (executor as any).processRun(runId);
      const runRow = repo.getRun(runId);
      expect(runRow.state).toBe('failed');
      const steps = repo.getRunSteps(runId);
      const hasErr = steps.some((s: any) => s.type === 'error' && s.payload && typeof s.payload.message === 'string' && s.payload.message.indexOf('unknown_node_type') !== -1);
      expect(hasErr).toBe(true);
    } finally {
      try { await tmp.cleanup(); } catch (e) { /* ignore */ }
    }
  });

  test('missing node id in run.current_node_id yields node_not_found error', async () => {
    const tmp = createTempDbAndInit('cov-miss');
    try {
      const journeyPayload = { name: 'miss', startNodeId: 'n1', nodes: [{ id: 'n1', type: 'MESSAGE', message: 'ok', next: null }] };
      const jid = repo.createJourney(undefined, 'j-miss', journeyPayload);
      const runId = repo.createRun(jid);
      // set an invalid current node id
      repo.updateRunState(runId, 'queued', { current_node_id: 'no-such-node' });
      await (executor as any).processRun(runId);
      const runRow = repo.getRun(runId);
      expect(runRow.state).toBe('failed');
      const steps = repo.getRunSteps(runId);
      const hasNodeNotFound = steps.some((s: any) => s.type === 'error' && s.payload && s.payload.message === 'node not found');
      expect(hasNodeNotFound).toBe(true);
    } finally {
      try { await tmp.cleanup(); } catch (e) { /* ignore */ }
    }
  });

  test('POST /journeys/:id/trigger respects x-run-auto-start header=false', async () => {
    const tmp = createTempDbAndInit('cov-route');
    let app: any;
    try {
      app = buildApp();
      app.register(journeysRoutes);
      await app.ready();

      const payload = { name: 'hdr-test', nodes: [{ id: 'n1', type: 'MESSAGE', message: 'h', next: null }] };
      const createRes = await app.inject({ method: 'POST', url: '/journeys', payload });
      expect(createRes.statusCode).toBe(201);
      const { id: jid } = JSON.parse(createRes.payload);

      // trigger but disable auto-start via header
      const triggerRes = await app.inject({ method: 'POST', url: `/journeys/${jid}/trigger`, payload: { requestId: 'h1' }, headers: { 'x-run-auto-start': 'false' } });
      expect(triggerRes.statusCode).toBe(202);
      const { runId } = JSON.parse(triggerRes.payload);

      // run should exist and be queued (not auto-started)
      const status = await app.inject({ method: 'GET', url: `/journeys/runs/${runId}` });
      const body = JSON.parse(status.payload);
      expect(body.run.state).toBe('queued');
    } finally {
      try { if (app) await app.close(); } catch (e) { /* ignore */ }
      try { await tmp.cleanup(); } catch (e) { /* ignore */ }
    }
  });

  test('GET /journeys/runs/:runId exposes top-level summary fields', async () => {
    const tmp = createTempDbAndInit('cov-summary');
    let app: any;
    try {
      app = buildApp();
      app.register(journeysRoutes);
      await app.ready();

      const payload = { name: 'summary-test', nodes: [{ id: 'n1', type: 'MESSAGE', message: 'hi', next: null }] };
      const createRes = await app.inject({ method: 'POST', url: '/journeys', payload });
      expect(createRes.statusCode).toBe(201);
      const { id: jid } = JSON.parse(createRes.payload);

      const triggerRes = await app.inject({ method: 'POST', url: `/journeys/${jid}/trigger?start=false`, payload: { requestId: 's1' } });
      expect(triggerRes.statusCode).toBe(202);
      const { runId } = JSON.parse(triggerRes.payload);

      const statusRes = await app.inject({ method: 'GET', url: `/journeys/runs/${runId}` });
      expect(statusRes.statusCode).toBe(200);
      const body = JSON.parse(statusRes.payload);

      expect(body).toHaveProperty('runId', runId);
      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('currentNodeId');
      expect(body).toHaveProperty('patientContext');

      // backward-compat: still include run and steps
      expect(body).toHaveProperty('run');
      expect(body).toHaveProperty('steps');
    } finally {
      try { if (app) await app.close(); } catch (e) { /* ignore */ }
      try { await tmp.cleanup(); } catch (e) { /* ignore */ }
    }
  });

  test('POST /journeys returns journeyId (backward-compatible with id)', async () => {
    const tmp = createTempDbAndInit('cov-create');
    let app: any;
    try {
      app = buildApp();
      app.register(journeysRoutes);
      await app.ready();

      const payload = { name: 'create-test', nodes: [{ id: 'n1', type: 'MESSAGE', message: 'hi', next: null }] };
      const res = await app.inject({ method: 'POST', url: '/journeys', payload });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('journeyId');
      expect(body).toHaveProperty('id');
      expect(body.journeyId).toBe(body.id);
    } finally {
      try { if (app) await app.close(); } catch (e) { /* ignore */ }
      try { await tmp.cleanup(); } catch (e) { /* ignore */ }
    }
  });

});
