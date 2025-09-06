/**
 * src/services/executor.ts
 * Executor: drive a run through nodes (MESSAGE, DELAY, CONDITION).
 * Key invariants:
 *  - persist state on each step
 *  - respect waiting_delay and next_wake_at
 *  - claimRunForProcessing to avoid duplicate workers
 */

import repo from '../db/repo';
import { Journey, Node, PatientContext } from '../types/journey';

// 1. Guardrails & knobs
const DEFAULT_MAX_STEPS = 1000;

// registry for scheduled timeouts so tests can cancel them and avoid callbacks running after teardown
const scheduledTimeouts: NodeJS.Timeout[] = [];

function nowIso() {
  return new Date().toISOString();
}

// Control verbose executor logging via NOISY_MAX_STEPS env var.
const EXECUTOR_VERBOSE = !!process.env.NOISY_MAX_STEPS;
function execLog(...args: any[]) {
  if (EXECUTOR_VERBOSE) console.log(...args);
}
function execWarn(...args: any[]) {
  if (EXECUTOR_VERBOSE) console.warn(...args);
}

function evalCondition(left: any, operator: string, right: any) {
  switch (operator) {
    case '==':
      return left == right;
    case '!=':
      return left != right;
    case '>':
      return left > right;
    case '>=':
      return left >= right;
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    default:
      return false;
  }
}

async function processRun(runId: string, maxSteps = DEFAULT_MAX_STEPS) {
  execLog(`[executor] processRun start runId=${runId}`);
  const run: any = repo.getRun(runId);
  if (!run) {
    console.error(`[executor] run not found ${runId}`);
    return;
  }

  execLog('[executor] runRow', {
    runId,
    state: run.state,
    currentNodeId: run.current_node_id,
    nextWakeAt: run.next_wake_at,
  });

  // 2. Preflight

  // If run is waiting for a wake time that is in the future, skip processing
  // WHY: If next_wake_at is in the future, do not process yet (idempotent resume later).
  if (run.state === 'waiting_delay' && run.next_wake_at) {
    const nextWake = Date.parse(run.next_wake_at);
    if (nextWake > Date.now()) {
      execLog(
        `[executor] run ${runId} waiting until ${run.next_wake_at} (now=${new Date(Date.now()).toISOString()})`
      );
      return;
    }
  }

  // attempt to atomically claim the run for processing, so two workers can't process it at once
  const claimed = repo.claimRunForProcessing(runId, nowIso());
  if (!claimed) {
    // Fetch current DB state for debugging
    const cur = repo.getRun(runId);
    execLog(
      `[executor] run ${runId} not claimable (another worker may be processing) - dbState=${cur?.state} next_wake_at=${cur?.next_wake_at}`
    );
    return;
  }

  // Load journey definition (repo returns a row with parsed payload)
  const journeyRow: any = repo.getJourney(run.journey_id);
  if (!journeyRow) {
    repo.updateRunState(runId, 'failed', { error: 'journey_not_found' });
    repo.appendRunStep(runId, null, 'error', { message: 'journey not found' });
    return;
  }

  const payload = journeyRow?.payload as any;
  const nodes = Array.isArray(payload?.nodes) ? payload.nodes : [];
  const nodeSummary =
    nodes.map((n: any) => `${String(n?.id)}:${String(n?.type)}`).join(',') || 'none';

  execLog('[executor] journey', {
    journeyId: journeyRow?.id,
    startNodeId: payload?.startNodeId ?? null,
    nodeCount: nodes.length,
    nodes: nodeSummary,
  });

  // journey payload must be valid 
  const journey: Journey = journeyRow.payload as Journey;

  // Obtain patient context from initial trigger step if present
  const steps = repo.getRunSteps(runId);
  const triggered = steps.find((s: any) => s.type === 'triggered');
  const patientContext: PatientContext =
    triggered && triggered.payload && triggered.payload.context ? triggered.payload.context : ({} as any);

  // Determine starting node
  let currentNodeId =
    run.current_node_id ?? journey.startNodeId ?? (journey.nodes && journey.nodes[0] && journey.nodes[0].id) ?? null;

  // 3. Main loop: process nodes until end, waiting, or max steps reached
  let stepCount = 0;
  while (currentNodeId && stepCount < maxSteps) {
    stepCount += 1;
    const node = (journey.nodes || []).find((n) => n.id === currentNodeId) as Node | undefined;
    if (!node) {
      repo.updateRunState(runId, 'failed', { error: `node_not_found:${currentNodeId}` });
      repo.appendRunStep(runId, currentNodeId, 'error', { message: 'node not found' });
      console.error(`[executor] node not found ${currentNodeId} for run ${runId}`);
      return;
    }

    execLog(`[executor] run=${runId} node=${node.id} type=${(node as any).type}`);
    const ntype = (node as any).type;

    // MESSAGE: stub side-effect (console.log), then advance to next node.
    if (ntype === 'MESSAGE') {
      // mark started
      repo.appendRunStep(runId, node.id, 'started', {});
      // persist current node
      repo.updateRunState(runId, 'in_progress', { current_node_id: node.id });
      // log sending
      const message = (node as any).message ?? '';
      execLog(`[executor] Sending message for run ${runId}, node ${node.id}: ${message}`);
      repo.appendRunStep(runId, node.id, 'message_sent', { message });
      // move to next
      currentNodeId = (node as any).next ?? null;
      repo.updateRunState(runId, 'in_progress', { current_node_id: currentNodeId });
      continue;
    }

    // DELAY: persist next_wake_at and set state=waiting_delay, then schedule resume.
    if (ntype === 'DELAY') {
      const delaySeconds = (node as any).delaySeconds ?? (node as any).delay ?? 0;

      // If the run's next_wake_at is set and in the past (<= now), treat the DELAY as completed
      // and move on to the next node. Do this regardless of the current in-memory state because
      // claimRunForProcessing may have already flipped state to 'in_progress'.
      const currentRunRow: any = repo.getRun(runId);
      if (currentRunRow && currentRunRow.next_wake_at) {
        const nextWakeTs = Date.parse(currentRunRow.next_wake_at);
        if (!isNaN(nextWakeTs) && nextWakeTs <= Date.now()) {
          // delay completed, note it and continue to the next node
          repo.appendRunStep(runId, node.id, 'delay_resumed', { delaySeconds, resumedAt: new Date().toISOString() });
          const nextNode = (node as any).next ?? null;
          repo.updateRunState(runId, 'in_progress', { current_node_id: nextNode, next_wake_at: null });
          currentNodeId = nextNode;
          continue;
        }
      }

      // mark started
      repo.appendRunStep(runId, node.id, 'started', {});
      // persist waiting state and next wake
      const nextWake = new Date(Date.now() + Number(delaySeconds) * 1000).toISOString();
      repo.updateRunState(runId, 'waiting_delay', { next_wake_at: nextWake, current_node_id: node.id });
      repo.appendRunStep(runId, node.id, 'delay_set', { delaySeconds, nextWake });

      // schedule resume
      const ms = Math.max(0, Number(delaySeconds) * 1000);
      execLog(
        `[executor] Scheduling resume for run ${runId} node ${node.id} nextWake=${nextWake} delaySeconds=${delaySeconds} ms=${ms}`
      );

      const t = setTimeout(() => {
        // remove from registry immediately so cleanup doesn't try to clear it again
        const idx = scheduledTimeouts.findIndex((h) => h === t);
        if (idx !== -1) scheduledTimeouts.splice(idx, 1);

        // when timeout fires, log and inspect DB then resume processing
        try {
          const now = new Date().toISOString();
          const r = repo.getRun(runId);
          execLog(
            `[executor] timeout fired for run ${runId} at ${now} dbState=${r?.state} next_wake_at=${r?.next_wake_at}`
          );
        } catch (e) {
          console.error('[executor] error reading run on timeout', e);
        }

        processRun(runId).catch((err) => console.error('[executor] resume error', err));
      }, ms);
      scheduledTimeouts.push(t as any);

      // allow process to exit if only these timers remain
      (t as any).unref?.();

      return; // stop processing now
    }

    // CONDITION: evaluate (leftKey operator rightValue) from patient context; branch true/false.
    if (ntype === 'CONDITION' || ntype === 'CONDITIONAL') {
      const cond = (node as any).condition;
      const leftKey = cond?.leftKey ?? cond?.field;
      const operator = cond?.operator;
      const rightValue = cond?.rightValue ?? cond?.value;
      const leftVal = leftKey ? (patientContext as any)[leftKey] : undefined;
      const result = evalCondition(leftVal, operator, rightValue);

      // mark started
      repo.appendRunStep(runId, node.id, 'started', {});
      repo.updateRunState(runId, 'in_progress', { current_node_id: node.id });
      repo.appendRunStep(runId, node.id, 'condition_evaluated', { leftKey, leftVal, operator, rightValue, result });
      currentNodeId = result
        ? (node as any).trueNext ?? (node as any).on_true_next_node_id
        : (node as any).falseNext ?? (node as any).on_false_next_node_id;
      repo.updateRunState(runId, 'in_progress', { current_node_id: currentNodeId });
      continue;
    }

    // FAIL
    // unknown node type
    repo.appendRunStep(runId, node.id, 'error', { message: `unknown_node_type:${ntype}` });
    repo.updateRunState(runId, 'failed', { error: `unknown_node_type:${ntype}` });
    console.error(`[executor] unknown node type ${ntype} for run ${runId}`);
    return;
  }

  // SAFETY: Hard stop to prevent infinite loops due to cycles or bad next pointers.
  if (stepCount >= maxSteps) {
    repo.updateRunState(runId, 'failed', { error: 'max_steps_exceeded' });
    repo.appendRunStep(runId, null, 'error', { message: 'max steps exceeded' });
    execWarn(`[executor] max steps exceeded for run ${runId}`);
    return;
  }

  // finished
  repo.updateRunState(runId, 'completed', { completed_at: nowIso(), current_node_id: null });
  repo.appendRunStep(runId, null, 'completed', {});
  execLog(`[executor] run ${runId} completed`);
}

export async function startRun(runId: string) {
  // fire-and-forget processing
  processRun(runId).catch((err) => console.error('[executor] startRun error', err));
}

export function clearScheduledTimeouts() {
  for (const t of scheduledTimeouts) {
    if (t) clearTimeout(t);
  }
  scheduledTimeouts.length = 0; // fast clear
}

export default { startRun, processRun, clearScheduledTimeouts };
