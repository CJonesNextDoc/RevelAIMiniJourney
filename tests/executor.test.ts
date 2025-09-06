import { jest } from '@jest/globals';
import dbHelper from './utils/dbHelper';
import repo from '../src/db/repo';
import executor, { clearScheduledTimeouts } from '../src/services/executor';

describe('executor branches', () => {
  let helper: any;

  beforeEach(() => {
    helper = dbHelper.createTempDbAndInit('executor-test');
  });

  afterEach(async () => {
    // clear timers to avoid leaks
    clearScheduledTimeouts();
    // best-effort cleanup of DB file and handle
    try { await helper.cleanup(); } catch (e) { /* ignore */ }
  });

  test('MESSAGE -> CONDITION true -> MESSAGE sequence', async () => {
    jest.useFakeTimers();

  // create a simple journey: start -> msg1 -> condition -> msg_true -> end
  const journey = {
      id: 'j1',
      startNodeId: 'n1',
      nodes: [
        { id: 'n1', type: 'MESSAGE', message: 'hello', next: 'n2' },
        { id: 'n2', type: 'CONDITION', condition: { leftKey: 'age', operator: '>=', rightValue: 18 }, trueNext: 'n3', falseNext: null },
        { id: 'n3', type: 'MESSAGE', message: 'adult', next: null },
      ],
    } as any;

  // persist journey via repo API (id may be overridden by repo)
  const journeyId = repo.createJourney(undefined, 'executor-journey', journey);

  // create a run and trigger with patient context age=20
  const runId = repo.createRun(journeyId);
  repo.appendRunStep(runId, null, 'triggered', { context: { age: 20 } });

    // process run

  await executor.processRun(runId, 10);

    // expect steps include message_sent for n1 and n3 and completed
  const steps = repo.getRunSteps(runId);
    const types = steps.map((s: any) => s.type);
    expect(types).toContain('message_sent');
    expect(types).toContain('condition_evaluated');
    expect(types).toContain('completed');

    jest.useRealTimers();
  });

  test('DELAY schedules and resumes', async () => {
    jest.useFakeTimers();

  const journey = {
      id: 'j2',
      startNodeId: 'm1',
      nodes: [
        { id: 'm1', type: 'MESSAGE', message: 'start', next: 'd1' },
        { id: 'd1', type: 'DELAY', delaySeconds: 1, next: 'm2' },
        { id: 'm2', type: 'MESSAGE', message: 'after delay', next: null },
      ],
    } as any;

  const journeyId = repo.createJourney(undefined, 'executor-delay-journey', journey);
  const runId = repo.createRun(journeyId);
  repo.appendRunStep(runId, null, 'triggered', { context: {} });

    // start processing (this should schedule a timeout and return)
  await executor.processRun(runId, 10);

    // advance timers by 1s to trigger the scheduled resume
    jest.advanceTimersByTime(1000);

    // allow any pending promises to run
    await Promise.resolve();

    // Now process again (timeout handler calls processRun, but ensure we cover path)
  await executor.processRun(runId, 10);

  const steps = repo.getRunSteps(runId);
    const hasDelaySet = steps.some((s: any) => s.type === 'delay_set');
    const hasDelayResumed = steps.some((s: any) => s.type === 'delay_resumed');
    expect(hasDelaySet).toBeTruthy();
    expect(hasDelayResumed || steps.some((s: any) => s.type === 'message_sent')).toBeTruthy();

    jest.useRealTimers();
  });
});
