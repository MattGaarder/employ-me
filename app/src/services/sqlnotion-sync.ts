import { getNotionJobStatuses, updateNotionApplicationStatus } from '../integrations/notion';
import { findBySourceJobId } from '../jobs/jobs.repository';

async function syncSqliteApplicationStatusesToNotion() {
  const notionJobs = await getNotionJobStatuses();

  let updated = 0;
  let unchanged = 0;
  let notFound = 0;
  let skipped = 0;

  for (const notionJob of notionJobs) {
    if (!notionJob.sourceJobId) {
      console.warn(
        `[notion-sync-reverse] Skipping page ${notionJob.pageId}: missing Source job ID`,
      );
      skipped++;
      continue;
    }

    const job = findBySourceJobId(
      'linkedin',
      notionJob.sourceJobId,
    );

    if (!job) {
      console.warn(
        `[notion-sync-reverse] No SQLite job found for LinkedIn source job ID ${notionJob.sourceJobId}`,
      );
      notFound++;
      continue;
    }

    if (job.applicationStatus === notionJob.applicationStatus) {
      unchanged++;
      continue;
    }

    await updateNotionApplicationStatus(
      notionJob.pageId,
      job.applicationStatus,
    );

    updated++;

    console.log(
      `[notion-sync-reverse] ${notionJob.sourceJobId}: Notion ${notionJob.applicationStatus} → SQLite ${job.applicationStatus}`,
    );
  }

  return {
    updated,
    unchanged,
    notFound,
    skipped,
  };
}

async function main() {
  const result = await syncSqliteApplicationStatusesToNotion();

  console.log('[notion-sync-reverse] Complete');
  console.log(result);
}

main().catch((error) => {
  console.error('[notion-sync-reverse] Failed:', error);
  process.exit(1);
});