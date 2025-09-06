import buildApp from '../src/app';
import journeysRoutes from '../src/routes/journeys';
import { createTempDbAndInit } from './utils/dbHelper';
import executor from '../src/services/executor';

jest.setTimeout(20000);

describe('executor poller recovery', () => {
  let tmp: any;
  let app: any;

  beforeEach(() => {
    tmp = createTempDbAndInit('poller-test');
  });

  afterEach(async () => {
    try { if (app) await app.close(); } catch (e) { /* ignore */ }
    try { (executor as any).clearScheduledTimeouts && (executor as any).clearScheduledTimeouts(); } catch (e) { /* ignore */ }
    try { await tmp.cleanup(); } catch (e) { /* ignore */ }
  });

  test('poller resumes runs when in-memory timers are lost', async () => {
    app = buildApp();
    app.register(journeysRoutes);
    await app.ready();

    // journey with a short delay
    const journeyPayload = {
      name: 'poller-delay',
      startNodeId: 'd1',
      nodes: [
        { id: 'd1', type: 'DELAY', delaySeconds: 1, next: 'd2' },
        { id: 'd2', type: 'MESSAGE', message: 'after delay', next: null }
      ]
    };

    const createRes = await app.inject({ method: 'POST', url: '/journeys', payload: journeyPayload });
    expect(createRes.statusCode).toBe(201);
    const { id: journeyId } = JSON.parse(createRes.payload);

    const triggerRes = await app.inject({ method: 'POST', url: `/journeys/${journeyId}/trigger`, payload: { requestId: 'p1' } });
    expect(triggerRes.statusCode).toBe(202);
    const { runId } = JSON.parse(triggerRes.payload);

    // simulate process losing in-memory timers by clearing them
    (executor as any).clearScheduledTimeouts();

    // wait a bit longer than delay to allow poller (running every 5s) to find the run
    await new Promise((r) => setTimeout(r, 6000));

    const status = await app.inject({ method: 'GET', url: `/journeys/runs/${runId}` });
    expect(status.statusCode).toBe(200);
    const body = JSON.parse(status.payload);
    const hasMsg = body.steps.some((s: any) => s.type === 'message_sent' && s.payload?.message === 'after delay');
    expect(hasMsg).toBe(true);
  });
});
