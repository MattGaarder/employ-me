// Pipeline type definitions

// ─── Job status lifecycle ───────────────────────────────────────────────────

export type JobStatus =
  | 'DISCOVERED'  // found in search, no description yet
  | 'FETCHED'     // full description retrieved
  | 'EVALUATED'      // fit score calculated (below review threshold)
  | 'REVIEW'      // scored, above threshold — awaiting human decision
  | 'APPROVED'    // human chose to apply
  | 'REJECTED'    // human said no
  | 'SKIPPED'     // auto-filtered (score too low)
  | 'EXPIRED'     // listing no longer available
  | 'FAILED';     // scraping or processing error

export const ALL_STATUSES: JobStatus[] = [
  'DISCOVERED', 'FETCHED', 'EVALUATED', 'REVIEW',
  'APPROVED', 'REJECTED', 'SKIPPED', 'EXPIRED', 'FAILED',
];

// ─── Application status ──────────────────────────────────────────────────────

export type ApplicationStatus =
  | 'NOT_READY'
  | 'RUNNING'
  | 'QUEUED';

export const ALL_APPLICATION_STATUSES: ApplicationStatus[] = [
  'NOT_READY',
  'RUNNING',
  'QUEUED',
];

export type ApplicationRunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETE'
  | 'ERROR'
  | 'TIMEOUT'
  | 'HUMAN_REQUIRED'
  | 'CANCELLED';

export const ALL_APPLICATION_RUN_STATUSES: ApplicationRunStatus[] = [
  'QUEUED',
  'RUNNING',
  'COMPLETE',
  'ERROR',
  'TIMEOUT',
  'HUMAN_REQUIRED',
  'CANCELLED',
];

// ─── Canonical Application Run object ───────────────────────────────────────

export interface ApplicationRun {
  id?: number;
  jobId: number;
  attemptNumber: number;

  startedAt: string | null;
  finishedAt: string | null;
  durationSeconds: number | null;

  status: ApplicationRunStatus;

  browserUseVersion: string | null;
  llmModel: string | null;

  currentStep: number | null;
  stepsCompleted: number | null;

  finalResult: string | null;
  errorMessage: string | null;

  logFile: string | null;
  historyFile: string | null;

  createdAt: string;
}

// ─── Canonical Job object ───────────────────────────────────────────────────

export interface Job {
  id?: number;
  source: string;
  sourceJobId: string;
  title: string;
  company: string;
  location: string | null;
  url: string | null;
  description: string | null;
  datePosted: string | null;
  dateFound: string;
  fitScore: number | null;
  fitExplanation: string | null;
  coverLetter: string | null;
  status: JobStatus;
  applicationStatus: ApplicationStatus;
  applicationUrl: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Import result ───────────────────────────────────────────────────────────

export interface ImportResult {
  runId: number;
  jobsFound: number;
  jobsNew: number;
  jobsDuplicate: number;
  detailsFetched?: number;
  sqliteInserted?: number;
  notionCreated?: number;
  failed?: number;
}
