import buildApp from './app';
import { initRepository } from './db/repo';
import journeysRoutes from './routes/journeys';

// Initialize DB and run schema before starting the server
initRepository();

const app = buildApp();

// Register routes
app.register(journeysRoutes);

const PORT = Number(process.env.PORT) || 3000;

app.listen({ port: PORT, host: '0.0.0.0' }).then(() => {
  app.log.info(`Server listening on port ${PORT}`);
}).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
