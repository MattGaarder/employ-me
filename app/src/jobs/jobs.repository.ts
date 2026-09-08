// SQLite persistence layer

import { getDb } from '../db/database';
import { Job, ApplicationStatus } from '../types';

function now(): string {
  return new Date().toISOString();
}

function rowToJob(row: any): Job {
  return {
    id: row.id,
    source: row.source,
    sourceJobId: row.source_job_id,
    title: row.title,
    company: row.company,
    location: row.location ?? null,
    url: row.url ?? null,
    description: row.description ?? null,
    datePosted: row.date_posted ?? null,
    dateFound: row.date_found,
    fitScore: row.fit_score ?? null,
    fitExplanation: row.fit_explanation ?? null,
    coverLetter: row.cover_letter ?? null,

    applicationStatus: row.application_status,
    applicationUrl: row.application_url ?? null,
    notes: row.notes ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function existsBySourceJobId(source: string, sourceJobId: string): boolean {
  const row = getDb()
    .prepare('SELECT 1 FROM jobs WHERE source = ? AND source_job_id = ? LIMIT 1')
    .get(source, sourceJobId);
  return Boolean(row);
}

export function insertSqliteJob(job: Job): { inserted: boolean; id?: number } {
  const ts = now();
  console.log(`[sqlite] Inserting description: ${job.description?.length ?? 0} chars`);
  const result = getDb()
    .prepare(`
      INSERT OR IGNORE INTO jobs
        (source, source_job_id, title, company, location, url,
         description, date_posted, date_found, fit_score, fit_explanation,
         cover_letter, application_status, application_url, notes,
         created_at, updated_at)
      VALUES
        (@source, @source_job_id, @title, @company, @location, @url,
         @description, @date_posted, @date_found, @fit_score, @fit_explanation,
         @cover_letter, @application_status, @application_url, @notes,
         @created_at, @updated_at)
    `)
    .run({
      source: job.source,
      source_job_id: job.sourceJobId,
      title: job.title,
      company: job.company,
      location: job.location ?? null,
      url: job.url ?? null,
      description: job.description ?? null,
      date_posted: job.datePosted ?? null,
      date_found: job.dateFound || ts,
      fit_score: job.fitScore ?? null,
      fit_explanation: job.fitExplanation,
      cover_letter: job.coverLetter ?? null,
      application_status: job.applicationStatus,
      application_url: job.applicationUrl ?? null,
      notes: job.notes ?? null,
      created_at: job.createdAt || ts,
      updated_at: job.updatedAt || ts,
    });

  if (result.changes === 0) return { inserted: false };
  const id = Number(result.lastInsertRowid);
  job.id = id;
  return { inserted: true, id };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export function findById(id: number): Job | undefined {
  const row = getDb()
    .prepare('SELECT * FROM jobs WHERE id = ?')
    .get(id);
  return row ? rowToJob(row) : undefined;
}

export function findBySourceJobId(
  source: string,
  sourceJobId: string,
): Job | undefined {
  const row = getDb()
    .prepare(
      'SELECT * FROM jobs WHERE source = ? AND source_job_id = ? LIMIT 1'
    )
    .get(source, sourceJobId);

  return row ? rowToJob(row) : undefined;
}

export interface JobFilters {
  status?: string;
  minScore?: number;
  source?: string;
}

export function findAll(filters: JobFilters = {}): Job[] {
  const conditions: string[] = ['1=1'];
  const params: Record<string, unknown> = {};

  if (filters.minScore !== undefined) {
    conditions.push('fit_score >= @minScore');
    params.minScore = filters.minScore;
  }
  if (filters.source !== undefined) {
    conditions.push('source = @source');
    params.source = filters.source;
  }

  const sql = `
    SELECT * FROM jobs
    WHERE ${conditions.join(' AND ')}
    ORDER BY
      CASE WHEN fit_score IS NULL THEN 1 ELSE 0 END,
      fit_score DESC,
      date_found DESC
  `;
  const rows = getDb().prepare(sql).all(params);
  return rows.map(rowToJob);
}

// ─── Update ───────────────────────────────────────────────────────────────────

export function updateDescription(id: number, description: string): void {
  getDb()
    .prepare('UPDATE jobs SET description = ?, updated_at = ? WHERE id = ?')
    .run(description, now(), id);
}

export function updateScore(
  id: number,
  fitScore: number,
  fitExplanation: string,

): void {
  getDb()
    .prepare('UPDATE jobs SET fit_score = ?, fit_explanation = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(fitScore, fitExplanation, now(), id);
}


export function updateNotes(id: number, notes: string): void {
  getDb()
    .prepare('UPDATE jobs SET notes = ?, updated_at = ? WHERE id = ?')
    .run(notes, now(), id);
}

export function updateEvaluation(
  id: number,
  fitScore: number,
  fitExplanation: string,
  coverLetter: string,
): void {
  getDb()
    .prepare(`
      UPDATE jobs
      SET
        fit_score = ?,
        fit_explanation = ?,
        cover_letter = ?,
        status = ?,
        updated_at = ?
      WHERE id = ?
    `)
    .run(
      fitScore,
      fitExplanation,
      coverLetter,
      now(),
      id,
    );
}

export function updateApplicationStatus(
  id: number,
  applicationStatus: ApplicationStatus,
): void {
  getDb()
    .prepare(
      'UPDATE jobs SET application_status = ?, updated_at = ? WHERE id = ?'
    )
    .run(applicationStatus, now(), id);
}
