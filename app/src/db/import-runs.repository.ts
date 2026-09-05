// SQLite import runs repository
import { getDb } from './database';

export interface ImportRun {
  id: number;
  run_at: string;
  keywords: string | null;
  location: string | null;
  jobs_found: number | null;
  jobs_new: number | null;
  jobs_duplicate: number | null;
  status: string | null;
  error: string | null;
}

type NewImportRun = Omit<ImportRun, 'id'>;

export function insertRun(run: NewImportRun): number {
  const result = getDb()
    .prepare(`
      INSERT INTO import_runs
        (run_at, keywords, location, jobs_found, jobs_new, jobs_duplicate, status, error)
      VALUES
        (@run_at, @keywords, @location, @jobs_found, @jobs_new, @jobs_duplicate, @status, @error)
    `)
    .run(run);
  return Number(result.lastInsertRowid);
}

export function findAll(): ImportRun[] {
  return getDb()
    .prepare('SELECT * FROM import_runs ORDER BY run_at DESC')
    .all() as ImportRun[];
}

export function findById(id: number): ImportRun | undefined {
  return getDb()
    .prepare('SELECT * FROM import_runs WHERE id = ?')
    .get(id) as ImportRun | undefined;
}
