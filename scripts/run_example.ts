import fs from 'fs';
import path from 'path';
import { initRepository, createJourney, createRun, appendRunStep, getRun, getRunSteps } from '../src/db/repo';
import { startRun } from '../src/services/executor';

function abs(p: string) {
  return path.resolve(process.cwd(), p);
}

async function main() {
  initRepository();

  const args = process.argv.slice(2);
  const argMap: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1];
      argMap[key] = val;
      i++;
    }
  }

  const journeyFile = argMap['journey'] ?? 'examples/journeys/example_journey.json';
  const triggerFile = argMap['trigger'] ?? 'examples/triggers/example_trigger_hip.json';

  const journeyJson = JSON.parse(fs.readFileSync(abs(journeyFile), 'utf8'));
  const journeyId = createJourney(undefined, journeyJson.name, journeyJson, journeyJson.metadata ?? null);
  console.log('created journey id=', journeyId);

  const triggerJson = JSON.parse(fs.readFileSync(abs(triggerFile), 'utf8'));
  const idempotencyKey = triggerJson.requestId ?? undefined;
  const runId = createRun(journeyId, triggerJson.patientId, idempotencyKey);
  console.log('created run id=', runId);

  appendRunStep(runId, null, 'triggered', { requestId: triggerJson.requestId, context: triggerJson.context ?? null });

  // start the run via executor
  startRun(runId);
  console.log('started run', runId);

  // poll run state and steps until completion or timeout
  const timeoutMs = 30_000;
  const start = Date.now();

  while (true) {
    const runRow: any = getRun(runId);
    const steps = getRunSteps(runId);
    console.log('state=', runRow?.state, 'steps=', steps.map((s: any) => `${s.id}:${s.type}:${s.node_id}`).join(', '));
    if (!runRow) {
      console.error('run disappeared');
      process.exitCode = 2;
      return;
    }
    if (runRow.state === 'completed' || runRow.state === 'failed') {
      console.log('final state=', runRow.state);
      console.log('run steps:');
      for (const s of steps) console.log(JSON.stringify(s));
      return;
    }
    if (Date.now() - start > timeoutMs) {
      console.error('timeout waiting for run to complete');
      console.log('latest run row:', runRow);
      console.log('latest steps:', JSON.stringify(steps, null, 2));
      process.exitCode = 3;
      return;
    }
    // small delay
    await new Promise((r) => setTimeout(r, 300));
  }
}

main().catch((err) => {
  console.error('error running example script', err);
  process.exit(1);
});
