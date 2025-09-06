import dbHelper from './utils/dbHelper';
import repo from '../src/db/repo';
import executor, { clearScheduledTimeouts } from '../src/services/executor';

describe('executor additional branches', () => {
  let helper: any;

  beforeEach(() => {
    helper = dbHelper.createTempDbAndInit('executor-more-test');
  });

  afterEach(async () => {
    clearScheduledTimeouts();
    try { await helper.cleanup(); } catch (e) { /* ignore */ }
  });

  test('CONDITION false takes falseNext branch and records condition_evaluated', async () => {
    const journey = {
      id: 'jm-false',
      startNodeId: 'n1',
      nodes: [
        { id: 'n1', type: 'CONDITION', condition: { leftKey: 'flag', operator: '==', rightValue: true }, trueNext: 'n2', falseNext: 'n3' },
        { id: 'n2', type: 'MESSAGE', message: 'true-path', next: null },
        { id: 'n3', type: 'MESSAGE', message: 'false-path', next: null },
      ],
    } as any;

    const journeyId = repo.createJourney(undefined, 'cond-false', journey);
    const runId = repo.createRun(journeyId);
    // triggered with flag=false so condition is false
    repo.appendRunStep(runId, null, 'triggered', { context: { flag: false } });

    await executor.processRun(runId, 10);

    const steps = repo.getRunSteps(runId);
    // ensure condition_evaluated step exists and result false
    const cond = steps.find((s: any) => s.type === 'condition_evaluated');
    expect(cond).toBeDefined();
    expect(cond.payload?.result).toBe(false);
    // ensure final message from false branch was sent
    expect(steps.some((s: any) => s.type === 'message_sent' && s.payload?.message === 'false-path')).toBeTruthy();
  });

  test('unknown node type marks run failed with unknown_node_type', async () => {
    const journey = {
      id: 'jm-unknown',
      startNodeId: 'a1',
      nodes: [
        { id: 'a1', type: 'FOO', next: null },
      ],
    } as any;

    const journeyId = repo.createJourney(undefined, 'unknown-node', journey);
    const runId = repo.createRun(journeyId);
    repo.appendRunStep(runId, null, 'triggered', { context: {} });

    await executor.processRun(runId, 10);

    const steps = repo.getRunSteps(runId);
    // expect an error step with unknown_node_type:FOO
    const err = steps.find((s: any) => s.type === 'error' && s.payload?.message?.includes('unknown_node_type'));
    expect(err).toBeDefined();
    const run = repo.getRun(runId);
    expect(run.state).toBe('failed');
  });

  test('missing start node triggers node_not_found error', async () => {
    const journey = {
      id: 'jm-missing',
      startNodeId: 'missing-node',
      nodes: [
        // intentionally no node with id 'missing-node'
        { id: 'x1', type: 'MESSAGE', message: 'hi', next: null },
      ],
    } as any;

    const journeyId = repo.createJourney(undefined, 'missing-node-journey', journey);
    const runId = repo.createRun(journeyId);
    repo.appendRunStep(runId, null, 'triggered', { context: {} });

    await executor.processRun(runId, 10);

    const steps = repo.getRunSteps(runId);
    const err = steps.find((s: any) => s.type === 'error' && s.node_id === 'missing-node');
    expect(err).toBeDefined();
    const run = repo.getRun(runId);
    expect(run.state).toBe('failed');
  });
});
