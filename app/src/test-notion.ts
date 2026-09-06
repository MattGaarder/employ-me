import { getNotionJobStatuses } from './integrations/notion';

async function main() {
  const jobs = await getNotionJobStatuses();

  console.log('Notion jobs:');
  console.dir(jobs, { depth: null });
}

main().catch((error) => {
  console.error('Notion test failed:', error);
  process.exit(1);
});