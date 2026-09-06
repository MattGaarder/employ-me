// SQLite database schema definitions
export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS jobs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    source          TEXT    NOT NULL,
    source_job_id   TEXT    NOT NULL,
    title           TEXT    NOT NULL,
    company         TEXT    NOT NULL,
    location        TEXT,
    url             TEXT,
    description     TEXT,
    date_posted     TEXT,
    date_found      TEXT    NOT NULL,
    fit_score       INTEGER,
    fit_explanation     TEXT,
    cover_letter    TEXT,
    status          TEXT    NOT NULL DEFAULT 'DISCOVERED',
    application_status TEXT NOT NULL DEFAULT 'NOT_READY',
    application_url TEXT,
    notes           TEXT,
    created_at      TEXT    NOT NULL,
    updated_at      TEXT    NOT NULL,
    UNIQUE(source, source_job_id)
  );

  CREATE TABLE IF NOT EXISTS import_runs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    run_at         TEXT    NOT NULL,
    keywords       TEXT,
    location       TEXT,
    jobs_found     INTEGER,
    jobs_new       INTEGER,
    jobs_duplicate INTEGER,
    status         TEXT,
    error          TEXT
  );
`;
