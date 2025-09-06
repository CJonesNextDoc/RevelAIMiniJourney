import dbHelper from './utils/dbHelper';
import repo from '../src/db/repo';
import executor from '../src/services/executor';

describe('executor linear journey (unit)', () => {
  let helper: any;

  beforeEach(() => {
    helper = dbHelper.createTempDbAndInit('executor-linear');
  });

  afterEach(async () => {
    try { (executor as any).clearScheduledTimeouts && (executor as any).clearScheduledTimeouts(); } catch (e) { /* ignore */ }
    try { await helper.cleanup(); } catch (e) { /* ignore */ }
  });

  test('processRun handles two MESSAGE nodes end-to-end', async () => {
    const journey = {
      id: 'jl-1',
      startNodeId: 'm1',
      nodes: [
        { id: 'm1', type: 'MESSAGE', message: 'first', next: 'm2' },
        { id: 'm2', type: 'MESSAGE', message: 'second', next: null },
      ],
    } as any;

    const journeyId = repo.createJourney(undefined, 'linear-journey', journey);
    const runId = repo.createRun(journeyId);
    repo.appendRunStep(runId, null, 'triggered', { context: {} });

    // run the executor loop for this run
    await (executor as any).processRun(runId, 20);

    const steps = repo.getRunSteps(runId);
    const messages = steps.filter((s: any) => s.type === 'message_sent').map((s: any) => s.payload?.message);
    expect(messages).toContain('first');
    expect(messages).toContain('second');

    const run = repo.getRun(runId);
    expect(run.state).toBe('completed');
  });
});
