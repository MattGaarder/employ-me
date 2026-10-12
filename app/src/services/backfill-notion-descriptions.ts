import {
  notion,
  getDataSourceId,
  updateNotionJobDescription,
} from '../integrations/notion';
import { findBySourceJobId } from '../jobs/jobs.repository';
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function backfillNotionDescriptions() {
  console.log('[backfill] Fetching Notion pages...');
  const dataSourceId = await getDataSourceId();

  const response = await notion.dataSources.query({
    data_source_id: dataSourceId,
  });

  const pages = response.results.filter(
    (page): page is PageObjectResponse => 'properties' in page,
  );

  console.log(`[backfill] Found ${pages.length} pages in Notion`);

  let updated = 0;
  let alreadyFilled = 0;
  let noDescriptionInSqlite = 0;
  let notFoundInSqlite = 0;
  let skippedNoSourceId = 0;

  for (const page of pages) {
    const properties = page.properties;

    // 1. Check existing Notion description
    const descProp = properties['Description'];
    const currentDescText =
      descProp?.type === 'rich_text'
        ? descProp.rich_text.map((t) => t.plain_text).join('').trim()
        : '';

    if (currentDescText.length > 0) {
      alreadyFilled++;
      continue;
    }

    // 2. Extract Source job ID
    const sourceJobIdProp = properties['Source job ID'];
    const sourceJobId =
      sourceJobIdProp?.type === 'rich_text'
        ? sourceJobIdProp.rich_text.map((t) => t.plain_text).join('').trim()
        : '';

    if (!sourceJobId) {
      skippedNoSourceId++;
      continue;
    }

    // 3. Find corresponding job in SQLite
    const sqliteJob = findBySourceJobId('linkedin', sourceJobId);
    if (!sqliteJob) {
      console.warn(`[backfill] No SQLite record found for source ID ${sourceJobId}`);
      notFoundInSqlite++;
      continue;
    }

    if (!sqliteJob.description || sqliteJob.description.trim() === '') {
      noDescriptionInSqlite++;
      continue;
    }

    const title = sqliteJob.title ?? 'Untitled';
    console.log(
      `[backfill] Updating "${title.slice(0, 35)}..." (${sourceJobId}) with ${sqliteJob.description.length} chars`,
    );

    // 4. Update ONLY Description in Notion
    await updateNotionJobDescription(page.id, sqliteJob.description);
    updated++;

    // Polite pause to stay well clear of Notion API rate limits (3 req/s)
    await sleep(250);
  }

  return {
    totalPages: pages.length,
    updated,
    alreadyFilled,
    noDescriptionInSqlite,
    notFoundInSqlite,
    skippedNoSourceId,
  };
}

async function main() {
  const result = await backfillNotionDescriptions();
  console.log('\n[backfill] Summary:');
  console.log(result);
}

main().catch((err) => {
  console.error('[backfill] Error:', err);
  process.exit(1);
});
