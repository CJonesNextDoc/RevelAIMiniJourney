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
  let lastState: string | null = null;
  const outFile = argMap['out'] ?? null;
  const quiet = argMap['quiet'] === '1' || argMap['quiet'] === 'true';
  const pretty = argMap['pretty'] === '1' || argMap['pretty'] === 'true';
  if (outFile) {
    try { console.log('demo will write output to', abs(outFile)); } catch (e) { /* ignore */ }
  }

  while (true) {
    const runRow: any = getRun(runId);
    const steps = getRunSteps(runId);
    // Only print periodic state when it changes to reduce noise
    if (!quiet && runRow?.state !== lastState) {
      lastState = runRow?.state;
      console.log('state=', runRow?.state, 'steps=', steps.map((s: any) => `${s.id}:${s.type}:${s.node_id}`).join(', '));
      // If the run just entered waiting_delay and an outFile was requested,
      // write a partial JSON + pretty summary so the user has an artifact to inspect.
      if (outFile && runRow?.state === 'waiting_delay') {
        try {
          const outPath = abs(outFile);
          fs.writeFileSync(outPath, JSON.stringify({ run: runRow, steps }, null, 2), 'utf8');
          console.log('wrote interim run and steps to', outFile);
          const wantPretty = pretty || outFile.toLowerCase().endsWith('.txt');
          if (wantPretty) {
            const lines: string[] = [];
            const green = (s: string) => `\u001b[32m${s}\u001b[0m`;
            const cyan = (s: string) => `\u001b[36m${s}\u001b[0m`;
            lines.push('Interim run summary (waiting_delay)');
            lines.push(`runId: ${runRow.id}`);
            lines.push(`state: ${runRow.state}`);
            lines.push('');
            lines.push('Steps:');
            for (const s of steps) {
              const node = s.node_id || '<none>';
              const payload = JSON.stringify(s.payload || {});
              lines.push(`${green('#' + s.id)} ${cyan(node)} ${s.type} ${payload}`);
            }
            try {
              const prettyPath = outPath + '.txt';
              fs.writeFileSync(prettyPath, lines.join('\n'), 'utf8');
              console.log('wrote interim pretty summary to', prettyPath);
            } catch (e) {
              console.error('failed to write interim pretty summary', e);
            }
          }
        } catch (e) {
          console.error('failed to write interim out file', outFile, e);
        }
      }
    }
    if (!runRow) {
      console.error('run disappeared');
      process.exitCode = 2;
      return;
    }
    if (runRow.state === 'completed' || runRow.state === 'failed') {
      console.log('final state=', runRow.state);
      console.log('run steps:');
      for (const s of steps) console.log(JSON.stringify(s));
      // optionally write final steps to a file for later inspection
      if (outFile) {
        try {
          const outPath = abs(outFile);
          fs.writeFileSync(outPath, JSON.stringify({ run: runRow, steps }, null, 2), 'utf8');
          console.log('wrote final run and steps to', outFile);

          // If pretty requested or output is .txt, also write a human-friendly text summary
          const wantPretty = pretty || outFile.toLowerCase().endsWith('.txt');
          if (wantPretty) {
            const lines: string[] = [];
            const green = (s: string) => `\u001b[32m${s}\u001b[0m`;
            const cyan = (s: string) => `\u001b[36m${s}\u001b[0m`;
            lines.push('Run summary');
            lines.push(`runId: ${runRow.id}`);
            lines.push(`state: ${runRow.state}`);
            lines.push('');
            lines.push('Steps:');
            for (const s of steps) {
              const node = s.node_id || '<none>';
              const t = s.type;
              const payload = JSON.stringify(s.payload || {});
              lines.push(`${green('#' + s.id)} ${cyan(node)} ${t} ${payload}`);
            }
            try {
              const prettyPath = outPath + '.txt';
              fs.writeFileSync(prettyPath, lines.join('\n'), 'utf8');
              console.log('wrote pretty summary to', prettyPath);
            } catch (e) {
              console.error('failed to write pretty summary', e);
            }
          }
        } catch (e) {
          console.error('failed to write out file', outFile, e);
        }
      }
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
