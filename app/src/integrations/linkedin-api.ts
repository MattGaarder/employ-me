// LinkedIn scraper API client

import { Job } from '../types';

function baseUrl(): string {
  return process.env.LINKEDIN_API_URL ?? 'http://localhost:3000';
}

export interface SearchParams {
  keywords?: string;
  location?: string;
  dateSincePosted?: string;
}

interface RawScraperListing {
  id: string;
  title: string;
  company: string;
  location: string;
  link: string;
  listDate: string;
}

interface RawScraperDetails {
  id: string;
  title: string;
  company: string;
  location: string;
  description: string;
  link: string;
  applicationUrl?: string | null;
  datePosted?: string | null;
}

/**
 * Call GET /api/v1/jobs/search on the LinkedIn scraper.
 * Returns partial canonical Job objects (with status 'DISCOVERED').
 */
export async function searchJobs(params: SearchParams): Promise<Job[]> {
  const query = new URLSearchParams();
  if (params.keywords) query.set('keywords', params.keywords);
  if (params.location) query.set('location', params.location);
  if (params.dateSincePosted) query.set('dateSincePosted', params.dateSincePosted);

  const url = `${baseUrl()}/api/v1/jobs/search?${query.toString()}`;
  console.log(`[linkedin-api] GET ${url}`);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`LinkedIn API search failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { success: boolean; jobs: RawScraperListing[] };
  const rawListings = data.jobs ?? [];
  const now = new Date().toISOString();

  return rawListings
    .filter((item) => Boolean(item.id && item.id.trim() !== ''))
    .map((item) => ({
      source: 'linkedin',
      sourceJobId: item.id,
      title: item.title,
      company: item.company,
      location: item.location || null,
      url: item.link || null,
      description: null,
      datePosted: item.listDate || null,
      dateFound: now,
      fitScore: null,
      fitExplanation: null,
      coverLetter: null,
      status: 'DISCOVERED',
      applicationStatus: 'NOT_READY',
      applicationUrl: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
    }));
}

/**
 * Call GET /api/v1/jobs/:id on the LinkedIn scraper.
 * Enriches a canonical Job with the full scraped details including description, applicationUrl, and datePosted.
 */
export async function getJobDetails(jobOrId: Job | string): Promise<Job> {
  const sourceJobId = typeof jobOrId === 'string' ? jobOrId : jobOrId.sourceJobId;
  const match = sourceJobId.match(/view\/(\d+)/) || sourceJobId.match(/-(\d+)\?/) || sourceJobId.match(/^(\d+)$/);
  const numericId = match ? match[1] : sourceJobId;

  if (!numericId || !/^\d+$/.test(numericId)) {
    throw new Error(`Invalid numeric LinkedIn job ID: "${sourceJobId}"`);
  }

  const url = `${baseUrl()}/api/v1/jobs/${numericId}`;
  console.log(`[scraper] Fetching job details: ${url}`);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`LinkedIn API job fetch failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { success: boolean; job: RawScraperDetails };
  const details = data.job;

  if (!details) {
    throw new Error(`No job details returned for ID: ${numericId}`);
  }

  const descLength = details.description ? details.description.length : 0;
  console.log(`[scraper] Description found (${descLength.toLocaleString()} chars)`);
  if (details.datePosted) {
    console.log(`[scraper] Date posted: "${details.datePosted}"`);
  }
  if (details.applicationUrl) {
    console.log(`[scraper] Application URL: ${details.applicationUrl}`);
  }

  const now = new Date().toISOString();

  if (typeof jobOrId === 'string') {
    return {
      source: 'linkedin',
      sourceJobId: details.id || numericId,
      title: details.title,
      company: details.company,
      location: details.location || null,
      url: details.link || null,
      description: details.description || null,
      datePosted: details.datePosted || null,
      dateFound: now,
      fitScore: null,
      fitExplanation: null,
      coverLetter: null,
      status: 'FETCHED',
      applicationStatus: 'NOT_READY',
      applicationUrl: details.applicationUrl || null,
      notes: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  // Enrich existing canonical Job in place
  jobOrId.title = details.title || jobOrId.title;
  jobOrId.company = details.company || jobOrId.company;
  jobOrId.location = details.location || jobOrId.location;
  jobOrId.url = details.link || jobOrId.url;
  jobOrId.description = details.description || null;
  jobOrId.applicationUrl = details.applicationUrl || jobOrId.applicationUrl || null;
  jobOrId.datePosted = details.datePosted || jobOrId.datePosted || null;
  jobOrId.status = 'FETCHED';
  jobOrId.updatedAt = now;

  return jobOrId;
}
