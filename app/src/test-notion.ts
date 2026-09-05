// Notion integration test script

import 'dotenv/config';
import { createNotionJob } from './integrations/notion';
import { Job } from './types';

async function testNotionIntegration() {
  console.log('[test-notion] Testing Notion job creation...');

  const testJob: Job = {
    source: 'linkedin',
    sourceJobId: `test-${Date.now()}`,
    title: 'Senior Frontend Engineer (Test)',
    company: 'Acme Test Corp',
    location: 'Remote, US',
    url: 'https://www.linkedin.com/jobs/view/123456789/',
    description: 'This is a test job description to verify that full descriptions are synced to Notion.\n\nKey Responsibilities:\n- Build great UI\n- Integrate TypeScript\n- Maintain clean architecture',
    datePosted: new Date().toISOString().split('T')[0],
    dateFound: new Date().toISOString(),
    fitScore: 85,
    fitReasons: ['React (+20)', 'TypeScript (+20)', 'Frontend Developer (+30)'],
    status: 'DISCOVERED',
    applicationUrl: 'https://example.com/apply',
    notes: 'Integration test automated entry',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    const response = await createNotionJob(testJob);
    console.log('[test-notion] SUCCESS! Created Notion page with ID:', response.id);
  } catch (error) {
    console.error('[test-notion] FAILED to create Notion page:', error);
    process.exit(1);
  }
}

testNotionIntegration();
