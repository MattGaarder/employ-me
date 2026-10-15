import { getNotionJobStatuses } from '../integrations/notion';
import {
  findBySourceJobId,
  updateJobDetailsFromNotion,
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

    const statusChanged = job.applicationStatus !== notionJob.applicationStatus;
    const urlChanged =
      notionJob.applicationUrl !== null &&
      notionJob.applicationUrl !== undefined &&
      notionJob.applicationUrl.trim() !== '' &&
      notionJob.applicationUrl !== job.applicationUrl;
    const notesChanged =
      notionJob.notes !== null &&
      notionJob.notes !== undefined &&
      notionJob.notes !== job.notes;
    const coverLetterChanged =
      notionJob.coverLetter !== null &&
      notionJob.coverLetter !== undefined &&
      notionJob.coverLetter !== job.coverLetter;

    if (!statusChanged && !urlChanged && !notesChanged && !coverLetterChanged) {
      unchanged++;
      continue;
    }

    // Update SQLite with all changed properties
    updateJobDetailsFromNotion(
      job.id!,
      notionJob.applicationStatus,
      notionJob.applicationUrl ?? job.applicationUrl,
      notionJob.notes ?? job.notes,
      notionJob.coverLetter ?? job.coverLetter,
    );

    updated++;

    const changeDescriptions: string[] = [];
    if (statusChanged) {
      changeDescriptions.push(`status: ${job.applicationStatus} → ${notionJob.applicationStatus}`);
    }
    if (urlChanged) {
      changeDescriptions.push(`url: ${job.applicationUrl} → ${notionJob.applicationUrl}`);
    }
    if (notesChanged) {
      changeDescriptions.push('notes updated');
    }
    if (coverLetterChanged) {
      changeDescriptions.push('cover letter updated');
    }

    console.log(
      `[notion-sync] ${notionJob.sourceJobId}: ${changeDescriptions.join(', ')}`,
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
  const result = await syncNotionApplicationStatuses();

  console.log('[notion-sync] Complete');
  console.log(result);
}

main().catch((error) => {
  console.error('[notion-sync] Failed:', error);
  process.exit(1);
});