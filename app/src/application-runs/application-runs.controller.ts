import { Request, Response } from 'express';
import {
  startApplicationRun,
} from '../application-runs/application-runs.repository';

export function startApplicationRunHandler(
  req: Request,
  res: Response,
): void {
  const runId = Number(req.params.id);

  if (!Number.isInteger(runId)) {
    res.status(400).json({
      ok: false,
      error: 'Invalid application run ID',
    });
    return;
  }

  const startedAt = new Date().toISOString();

  startApplicationRun(
    runId,
    startedAt,
    '0.13.8',
    'qwen3.5:latest',
  );

  res.json({
    ok: true,
    runId,
    status: 'RUNNING',
  });
}