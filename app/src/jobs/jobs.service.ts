// import ONE search to all files being used

import { searchJobs, getJobDetails } from '../integrations/linkedin-api';
import { createNotionJob } from '../integrations/notion';
import { filterSeniorJobs } from '../services/filter.service';
import { insertSqliteJob, existsBySourceJobId } from './jobs.repository';
import { insertRun } from '../db/import-runs.repository';
import { evaluateJob } from '../ai/evaluator';
import { generateCoverLetterDocument } from '../ai/cover-letter-generator';
import { getDb } from '../db/database';
import { ImportResult } from '../types';

export interface ImportJobsParams {
  keywords?: string;
  location?: string;
  dateSincePosted?: string;
}

export async function importJobs(
  params: ImportJobsParams, 
): Promise<ImportResult> {
  const runId = insertRun({
    run_at: new Date().toISOString(),
    keywords: params.keywords ?? null,
    location: params.location ?? null,
    jobs_found: null,
    jobs_new: null,
    jobs_duplicate: null,
    status: 'RUNNING',
    error: null,
  });

  try {
    console.log(`[import] Starting import run ${runId}`);
    console.log(
      `[linkedin] Searching for: ${params.keywords || 'Any'} | ${params.location || 'Any'} | ${params.dateSincePosted || 'past_24h'}`,
    );

    const scrapedJobs = await searchJobs(params);
    const discoveredJobs = filterSeniorJobs(scrapedJobs);

    const jobsFound = discoveredJobs.length;
    const jobsFiltered = scrapedJobs.length - discoveredJobs.length;

    console.log(`[linkedin] Search returned ${scrapedJobs.length} listings`);
    console.log(`[filter] Removed ${jobsFiltered} senior listings`);
    console.log(`[filter] ${jobsFound} listings remaining`);

    let jobsNew = 0;
    let jobsDuplicate = 0;
    let detailsFetched = 0;
    let sqliteInserted = 0;
    let notionCreated = 0;
    let failed = 0;

    for (let i = 0; i < discoveredJobs.length; i++) {
      const job = discoveredJobs[i];
      const jobTag = `[job ${i + 1}/${jobsFound}]`;

      console.log(`\n${jobTag} ${job.title} — ${job.company}`);
      console.log(`${jobTag} Source ID: ${job.sourceJobId}`);
      console.log(`${jobTag} Checking SQLite for existing job...`);

      const exists = existsBySourceJobId(job.source, job.sourceJobId);

      if (exists) {
        console.log(`${jobTag} Duplicate detected — skipping detail fetch`);
        jobsDuplicate++;
        continue;
      }

      console.log(`${jobTag} New job detected`);
      jobsNew++;
      console.log(`${jobTag} Fetching full LinkedIn details...`);

      try {
        await getJobDetails(job);
        detailsFetched++;
        console.log(`${jobTag} Description after fetch: ${job.description?.length ?? 0} chars`);
      } catch (scrapeErr) {
        const errorMsg = scrapeErr instanceof Error ? scrapeErr.message : String(scrapeErr);
        console.error(`[scraper] Failed to fetch job details: ${errorMsg}`);
        console.log(`${jobTag} FAILED — job will not be persisted`);
        failed++;
        continue;
      }

      console.log(`[ai] Evaluating job...`);

      try {
        const evaluation = await evaluateJob(job);

        // Populate in-memory Job object with evaluation results before persistence
        job.fitScore = evaluation.fitScore;
        job.fitExplanation = evaluation.fitExplanation;
        job.coverLetter = evaluation.coverLetter;

        await generateCoverLetterDocument(
          job.company,
          evaluation.coverLetter,
        );

        console.log(`[ai] Evaluation complete — score: ${evaluation.fitScore}/100`);
      } catch (aiErr) {
        const errorMsg = aiErr instanceof Error ? aiErr.message : String(aiErr);
        console.error(`[ai] Evaluation failed: ${errorMsg}`);
        console.log(`${jobTag} FAILED — job will not be persisted`);
        failed++;
        continue;
      }

      console.log(`${jobTag} Building complete Job object`);
      console.log(`[sqlite] Inserting job...`);

      try {
        const result = insertSqliteJob(job);

        if (!result.inserted) {
          console.error(`[sqlite] Failed to insert job into SQLite`);
          failed++;
          continue;
        }

        sqliteInserted++;
        console.log(`[sqlite] Job inserted with ID ${job.id}`);
      } catch (sqliteErr) {
        const errorMsg =
          sqliteErr instanceof Error ? sqliteErr.message : String(sqliteErr);
        console.error(`[sqlite] Failed to insert job into SQLite: ${errorMsg}`);
        failed++;
        continue;
      }

      console.log(`[notion] Creating job...`);

      try {
        await createNotionJob(job);
        notionCreated++;
        console.log(`[notion] Job created successfully`);
      } catch (notionErr) {
        const errorMsg =
          notionErr instanceof Error ? notionErr.message : String(notionErr);

        console.error(
          `[notion] Failed to create job in Notion: ${errorMsg}`,
        );

        failed++;
      }
    }

    // Update the import run in SQLite
    getDb().prepare(`
      UPDATE import_runs
      SET
        jobs_found = ?,
        jobs_new = ?,
        jobs_duplicate = ?,
        status = ?,
        error = NULL
      WHERE id = ?
    `).run(
      jobsFound,
      jobsNew,
      jobsDuplicate,
      'COMPLETED',
      runId,
    );

    console.log(`\n[import] Run ${runId} complete\n`);
    console.log(`Found:             ${jobsFound}`);
    console.log(`New:               ${jobsNew}`);
    console.log(`Duplicates:        ${jobsDuplicate}`);
    console.log(`Details fetched:   ${detailsFetched}`);
    console.log(`SQLite inserted:   ${sqliteInserted}`);
    console.log(`Notion created:    ${notionCreated}`);
    console.log(`Failed:            ${failed}\n`);

    return {
      runId,
      jobsFound,
      jobsNew,
      jobsDuplicate,
      detailsFetched,
      sqliteInserted,
      notionCreated,
      failed,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    getDb().prepare(`
      UPDATE import_runs
      SET
        status = ?,
        error = ?
      WHERE id = ?
    `).run(
      'FAILED',
      message,
      runId,
    );

    console.error(
      `[jobs] Import failed (run ${runId}):`,
      error,
    );

    throw error;
  }
}
