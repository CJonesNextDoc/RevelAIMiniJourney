import dbHelper from './utils/dbHelper';
import repo from '../src/db/repo';

describe('findReadyRuns timestamp comparison (ms precision)', () => {
  let helper: any;

  beforeEach(() => {
    helper = dbHelper.createTempDbAndInit('repo-findready');
  });

  afterEach(async () => {
    try { await helper.cleanup(); } catch (e) { /* ignore */ }
  });

  test('findReadyRuns respects milliseconds when nowIso is passed', () => {
    const journeyId = repo.createJourney(undefined, 'j-ts', { nodes: [] });
    const runId = repo.createRun(journeyId);

    // set next_wake_at to a timestamp with milliseconds (ISO string)
    const wakeTs = new Date(Date.now() + 500).toISOString();
    repo.updateRunState(runId, 'waiting_delay', { next_wake_at: wakeTs });

    // If we call findReadyRuns with now slightly before wakeTs, it should NOT return the run
    const beforeNow = new Date(Date.parse(wakeTs) - 1).toISOString();
    const readyBefore = repo.findReadyRuns(100, beforeNow);
    expect(readyBefore.some((r: any) => r.id === runId)).toBeFalsy();

    // If we call with now equal to wakeTs, it should return the run
    const atNow = wakeTs;
    const readyAt = repo.findReadyRuns(100, atNow);
    expect(readyAt.some((r: any) => r.id === runId)).toBeTruthy();
  });
});
