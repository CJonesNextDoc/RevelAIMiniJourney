import dbHelper from './utils/dbHelper';
import repo from '../src/db/repo';
import executor, { __getScheduledTimeoutCount } from '../src/services/executor';

describe('executor delay integration', () => {
  let helper: any;

  beforeEach(() => {
    helper = dbHelper.createTempDbAndInit('executor-delay');
  });

  afterEach(async () => {
    try { (executor as any).clearScheduledTimeouts && (executor as any).clearScheduledTimeouts(); } catch (e) { /* ignore */ }
    try { await helper.cleanup(); } catch (e) { /* ignore */ }
  });

  test('schedules a delay timer and clearScheduledTimeouts removes it', async () => {
    const journey = {
      id: 'jd-1',
      startNodeId: 'd1',
      nodes: [
        { id: 'd1', type: 'DELAY', delaySeconds: 5, next: 'm1' },
        { id: 'm1', type: 'MESSAGE', message: 'after', next: null },
      ],
    } as any;

    const journeyId = repo.createJourney(undefined, 'delay-journey', journey);
    const runId = repo.createRun(journeyId);
    repo.appendRunStep(runId, null, 'triggered', { context: {} });

    // startRun should schedule the delay timer and return quickly
    executor.startRun(runId);

    // small delay to allow executor to persist state and schedule timer
    await new Promise((r) => setTimeout(r, 200));

    const countAfterSchedule = __getScheduledTimeoutCount();
    expect(countAfterSchedule).toBeGreaterThanOrEqual(1);

    // clear scheduled timeouts and check count
    executor.clearScheduledTimeouts();
    const countAfterClear = __getScheduledTimeoutCount();
    expect(countAfterClear).toBe(0);
  });
});
