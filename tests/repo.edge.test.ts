import dbHelper from './utils/dbHelper';
import repo from '../src/db/repo';

describe('repo edge cases', () => {
  let helper: any;

  beforeEach(() => {
    helper = dbHelper.createTempDbAndInit('repo-edge-test');
  });

  afterEach(async () => {
    try { await helper.cleanup(); } catch (e) { /* ignore */ }
  });

  test('claimRunForProcessing is atomic and idempotent', () => {
    const journeyId = repo.createJourney(undefined, 'j-edge', { nodes: [] });
    const runId = repo.createRun(journeyId);

    // first claim should succeed (queued -> in_progress)
    const first = repo.claimRunForProcessing(runId, new Date().toISOString());
    expect(first).toBeTruthy();

    // second claim should fail because already in_progress
    const second = repo.claimRunForProcessing(runId, new Date().toISOString());
    expect(second).toBeFalsy();
  });

  test('createRun idempotency by key returns same id', () => {
    const journeyId = repo.createJourney(undefined, 'j-edge2', { nodes: [] });
    const r1 = repo.createRun(journeyId, undefined, 'ikey');
    const r2 = repo.createRun(journeyId, undefined, 'ikey');
    expect(r1).toEqual(r2);
  });

  test('findReadyRuns respects next_wake_at future vs past', () => {
    const journeyId = repo.createJourney(undefined, 'j-edge3', { nodes: [] });
    const runId = repo.createRun(journeyId);

    // set waiting_delay with next_wake_at in future
    const future = new Date(Date.now() + 1000 * 60).toISOString();
    repo.updateRunState(runId, 'waiting_delay', { next_wake_at: future });

    const readyNow = repo.findReadyRuns();
    expect(readyNow.some((r: any) => r.id === runId)).toBeFalsy();

    // set next_wake_at in past
    const past = new Date(Date.now() - 1000 * 60).toISOString();
    repo.updateRunState(runId, 'waiting_delay', { next_wake_at: past });
    const readyLater = repo.findReadyRuns();
    expect(readyLater.some((r: any) => r.id === runId)).toBeTruthy();
  });
});
