import dbHelper from './utils/dbHelper';
import repo from '../src/db/repo';
import executor from '../src/services/executor';
import { getDb } from '../src/plugins/db';

describe('executor extra edge cases', () => {
  let helper: any;

  beforeEach(() => {
    helper = dbHelper.createTempDbAndInit('executor-extra');
  });

  afterEach(async () => {
    try { (executor as any).clearScheduledTimeouts && (executor as any).clearScheduledTimeouts(); } catch (e) { /* ignore */ }
    try { await helper.cleanup(); } catch (e) { /* ignore */ }
  });

  test('marks run failed when journey is missing', async () => {
  // create a run that references a missing journey by temporarily disabling
  // SQLite foreign key enforcement so the run insert succeeds.
  const db = getDb();
    try {
      db.pragma('foreign_keys = OFF');
      const runId = repo.createRun('journey-that-does-not-exist');
      repo.appendRunStep(runId, null, 'triggered', { context: {} });

      await (executor as any).processRun(runId);

      const run = repo.getRun(runId);
      expect(run).not.toBeNull();
      expect(run.state).toBe('failed');

      const steps = repo.getRunSteps(runId);
      expect(steps.some((s: any) => s.type === 'error' && s.payload && s.payload.message && String(s.payload.message).includes('journey not found'))).toBeTruthy();
    } finally {
      // re-enable foreign keys for the rest of the tests
      try { db.pragma('foreign_keys = ON'); } catch (e) { /* ignore */ }
    }
    
  });

  test('unknown node type causes run to fail with error', async () => {
    const journey = {
      id: 'j-unknown',
      startNodeId: 'n1',
      nodes: [{ id: 'n1', type: 'FOO', next: null }],
    } as any;

    const journeyId = repo.createJourney(undefined, 'unknown-node-journey', journey);
    const runId = repo.createRun(journeyId);
    repo.appendRunStep(runId, null, 'triggered', { context: {} });

    await (executor as any).processRun(runId);

    const run = repo.getRun(runId);
    expect(run.state).toBe('failed');
    expect(String(run.error)).toContain('unknown_node_type');

    const steps = repo.getRunSteps(runId);
    expect(steps.some((s: any) => s.type === 'error')).toBeTruthy();
  });

  test('max steps exceeded stops runaway loops', async () => {
    // create a journey with a self-loop to force the max-steps safety
    const journey = {
      id: 'j-loop',
      startNodeId: 'n1',
      nodes: [{ id: 'n1', type: 'MESSAGE', message: 'loop', next: 'n1' }],
    } as any;

    const journeyId = repo.createJourney(undefined, 'loop-journey', journey);
    const runId = repo.createRun(journeyId);
    repo.appendRunStep(runId, null, 'triggered', { context: {} });

    // use a small maxSteps to trigger the safety path quickly
    await (executor as any).processRun(runId, 3);

    const run = repo.getRun(runId);
    expect(run.state).toBe('failed');
    expect(String(run.error)).toBe('max_steps_exceeded');

    const steps = repo.getRunSteps(runId);
    expect(steps.some((s: any) => s.type === 'error' && s.payload && String(s.payload.message).includes('max steps exceeded'))).toBeTruthy();
  });
});
