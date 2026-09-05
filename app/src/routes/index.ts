// Express API router configuration
import { Router } from 'express';
import {
  listJobs,
  importJobsHandler,
} from '../jobs/jobs.controller';

const router = Router();

router.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'employ-me-api',
  });
});

router.get('/jobs', listJobs);

router.post('/jobs/import', importJobsHandler);

router.get('/runs', (_req, res) => {
  res.json({
    ok: true,
    runs: [],
  });
});

export default router;
