import { createTempDbAndInit } from './utils/dbHelper';
import repo from '../src/db/repo';
import executor from '../src/services/executor';

/**
 * Demo/visualization test
 * - Prints the journey JSON and trigger context
 * - Runs the executor for the run
 * - Prints a concise summary of executed steps so you can visually inspect results
 *
 * Run this test to see the sample journey + context + per-node results in your terminal:
 *   npm run test:single -- tests/demo.visualize.test.ts
 */
test('demo: visualize journey execution (prints journey, trigger, and step summary)', async () => {
  const tmp = createTempDbAndInit('demo-visualize');
  try {
    const journeyPayload = {
      name: 'demo-visualize',
      startNodeId: 'start',
      nodes: [
        { id: 'start', type: 'MESSAGE', message: 'welcome', next: 'cond' },
        { id: 'cond', type: 'CONDITION', condition: { leftKey: 'score', operator: '>=', rightValue: 50 }, trueNext: 'high', falseNext: 'low' },
        { id: 'high', type: 'MESSAGE', message: 'high score', next: null },
        { id: 'low', type: 'MESSAGE', message: 'low score', next: null }
      ]
    } as any;

    const journeyId = repo.createJourney(undefined, 'demo-journey', journeyPayload);
    const runId = repo.createRun(journeyId);

    const trigger = { requestId: 'demo-req-1', patientId: 'demo-p1', context: { score: 75 } };
    repo.appendRunStep(runId, null, 'triggered', { requestId: trigger.requestId, patientId: trigger.patientId, context: trigger.context });

    // Print the inputs so a reviewer can copy/paste them
    // (console.log is intentionally used so output appears in test logs)
    console.log('\n=== DEMO: Journey JSON ===');
    console.log(JSON.stringify(journeyPayload, null, 2));
    console.log('\n=== DEMO: Trigger Payload ===');
    console.log(JSON.stringify(trigger, null, 2));

    // Execute the run
    await (executor as any).processRun(runId, 50);

    // Fetch steps and print a concise summary
    const steps = repo.getRunSteps(runId);
    console.log('\n=== DEMO: Execution Steps Summary ===');
    steps.forEach((s: any, idx: number) => {
      const when = s.created_at || s.occurred_at || s.timestamp || '';
      console.log(`#${idx + 1} node=${s.node_id || '<none>'} type=${s.type} payload=${JSON.stringify(s.payload)} time=${when}`);
    });

    const run = repo.getRun(runId);
    console.log('\n=== DEMO: Run summary ===');
    console.log(`runId=${runId} state=${run.state} currentNodeId=${run.current_node_id || ''}`);

    // Basic assertion so the test passes while still printing output
    expect(steps.length).toBeGreaterThan(0);
  } finally {
    try { await tmp.cleanup(); } catch (e) { /* ignore */ }
    try { (executor as any).clearScheduledTimeouts && (executor as any).clearScheduledTimeouts(); } catch (e) { /* ignore */ }
  }
});
