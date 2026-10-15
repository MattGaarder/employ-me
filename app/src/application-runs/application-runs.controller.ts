import { Request, Response } from 'express';

import {
  startApplicationRun,
  updateApplicationRunProgress,
  completeApplicationRun,
  cancelApplicationRun,
  failApplicationRun,
  findApplicationRunsByJobId,
  claimNextQueuedApplication,
  findJobByRunId,
} from './application-runs.repository';
import { updateNotionStatusBySourceJobId } from '../integrations/notion';
import { syncNotionApplicationStatuses } from '../services/notionsql-sync';

// ─── Start application run ───────────────────────────────────────────────────

export async function startApplicationRunHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const runId = Number(req.params.id);

  if (!Number.isInteger(runId)) {
    res.status(400).json({
      ok: false,
      error: 'Invalid application run ID',
    });
    return;
  }

  const startedAt = new Date().toISOString();

  const { browserUseVersion, llmModel } = req.body ?? {};

  startApplicationRun(
    runId,
    startedAt,
    typeof browserUseVersion === 'string' ? browserUseVersion : 'unknown',
    typeof llmModel === 'string' ? llmModel : 'unknown',
  );

  const job = findJobByRunId(runId);
  if (job?.sourceJobId) {
    await updateNotionStatusBySourceJobId(job.sourceJobId, 'RUNNING');
  }

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

export async function completeApplicationRunHandler(
  req: Request,
  res: Response,
): Promise<void> {
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

  const { durationSeconds, sourceJobId } = completeApplicationRun(
    runId,
    finishedAt,
    stepsCompleted,
    finalResult ?? null,
    logFile ?? null,
    historyFile ?? null,
  );

  if (sourceJobId) {
    await updateNotionStatusBySourceJobId(sourceJobId, 'COMPLETE');
  }

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


export async function failApplicationRunHandler(
  req: Request,
  res: Response,
): Promise<void> {
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
    stepsCompleted,
    finalResult,
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

  const { durationSeconds, sourceJobId } = failApplicationRun(
    runId,
    finishedAt,
    errorMessage,
    logFile ?? null,
    historyFile ?? null,
    Number.isInteger(stepsCompleted) ? stepsCompleted : null,
    typeof finalResult === 'string' ? finalResult : null,
  );

  if (sourceJobId) {
    await updateNotionStatusBySourceJobId(sourceJobId, 'FAILED');
  }

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

export async function cancelApplicationRunHandler(
  req: Request,
  res: Response,
): Promise<void> {
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
    const { durationSeconds, sourceJobId } = cancelApplicationRun(
      runId,
      finishedAt,
      logFile ?? null,
      historyFile ?? null,
    );

    if (sourceJobId) {
      await updateNotionStatusBySourceJobId(sourceJobId, 'CANCELLED');
    }

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

export async function claimNextQueuedApplicationHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  try {
    // 1. Synchronise Notion database to SQLite database before claiming
    try {
      await syncNotionApplicationStatuses();
    } catch (syncError) {
      console.warn(
        '[application-runs] Warning: Failed to sync Notion to SQLite prior to claim:',
        syncError,
      );
    }

    // 2. Claim next queued job from SQLite
    const result = claimNextQueuedApplication();

    if (!result.ok) {
      // 422 Unprocessable: the request is valid but the queue can't be served
      res.status(422).json({
        ok: false,
        reason: result.reason,
        error: result.message,
      });
      return;
    }

    if (result.job.sourceJobId) {
      await updateNotionStatusBySourceJobId(result.job.sourceJobId, 'RUNNING');
    }

    res.json({
      ok: true,
      runId: result.runId,
      jobId: result.job.id,
      job: result.job,
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