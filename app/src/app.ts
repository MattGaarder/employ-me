// Express application factory and middleware configuration
import express from 'express';
import cors from 'cors';
import { getDb } from './db/database';
import routes from './routes';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Initialise the database when the application starts.
  getDb();

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'employ-me',
    });
  });

  app.use('/api', routes);

  return app;
}
