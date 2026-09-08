// Express API router configuration
import { Router } from 'express';

import {
  listJobs,
  importJobsHandler,
} from '../jobs/jobs.controller';

import {
  startApplicationRunHandler,
  updateApplicationRunProgressHandler,
  completeApplicationRunHandler,
  cancelApplicationRunHandler,
  failApplicationRunHandler,
  getApplicationRunsByJobIdHandler,
  claimNextQueuedApplicationHandler,
} from '../application-runs/application-runs.controller';

const router = Router();

// ─── API health ──────────────────────────────────────────────────────────────

router.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'employ-me-api',
  });
});

// ─── Jobs ────────────────────────────────────────────────────────────────────

router.get('/jobs', listJobs);

router.post('/jobs/import', importJobsHandler);

// ─── Legacy / placeholder runs endpoint ──────────────────────────────────────

router.get('/runs', (_req, res) => {
  res.json({
    ok: true,
    runs: [],
  });
});

// ─── Application runs ────────────────────────────────────────────────────────

router.post(
  '/application-runs/claim',
  claimNextQueuedApplicationHandler,
);

// Start an application run
router.post(
  '/application-runs/:id/start',
  startApplicationRunHandler,
);

// Update Browser Use progress
router.patch(
  '/application-runs/:id/progress',
  updateApplicationRunProgressHandler,
);

// Mark an application run as successfully completed
router.post(
  '/application-runs/:id/complete',
  completeApplicationRunHandler,
);

router.post('/application-runs/:id/cancel', cancelApplicationRunHandler);

// Mark an application run as failed
router.post(
  '/application-runs/:id/fail',
  failApplicationRunHandler,
);

// Get all application runs belonging to a job
router.get(
  '/jobs/:jobId/application-runs',
  getApplicationRunsByJobIdHandler,
);



export default router;
