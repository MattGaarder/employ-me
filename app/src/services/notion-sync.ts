import { getNotionJobStatuses } from '../integrations/notion';
import {
  findBySourceJobId,
  updateApplicationStatus,
} from '../jobs/jobs.repository';
import {
  ApplicationStatus,
  ALL_APPLICATION_STATUSES,
} from '../types';

function isApplicationStatus(
  value: string,
): value is ApplicationStatus {
  return ALL_APPLICATION_STATUSES.includes(
    value as ApplicationStatus,
  );
}

export async function syncNotionApplicationStatuses() {
  const notionJobs = await getNotionJobStatuses();

  let updated = 0;
  let unchanged = 0;
  let notFound = 0;
  let skipped = 0;

  for (const notionJob of notionJobs) {
    // Make sure the Notion row actually identifies a job
    if (!notionJob.sourceJobId) {
      console.warn(
        `[notion-sync] Skipping page ${notionJob.pageId}: missing Source job ID`,
      );
      skipped++;
      continue;
    }

    // Make sure Notion contains a valid application status
    if (!isApplicationStatus(notionJob.applicationStatus)) {
      console.warn(
        `[notion-sync] Skipping ${notionJob.sourceJobId}: invalid Application status "${notionJob.applicationStatus}"`,
      );
      skipped++;
      continue;
    }

    // Find the corresponding SQLite job
    const job = findBySourceJobId(
      'linkedin',
      notionJob.sourceJobId,
    );

    if (!job) {
      console.warn(
        `[notion-sync] No SQLite job found for LinkedIn source job ID ${notionJob.sourceJobId}`,
      );
      notFound++;
      continue;
    }

    // Nothing to do if SQLite already has the same status
    if (job.applicationStatus === notionJob.applicationStatus) {
      unchanged++;
      continue;
    }

    // Update SQLite
    updateApplicationStatus(
      job.id!,
      notionJob.applicationStatus,
    );

    updated++;

    console.log(
      `[notion-sync] ${notionJob.sourceJobId}: ${job.applicationStatus} → ${notionJob.applicationStatus}`,
    );
  }

  return {
    updated,
    unchanged,
    notFound,
    skipped,
  };
}