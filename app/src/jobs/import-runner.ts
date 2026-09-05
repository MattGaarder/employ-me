// Configured batch import runner

import { jobSearches } from '../config/job-searches';
import { importJobs } from './jobs.service';

export async function runConfiguredImports() {
  for (const search of jobSearches) {
    if (search.enabled === false) {
      console.log(`\n[import-runner] Skipping disabled search: ${search.name}`);
      continue;
    }

    console.log(`\n========================================`);
    console.log(`Starting configured search: ${search.name}`);
    console.log(`========================================\n`);

    await importJobs({
      keywords: search.keywords,
      location: search.location,
      dateSincePosted: search.dateSincePosted,
    });
  }
}