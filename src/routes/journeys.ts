/**
 * src/routes/journeys.ts (API Exposed Endpoints)
 * - Endpoints: POST /journeys, POST /journeys/:journeyId/trigger
 * - Endpoints: GET /journeys/runs/:runId/start (explicit, optional manual start).
 * - Endpoints: GET /journeys/runs/:runId (monitoring)
 * - Validation: Zod at the edge; return 400/404 on invalid/not-found.
 * - Idempotency: header 'idempotency-key' or body.requestId reuses an existing run.
 * - Auto-start: can be disabled with ?start=false or x-run-auto-start=false.
 * - Response: Location header points to run monitoring endpoint.
 */

import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import repo from '../db/repo';
import { startRun } from '../services/executor';
import { JourneySchema } from '../types/journey';

// give us a Journey schema with only the name and nodes values, and merge it with the startNodeId and metadata fields
const JourneyCreateSchema = JourneySchema.pick({ name: true, nodes: true }).merge(
  z.object({ startNodeId: z.string().optional(), metadata: z.record(z.any()).optional() })
);

const JourneysRoutes: FastifyPluginAsync = async (app) => {
  // ROUTE: create journey definition
  app.post('/journeys', async (request, reply) => {
    const parsed = JourneyCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_payload', details: parsed.error.format() });
    }
    // Validated payload, create the journey
    const id = repo.createJourney(undefined, parsed.data.name, parsed.data, parsed.data.metadata);
    // send back the created journey ID
    return reply.status(201).send({ id });
  });

  // ROUTE: trigger a run (auto-start unless disabled)
  app.post('/journeys/:journeyId/trigger', async (request, reply) => {
    const paramsSchema = z.object({ journeyId: z.string() }); // Schema to validate journeyId param
    // schema to validate optional fields in body: requestId, patientId, and context
    const bodySchema = z.object({ requestId: z.string().optional(), patientId: z.string().optional(), context: z.record(z.any()).optional() });

    const params = paramsSchema.safeParse(request.params); // validate journeyId against paramsSchema
    if (!params.success) return reply.status(400).send({ error: 'invalid_params' }); // must have a valid journeyId
    const body = bodySchema.safeParse(request.body || {}); // validate body against bodySchema.
    if (!body.success) return reply.status(400).send({ error: 'invalid_body' }); // ok if empty{} but must not be malformed.

    // Validated payload, trigger the journey
    const journey = repo.getJourney(params.data.journeyId);
    if (!journey) return reply.status(404).send({ error: 'not_found' }); // must be able to locate the journey record from journeyId

    // Trying to make sure we guard against duplicates, etc.
    // Determine idempotency key: prefer header 'idempotency-key', fallback to requestId in body
    // NOTE: Idempotency - prefer header, fallback to body.requestId
    const idempotencyKey = (request.headers['idempotency-key'] as string | undefined) ?? body.data.requestId;
    const runId = repo.createRun(params.data.journeyId, body.data.patientId, idempotencyKey);
    // append initial step
    repo.appendRunStep(runId, null, 'triggered', { requestId: body.data.requestId, context: body.data.context ?? null });
    // Auto-start unless explicitly disabled via query param or header
    const qs = request.query as any;
    const autoStartQuery = qs && (qs.start === undefined ? true : String(qs.start) !== 'false');
    const autoStartHeader = (request.headers['x-run-auto-start'] as string | undefined) !== 'false';
    const shouldAutoStart = autoStartQuery && autoStartHeader;
    if (shouldAutoStart) {
      startRun(runId);
    }

    // Include relative Location header pointing to the monitoring endpoint for the run
    // DX: Provide Location for clients to poll status
    reply.header('Location', `/journeys/runs/${runId}`);
    return reply.status(202).send({ runId });
  });

  // Explicit start endpoint for manual starts for queued runs: POST /journeys/runs/:runId/start
  app.post('/journeys/runs/:runId/start', async (request, reply) => {
    const paramsSchema = z.object({ runId: z.string() }); // setup schema to pull runId from params
    const params = paramsSchema.safeParse(request.params); // parse param runId
    if (!params.success) return reply.status(400).send({ error: 'invalid_params' }); // must have valid runId

    // validated param runId, but are we able to find it in data and fetch the record?
    const run = repo.getRun(params.data.runId);
    if (!run) return reply.status(404).send({ error: 'not_found' }); // unable to fetch

    // Able to find record match so start the run
    startRun(params.data.runId);
    // DX: Provide Location for clients to poll status
    reply.header('Location', `/journeys/runs/${params.data.runId}`);
    return reply.status(202).send({ runId: params.data.runId });
  });

  // ROUTE: poll run status + steps (monitoring)
  app.get('/journeys/runs/:runId', async (request, reply) => {
    const paramsSchema = z.object({ runId: z.string() }); // setup schema to pull runId from params
    const params = paramsSchema.safeParse(request.params); // parse param runId
    if (!params.success) return reply.status(400).send({ error: 'invalid_params' }); // must have valid runId

    const run = repo.getRun(params.data.runId); // fetch run record
    if (!run) return reply.status(404).send({ error: 'not_found' }); // unable to fetch

    const steps = repo.getRunSteps(params.data.runId); // able to fetch run steps
    return reply.send({ run, steps });
  });
};

export default JourneysRoutes;
