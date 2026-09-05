// HTTP controller for jobs endpoints

import { Request, Response } from 'express';
import { findAll } from './jobs.repository';
import { importJobs } from './jobs.service';

export function listJobs(req: Request, res: Response): void {
  try {
    const jobs = findAll({
      status: typeof req.query.status === 'string'
        ? req.query.status
        : undefined,
      source: typeof req.query.source === 'string'
        ? req.query.source
        : undefined,
      minScore: typeof req.query.minScore === 'string'
        ? Number(req.query.minScore)
        : undefined,
    });

    res.json({
      ok: true,
      jobs,
    });
  } catch (error) {
    console.error('[jobs] Failed to list jobs:', error);

    res.status(500).json({
      ok: false,
      error: 'Failed to retrieve jobs',
    });
  }
}

export async function importJobsHandler(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const result = await importJobs({
      keywords: typeof req.body?.keywords === 'string'
        ? req.body.keywords
        : undefined,
      location: typeof req.body?.location === 'string'
        ? req.body.location
        : undefined,
      dateSincePosted:
        typeof req.body?.dateSincePosted === 'string'
          ? req.body.dateSincePosted
          : undefined,
    });

    res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error('[jobs] Import request failed:', error);

    res.status(502).json({
      ok: false,
      error: 'LinkedIn job import failed',
      details: error instanceof Error
        ? error.message
        : String(error),
    });
  }
}
