import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import repo from '../db/repo';
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

    const runId = repo.createRun(params.data.journeyId, body.data.patientId);
    // append initial step
    repo.appendRunStep(runId, null, 'triggered', { requestId: body.data.requestId, context: body.data.context ?? null });

    return reply.status(202).send({ runId });
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
