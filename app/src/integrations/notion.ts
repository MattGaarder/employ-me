// Notion database integration

import { Client } from '@notionhq/client';
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { Job } from '../types';
import 'dotenv/config';

export interface NotionJobStatus {
  pageId: string;
  sourceJobId: string;
  applicationStatus: string;
  applicationUrl: string | null;
  notes: string | null;
  coverLetter: string | null;
}

const notionToken = process.env.NOTION_TOKEN;
const databaseId = process.env.NOTION_DATABASE_ID;

if (!notionToken) { throw new Error('NOTION_TOKEN is not configured'); }
if (!databaseId) { throw new Error('NOTION_DATABASE_ID is not configured'); }

const notion = new Client({ auth: notionToken });

async function getDataSourceId(): Promise<string> {
  const database = await notion.databases.retrieve({
    database_id: databaseId as string,
  });

  if (!('data_sources' in database) || database.data_sources.length === 0) {
    throw new Error('No data source found for Notion database');
  }

  return database.data_sources[0].id;
}

/**
 * Split text into 2000-character chunks to satisfy Notion rich_text block limits.
 */
function toRichText(text: string | null | undefined): Array<{ text: { content: string } }> {
  if (!text || text.trim() === '') return [];
  const chunks: Array<{ text: { content: string } }> = [];
  const chunkSize = 2000;
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push({ text: { content: text.slice(i, i + chunkSize) } });
  }
  return chunks;
}

export async function createNotionJob(job: Job) {
  const notionSourceName =
    job.applicationUrl && job.applicationUrl.trim() !== ''
      ? 'External'
      : 'Easy Apply';

  const properties: Record<string, any> = {
    Role: { title: [{ text: { content: job.title ?? '' } }] },
    Company: { rich_text: toRichText(job.company) },
    Location: { rich_text: toRichText(job.location) },
    'Source job ID': { rich_text: toRichText(job.sourceJobId) },
    'Date posted': { rich_text: toRichText(job.datePosted) },
    Description: { rich_text: toRichText(job.description) },
    Notes: { rich_text: toRichText(job.notes) },
    'Fit explanation': { rich_text: toRichText(job.fitExplanation) },
    'Cover letter': { rich_text: toRichText(job.coverLetter) },
    Source: notionSourceName ? { select: { name: notionSourceName } } : { select: null },
    'Application status': { select: {name: job.applicationStatus,} },
    'Date found': job.dateFound ? { date: { start: job.dateFound } } : { date: null },
    'Job URL': job.url ? { url: job.url } : { url: null },
    'Application URL': job.applicationUrl ? { url: job.applicationUrl } : { url: null },
    'Fit score': typeof job.fitScore === 'number' ? { number: job.fitScore } : { number: null },
  };

  return notion.pages.create({
    parent: { database_id: databaseId as string },
    properties,
  });
}

export async function getNotionJobStatuses(): Promise<NotionJobStatus[]> {
  const dataSourceId = await getDataSourceId();

  const response = await notion.dataSources.query({
    data_source_id: dataSourceId,
  });

  return response.results
    .filter((page): page is PageObjectResponse => 'properties' in page)
    .map((page) => {
      const properties = page.properties;

      const sourceJobIdProperty = properties['Source job ID'];
      const applicationStatusProperty = properties['Application status'];
      const applicationUrlProperty = properties['Application URL'];
      const notesProperty = properties['Notes'];
      const coverLetterProperty = properties['Cover letter'];

      const sourceJobId =
        sourceJobIdProperty?.type === 'rich_text'
          ? sourceJobIdProperty.rich_text
              .map((item) => item.plain_text)
              .join('')
          : '';

      const applicationStatus =
        applicationStatusProperty?.type === 'select'
          ? applicationStatusProperty.select?.name ?? ''
          : '';

      const applicationUrl =
        applicationUrlProperty?.type === 'url'
          ? applicationUrlProperty.url
          : null;

      const notes =
        notesProperty?.type === 'rich_text'
          ? notesProperty.rich_text
              .map((item) => item.plain_text)
              .join('')
          : null;

      const coverLetter =
        coverLetterProperty?.type === 'rich_text'
          ? coverLetterProperty.rich_text
              .map((item) => item.plain_text)
              .join('')
          : null;

      return {
        pageId: page.id,
        sourceJobId,
        applicationStatus,
        applicationUrl,
        notes,
        coverLetter,
      };
    });
}

export async function updateNotionApplicationStatus(
  pageId: string,
  applicationStatus: string,
) {
  return notion.pages.update({
    page_id: pageId,
    properties: {
      'Application status': {
        select: {
          name: applicationStatus,
        },
      },
    },
  });
}

export async function updateNotionJobDescription(
  pageId: string,
  description: string,
) {
  return notion.pages.update({
    page_id: pageId,
    properties: {
      Description: {
        rich_text: toRichText(description),
      },
    },
  });
}

export async function updateNotionStatusBySourceJobId(
  sourceJobId: string,
  applicationStatus: string,
): Promise<boolean> {
  if (!sourceJobId) {
    console.warn('[notion] updateNotionStatusBySourceJobId called with empty sourceJobId');
    return false;
  }

  try {
    const dataSourceId = await getDataSourceId();
    const response = await (notion as any).dataSources.query({
      data_source_id: dataSourceId,
      filter: {
        property: 'Source job ID',
        rich_text: {
          equals: sourceJobId,
        },
      },
    });

    if (!response.results || response.results.length === 0) {
      console.warn(`[notion] No page found for Source job ID: ${sourceJobId}`);
      return false;
    }

    const pageId = response.results[0].id;
    await updateNotionApplicationStatus(pageId, applicationStatus);
    console.log(
      `[notion] Updated Source job ID ${sourceJobId} (page ${pageId}) status to ${applicationStatus}`,
    );
    return true;
  } catch (error) {
    console.error(
      `[notion] Failed to update status to ${applicationStatus} for Source job ID ${sourceJobId}:`,
      error,
    );
    return false;
  }
}

export { notion, getDataSourceId, toRichText };