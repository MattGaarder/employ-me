// Dev import runner: waits for scraper server and executes imports

import { runConfiguredImports } from './jobs/import-runner';

async function waitForServer(url: string, name: string, maxRetries = 30, intervalMs = 1000): Promise<void> {
  console.log(`[dev:import] Waiting for ${name} to be ready at ${url}...`);

  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.status < 500) {
        console.log(`[dev:import] ${name} is ready! (HTTP ${res.status})`);
        return;
      }
    } catch {
      // Server not yet listening or starting up
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for ${name} at ${url}`);
}

async function main() {
  try {
    const scraperUrl = process.env.LINKEDIN_API_URL ?? 'http://localhost:3000';
    // Use the lightweight /health endpoint (does NOT trigger Puppeteer)
    await waitForServer(`${scraperUrl}/health`, 'LinkedIn scraper API');

    console.log('\n[dev:import] Scraper is online. Starting configured imports...\n');
    await runConfiguredImports();
    console.log('\n[dev:import] Configured imports finished. Dev servers remain active.\n');
  } catch (error) {
    console.error('[dev:import] Execution failed:', error);
  }
}

main();
