import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import repo from '../db/repo';
import { startRun } from '../services/executor';
import { JourneySchema } from '../types/journey';

const JourneyCreateSchema = JourneySchema.pick({ name: true, nodes: true }).merge(
  z.object({ startNodeId: z.string().optional(), metadata: z.record(z.any()).optional() })
);

const JourneysRoutes: FastifyPluginAsync = async (app) => {
  app.post('/journeys', async (request, reply) => {
    const parsed = JourneyCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_payload', details: parsed.error.format() });
    }

    const id = repo.createJourney(undefined, parsed.data.name, parsed.data, parsed.data.metadata);
    return reply.status(201).send({ id });
  });

  app.post('/journeys/:journeyId/trigger', async (request, reply) => {
    const paramsSchema = z.object({ journeyId: z.string() });
    const bodySchema = z.object({ requestId: z.string().optional(), patientId: z.string().optional(), context: z.record(z.any()).optional() });

    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'invalid_params' });
    const body = bodySchema.safeParse(request.body || {});
    if (!body.success) return reply.status(400).send({ error: 'invalid_body' });

    const journey = repo.getJourney(params.data.journeyId);
    if (!journey) return reply.status(404).send({ error: 'not_found' });

  // determine idempotency key: prefer header 'idempotency-key', fallback to requestId in body
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
    reply.header('Location', `/journeys/runs/${runId}`);
    return reply.status(202).send({ runId });
  });

  // Explicit start endpoint for manual starts: POST /journeys/runs/:runId/start
  app.post('/journeys/runs/:runId/start', async (request, reply) => {
    const paramsSchema = z.object({ runId: z.string() });
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'invalid_params' });

    const run = repo.getRun(params.data.runId);
    if (!run) return reply.status(404).send({ error: 'not_found' });

    startRun(params.data.runId);
    reply.header('Location', `/journeys/runs/${params.data.runId}`);
    return reply.status(202).send({ runId: params.data.runId });
  });

  app.get('/journeys/runs/:runId', async (request, reply) => {
    const paramsSchema = z.object({ runId: z.string() });
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'invalid_params' });

    const run = repo.getRun(params.data.runId);
    if (!run) return reply.status(404).send({ error: 'not_found' });

    const steps = repo.getRunSteps(params.data.runId);
    return reply.send({ run, steps });
  });
};

export default JourneysRoutes;
