import { syncNotionApplicationStatuses } from './services/notion-sync';

async function main() {
  const result = await syncNotionApplicationStatuses();

  console.log('Sync complete:');
  console.dir(result, { depth: null });
}

main().catch((error) => {
  console.error('Notion sync failed:', error);
  process.exit(1);
});