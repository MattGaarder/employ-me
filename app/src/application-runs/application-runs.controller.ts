import { Request, Response } from 'express';

import {
  startApplicationRun,
  updateApplicationRunProgress,
  completeApplicationRun,
  cancelApplicationRun,
  failApplicationRun,
  findApplicationRunsByJobId,
  claimNextQueuedApplication,
} from './application-runs.repository';

// ─── Start application run ───────────────────────────────────────────────────

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

// ─── Update application run progress ─────────────────────────────────────────

export function updateApplicationRunProgressHandler(
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

  const { currentStep, stepsCompleted } = req.body;

  if (
    !Number.isInteger(currentStep) ||
    !Number.isInteger(stepsCompleted)
  ) {
    res.status(400).json({
      ok: false,
      error: 'currentStep and stepsCompleted must be integers',
    });
    return;
  }

  updateApplicationRunProgress(
    runId,
    currentStep,
    stepsCompleted,
  );

  res.json({
    ok: true,
    runId,
    status: 'RUNNING',
    currentStep,
    stepsCompleted,
  });
}

// ─── Complete application run ───────────────────────────────────────────────

export function completeApplicationRunHandler(
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

  const {
    stepsCompleted,
    finalResult,
    logFile,
    historyFile,
  } = req.body;

  if (!Number.isInteger(stepsCompleted)) {
    res.status(400).json({
      ok: false,
      error: 'stepsCompleted must be an integer',
    });
    return;
  }

  const finishedAt = new Date().toISOString();

  const durationSeconds = completeApplicationRun(
    runId,
    finishedAt,
    stepsCompleted,
    finalResult ?? null,
    logFile ?? null,
    historyFile ?? null,
  );

  res.json({
    ok: true,
    runId,
    status: 'COMPLETE',
    finishedAt,
    durationSeconds,
    stepsCompleted,
  });
}



// ─── Fail application run ───────────────────────────────────────────────────


export function failApplicationRunHandler(
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

  const {
    errorMessage,
    logFile,
    historyFile,
  } = req.body;

  if (
    typeof errorMessage !== 'string' ||
    errorMessage.trim() === ''
  ) {
    res.status(400).json({
      ok: false,
      error: 'errorMessage is required',
    });
    return;
  }

  const finishedAt = new Date().toISOString();

  const durationSeconds = failApplicationRun(
    runId,
    finishedAt,
    errorMessage,
    logFile ?? null,
    historyFile ?? null,
  );

  res.json({
    ok: true,
    runId,
    status: 'ERROR',
    finishedAt,
    durationSeconds,
    errorMessage,
  });
}

// ─── Cancel application run ─────────────────────────────────────────────────

export function cancelApplicationRunHandler(
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

  const {
    logFile,
    historyFile,
  } = req.body;

  const finishedAt = new Date().toISOString();

  try {
    const durationSeconds = cancelApplicationRun(
      runId,
      finishedAt,
      logFile ?? null,
      historyFile ?? null,
    );

    res.json({
      ok: true,
      runId,
      status: 'CANCELLED',
      finishedAt,
      durationSeconds,
    });
  } catch (error) {
    console.error(
      `[application-runs] Failed to cancel application run ${runId}:`,
      error,
    );

    res.status(500).json({
      ok: false,
      error: 'Failed to cancel application run',
    });
  }
}

// ─── Get application runs for a job ──────────────────────────────────────────

export function getApplicationRunsByJobIdHandler(
  req: Request,
  res: Response,
): void {
  const jobId = Number(req.params.jobId);

  if (!Number.isInteger(jobId)) {
    res.status(400).json({
      ok: false,
      error: 'Invalid job ID',
    });
    return;
  }

  const runs = findApplicationRunsByJobId(jobId);

  res.json({
    ok: true,
    jobId,
    runs,
  });
}

export function claimNextQueuedApplicationHandler(
  _req: Request,
  res: Response,
): void {
  try {
    const claimed = claimNextQueuedApplication();

    if (!claimed) {
      res.status(404).json({
        ok: false,
        error: 'No queued applications available',
      });
      return;
    }

    res.json({
      ok: true,
      runId: claimed.runId,
      jobId: claimed.job.id,
      job: claimed.job,
    });
  } catch (error) {
    console.error(
      '[application-runs] Failed to claim queued application:',
      error,
    );

    res.status(500).json({
      ok: false,
      error: 'Failed to claim queued application',
    });
  }
}