import Fastify from 'fastify';
import { startPoller, stopPoller } from './services/executor';

export function buildApp() {
  const app = Fastify({ logger: true });

  app.get('/health', async () => {
    return { status: 'ok' };
  });

  // Start background poller on app ready; stop it on close
  app.addHook('onReady', async () => {
    // poll every 5s, process up to 100 ready runs per interval
    startPoller(5000, 100);
  });
  app.addHook('onClose', async () => {
    stopPoller();
  });

  return app;
}

export default buildApp;
