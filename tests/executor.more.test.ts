import dbHelper from './utils/dbHelper';
import repo from '../src/db/repo';
import executor, { clearScheduledTimeouts } from '../src/services/executor';

describe('executor additional branches', () => {
  let helper: any;

  beforeEach(() => {
    helper = dbHelper.createTempDbAndInit('executor-more-test');
  // suppress expected console.error logs from executor during negative-path tests
  jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    clearScheduledTimeouts();
  try { await helper.cleanup(); } catch (e) { /* ignore */ }
  // restore console.error mock
  (console.error as any).mockRestore?.();
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

  test('preflight: waiting_delay with future next_wake_at returns early', async () => {
    const journey = {
      id: 'jm-preflight-1',
      startNodeId: 'a1',
      nodes: [ { id: 'a1', type: 'MESSAGE', message: 'hi', next: null } ],
    } as any;

    const journeyId = repo.createJourney(undefined, 'preflight-journey', journey);
    const runId = repo.createRun(journeyId);
    repo.appendRunStep(runId, null, 'triggered', { context: {} });

    // set run to waiting_delay with next_wake_at in the future
    const future = new Date(Date.now() + 1000 * 60).toISOString();
    repo.updateRunState(runId, 'waiting_delay', { next_wake_at: future, current_node_id: 'a1' });

    // processRun should return early and not claim or append new steps
    await executor.processRun(runId, 10);

    const run = repo.getRun(runId);
    expect(run.state).toBe('waiting_delay');
    const steps = repo.getRunSteps(runId);
    // only the original triggered step should exist
    expect(steps.length).toBe(1);
  });

  test('preflight: claimRunForProcessing fails when already in_progress', async () => {
    const journey = {
      id: 'jm-preflight-2',
      startNodeId: 'b1',
      nodes: [ { id: 'b1', type: 'MESSAGE', message: 'ok', next: null } ],
    } as any;

    const journeyId = repo.createJourney(undefined, 'preflight-claim', journey);
    const runId = repo.createRun(journeyId);
    repo.appendRunStep(runId, null, 'triggered', { context: {} });

    // simulate another worker by marking run in_progress
    repo.updateRunState(runId, 'in_progress', { current_node_id: 'b1' });

    await executor.processRun(runId, 10);

    const run = repo.getRun(runId);
    // state should remain in_progress (claim should not have succeeded)
    expect(run.state).toBe('in_progress');
    const steps = repo.getRunSteps(runId);
    // only the triggered step should exist (executor should not append new steps)
    expect(steps.length).toBe(1);
  });
});
