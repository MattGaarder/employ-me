// Notion database integration

import { Client } from '@notionhq/client';
import type { BlockObjectRequest, PageObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { Job } from '../types';
import 'dotenv/config';

export interface NotionJobStatus {
  pageId: string;
  sourceJobId: string;
  applicationStatus: string;
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

const STATUS_MAP: Record<string, string> = {
  DISCOVERED: 'Discovered',
  FETCHED: 'Discovered',
  EVALUATED: 'Evaluated',
  REVIEW: 'In review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  SKIPPED: 'Skipped',
  EXPIRED: 'Expired',
  FAILED: 'Failed',
};

function paragraphBlock(text: string): BlockObjectRequest {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [
        {
          type: 'text',
          text: {
            content: text,
          },
        },
      ],
    },
  };
}

// Split into chunks (Notion block rich_text items also have limits)
function descriptionToBlocks(
  text: string | null | undefined
): BlockObjectRequest[] {
  if (!text?.trim()) return [];

  const chunkSize = 2000;
  const blocks: BlockObjectRequest[] = [];

  for (let i = 0; i < text.length; i += chunkSize) {
    blocks.push(paragraphBlock(text.slice(i, i + chunkSize)));
  }
  return blocks;
}

export async function createNotionJob(job: Job) {
  const notionStatusName = STATUS_MAP[job.status] || 'Discovered';
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
    Notes: { rich_text: toRichText(job.notes) },
    'Fit explanation': { rich_text: toRichText(job.fitExplanation) },
    'Cover letter': { rich_text: toRichText(job.coverLetter) },
    Source: notionSourceName ? { select: { name: notionSourceName } } : { select: null },
    Status: { status: { name: notionStatusName } },
    'Application status': { select: { name: job.applicationStatus } },
    'Date found': job.dateFound ? { date: { start: job.dateFound } } : { date: null },
    'Job URL': job.url ? { url: job.url } : { url: null },
    'Application URL': job.applicationUrl ? { url: job.applicationUrl } : { url: null },
    'Fit score': typeof job.fitScore === 'number' ? { number: job.fitScore } : { number: null },
  };

  return notion.pages.create({
    parent: { database_id: databaseId as string },
    properties,
    children: [
      {
        object: "block",
        type: "heading_2",
        heading_2: { rich_text: [{ type: "text", text: { content: "Job description" } }] },
      },
      ...descriptionToBlocks(job.description),
    ],
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

      return {
      pageId: page.id,
      sourceJobId,
      applicationStatus,
    };
  });
}