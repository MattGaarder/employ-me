import { getDb } from '../db/database';
import { ApplicationRunStatus, ApplicationRun } from '../types';

function now(): string {
  return new Date().toISOString();
}

function rowToApplicationRun(row: any): ApplicationRun {
  return {
    id: row.id,
    jobId: row.job_id,
    attemptNumber: row.attempt_number,

    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null,
    durationSeconds: row.duration_seconds ?? null,

    status: row.status as ApplicationRunStatus,

    browserUseVersion: row.browser_use_version ?? null,
    llmModel: row.llm_model ?? null,

    currentStep: row.current_step ?? null,
    stepsCompleted: row.steps_completed ?? null,

    finalResult: row.final_result ?? null,
    errorMessage: row.error_message ?? null,

    logFile: row.log_file ?? null,
    historyFile: row.history_file ?? null,

    createdAt: row.created_at,
  };
}

export function createApplicationRun(
  jobId: number,
  attemptNumber: number,
): ApplicationRun {
  const createdAt = now();

  const result = getDb()
    .prepare(`
      INSERT INTO application_runs (
        job_id,
        attempt_number,
        status,
        created_at
      )
      VALUES (?, ?, ?, ?)
    `)
    .run(
      jobId,
      attemptNumber,
      'QUEUED',
      createdAt,
    );

  return {
    id: Number(result.lastInsertRowid),
    jobId,
    attemptNumber,

    startedAt: null,
    finishedAt: null,
    durationSeconds: null,

    status: 'QUEUED',

    browserUseVersion: null,
    llmModel: null,

    currentStep: null,
    stepsCompleted: null,

    finalResult: null,
    errorMessage: null,

    logFile: null,
    historyFile: null,

    createdAt,
  };
}

export function startApplicationRun(
  id: number,
  startedAt: string,
  browserUseVersion: string | null,
  llmModel: string | null,
): void {
  getDb()
    .prepare(`
      UPDATE application_runs
      SET
        status = ?,
        started_at = ?,
        browser_use_version = ?,
        llm_model = ?
      WHERE id = ?
    `)
    .run(
      'RUNNING',
      startedAt,
      browserUseVersion,
      llmModel,
      id,
    );
}

export function updateApplicationRunProgress(
  id: number,
  currentStep: number,
  stepsCompleted: number,
): void {
  getDb()
    .prepare(`
      UPDATE application_runs
      SET
        current_step = ?,
        steps_completed = ?
      WHERE id = ?
    `)
    .run(
      currentStep,
      stepsCompleted,
      id,
    );
}

export function completeApplicationRun(
  id: number,
  finishedAt: string,
  durationSeconds: number,
  stepsCompleted: number,
  finalResult: string | null,
  logFile: string | null,
  historyFile: string | null,
): void {
  getDb()
    .prepare(`
      UPDATE application_runs
      SET
        status = ?,
        finished_at = ?,
        duration_seconds = ?,
        steps_completed = ?,
        final_result = ?,
        log_file = ?,
        history_file = ?
      WHERE id = ?
    `)
    .run(
      'COMPLETE',
      finishedAt,
      durationSeconds,
      stepsCompleted,
      finalResult,
      logFile,
      historyFile,
      id,
    );
}

export function failApplicationRun(
  id: number,
  finishedAt: string,
  durationSeconds: number,
  errorMessage: string,
  logFile: string | null,
  historyFile: string | null,
): void {
  getDb()
    .prepare(`
      UPDATE application_runs
      SET
        status = ?,
        finished_at = ?,
        duration_seconds = ?,
        error_message = ?,
        log_file = ?,
        history_file = ?
      WHERE id = ?
    `)
    .run(
      'ERROR',
      finishedAt,
      durationSeconds,
      errorMessage,
      logFile,
      historyFile,
      id,
    );
}

export function findApplicationRunsByJobId(
  jobId: number,
): ApplicationRun[] {
  const rows = getDb()
    .prepare(`
      SELECT *
      FROM application_runs
      WHERE job_id = ?
      ORDER BY attempt_number ASC
    `)
    .all(jobId);

  return rows.map(rowToApplicationRun);
}

export function getNextApplicationAttemptNumber(
  jobId: number,
): number {
  const row = getDb()
    .prepare(`
      SELECT MAX(attempt_number) AS max_attempt
      FROM application_runs
      WHERE job_id = ?
    `)
    .get(jobId) as { max_attempt: number | null };

  return (row.max_attempt ?? 0) + 1;
}