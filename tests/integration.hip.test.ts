import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import * as repo from '../src/db/repo';
import executor from '../src/services/executor';

jest.setTimeout(20000);

let dbFile: string;

beforeAll(() => {
  dbFile = path.join(os.tmpdir(), `revelai-int-${uuidv4()}.sqlite`);
  // initialize repository with a fresh sqlite file for isolation
  repo.initRepository(dbFile);
});

afterAll(() => {
  try { executor.clearScheduledTimeouts && executor.clearScheduledTimeouts(); } catch (e) { /* ignore */ }
  try { if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile); } catch (e) { /* ignore */ }
});

afterEach(() => {
  try { jest.useRealTimers(); } catch (e) { /* ignore */ }
  try { jest.clearAllTimers(); } catch (e) { /* ignore */ }
  try { executor.clearScheduledTimeouts && executor.clearScheduledTimeouts(); } catch (e) { /* ignore */ }
});

test('integration: hip trigger follows expected branch and sends HOOS', async () => {
  const journeyPath = path.resolve(process.cwd(), 'examples', 'journeys', 'example_journey.json');
  const triggerPath = path.resolve(process.cwd(), 'examples', 'triggers', 'example_trigger_hip.json');

  const journeyJson = JSON.parse(fs.readFileSync(journeyPath, 'utf8'));
  const triggerJson = JSON.parse(fs.readFileSync(triggerPath, 'utf8'));

  const journeyId = repo.createJourney(undefined, journeyJson.name, journeyJson, journeyJson.metadata ?? null);
  expect(journeyId).toBeTruthy();

  const runId = repo.createRun(journeyId, triggerJson.patientId, triggerJson.requestId);
  expect(runId).toBeTruthy();

  repo.appendRunStep(runId, null, 'triggered', { requestId: triggerJson.requestId, context: triggerJson.context ?? null });

  // start run
  executor.startRun(runId);

  // wait for completion with a timeout
  const start = Date.now();
  const timeoutMs = 10000;
  let finalRun: any = null;
  while (Date.now() - start < timeoutMs) {
    const r = repo.getRun(runId);
    if (r && (r.state === 'completed' || r.state === 'failed')) {
      finalRun = r;
      break;
    }
    // small sleep
    // eslint-disable-next-line no-await-in-loop
    await new Promise((res) => setTimeout(res, 200));
  }

  expect(finalRun).not.toBeNull();
  expect(finalRun.state).toBe('completed');

  const steps = repo.getRunSteps(runId);
  // condition should have evaluated to the hip branch and the HOOS message should have been sent
  const hasCondition = steps.some((s: any) => s.type === 'condition_evaluated' && s.payload && typeof s.payload.result === 'boolean');
  const hasHoos = steps.some((s: any) => s.type === 'message_sent' && s.payload && typeof s.payload.message === 'string' && s.payload.message.includes('HOOS'));

  expect(hasCondition).toBe(true);
  expect(hasHoos).toBe(true);
  // Ensure we didn't accidentally send the knee survey (KOOS) for a hip trigger
  const hasKoos = steps.some((s: any) => s.type === 'message_sent' && s.payload && typeof s.payload.message === 'string' && s.payload.message.includes('KOOS'));
  expect(hasKoos).toBe(false);
});
