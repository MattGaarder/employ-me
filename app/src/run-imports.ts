// CLI entry point for running job imports

import { runConfiguredImports } from './jobs/import-runner';

async function main() {
  try {
    console.log('Starting configured job imports...');

    await runConfiguredImports();

    console.log('\nAll configured imports completed successfully.');
  } catch (error) {
    console.error('Job import process failed:', error);
    process.exit(1);
  }
}

main();