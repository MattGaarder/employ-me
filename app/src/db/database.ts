// SQLite database connection provider
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { SCHEMA_SQL } from './schema';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.resolve(__dirname, '../../data/employ-me.db');

  // Ensure data directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(dbPath);

  // Performance pragmas appropriate for a single-user local app
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create tables if they don't exist (idempotent)
  db.exec(SCHEMA_SQL);

  // Lightweight migrations for columns added after initial DB creation

  // jobs.application_status
  const hasAppStatus = (db.prepare(
    `SELECT 1 FROM pragma_table_info('jobs') WHERE name = 'application_status'`
  ).get() as any);

  if (!hasAppStatus) {
    db.exec(`
      ALTER TABLE jobs
      ADD COLUMN application_status TEXT NOT NULL DEFAULT 'NOT_READY'
    `);

    console.log('[db] Added jobs.application_status column');
  }

  // application_runs columns
  const applicationRunColumns = db
    .prepare(`PRAGMA table_info(application_runs)`)
    .all() as { name: string }[];

  const existingApplicationRunColumns = new Set(
    applicationRunColumns.map(column => column.name)
  );

  const applicationRunMigrations = [
    ['duration_seconds', 'REAL'],
    ['browser_use_version', 'TEXT'],
    ['llm_model', 'TEXT'],
    ['current_step', 'INTEGER'],
    ['steps_completed', 'INTEGER'],
    ['final_result', 'TEXT'],
    ['log_file', 'TEXT'],
    ['history_file', 'TEXT'],
  ] as const;

  for (const [column, type] of applicationRunMigrations) {
    if (!existingApplicationRunColumns.has(column)) {
      db.exec(
        `ALTER TABLE application_runs ADD COLUMN ${column} ${type}`
      );

      console.log(`[db] Added application_runs.${column} column`);
    }
  }

  console.log(`[db] SQLite database ready: ${dbPath}`);
  return db;
}
