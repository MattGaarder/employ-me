// HTTP integration test for the application-run API

import {
  createApplicationRun,
  getNextApplicationAttemptNumber,
} from './application-runs/application-runs.repository';

const API_BASE_URL = 'http://localhost:3001/api';
const JOB_ID = 61;

async function request(
  path: string,
  options: RequestInit = {},
): Promise<any> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  const body = await response.json();

  console.log(`\n${options.method ?? 'GET'} ${path}`);
  console.log(`HTTP ${response.status}`);
  console.dir(body, { depth: null });

  if (!response.ok) {
    throw new Error(
      `HTTP request failed: ${response.status} ${JSON.stringify(body)}`,
    );
  }

  return body;
}

async function testCompleteLifecycle(): Promise<void> {
  console.log('\n========================================');
  console.log('TEST 1: COMPLETE APPLICATION RUN');
  console.log('========================================');

  // Create a fresh run directly through the repository.
  // From this point onward, the lifecycle is tested through HTTP.
  const attemptNumber = getNextApplicationAttemptNumber(JOB_ID);

  const run = createApplicationRun(
    JOB_ID,
    attemptNumber,
  );

  console.log('\nCreated test run:');
  console.dir(run, { depth: null });

  const runId = run.id!;

  // ─── Start ────────────────────────────────────────────────────────────────

  await request(
    `/application-runs/${runId}/start`,
    {
      method: 'POST',
    },
  );

  // ─── Progress ─────────────────────────────────────────────────────────────

  await request(
    `/application-runs/${runId}/progress`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        currentStep: 1,
        stepsCompleted: 1,
      }),
    },
  );

  await request(
    `/application-runs/${runId}/progress`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        currentStep: 2,
        stepsCompleted: 2,
      }),
    },
  );

  await request(
    `/application-runs/${runId}/progress`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        currentStep: 3,
        stepsCompleted: 3,
      }),
    },
  );

  // ─── Complete ────────────────────────────────────────────────────────────

  await request(
    `/application-runs/${runId}/complete`,
    {
      method: 'POST',
      body: JSON.stringify({
        stepsCompleted: 3,
        finalResult: 'Test application completed successfully',
        logFile: null,
        historyFile: null,
      }),
    },
  );

  // ─── Read application-run history ─────────────────────────────────────────

  const result = await request(
    `/jobs/${JOB_ID}/application-runs`,
  );

  const completedRun = result.runs.find(
    (item: any) => item.id === runId,
  );

  if (!completedRun) {
    throw new Error(
      `Could not find completed run ${runId} in job history`,
    );
  }

  if (completedRun.status !== 'COMPLETE') {
    throw new Error(
      `Expected run ${runId} to be COMPLETE, got ${completedRun.status}`,
    );
  }

  if (completedRun.stepsCompleted !== 3) {
    throw new Error(
      `Expected 3 completed steps, got ${completedRun.stepsCompleted}`,
    );
  }

  console.log('\n✓ Complete lifecycle passed');
}

// ─── Failed lifecycle ────────────────────────────────────────────────────────

async function testFailedLifecycle(): Promise<void> {
  console.log('\n========================================');
  console.log('TEST 2: FAILED APPLICATION RUN');
  console.log('========================================');

  // Create another fresh run.
  const attemptNumber = getNextApplicationAttemptNumber(JOB_ID);

  const run = createApplicationRun(
    JOB_ID,
    attemptNumber,
  );

  console.log('\nCreated test run:');
  console.dir(run, { depth: null });

  const runId = run.id!;

  // ─── Start ────────────────────────────────────────────────────────────────

  await request(
    `/application-runs/${runId}/start`,
    {
      method: 'POST',
    },
  );

  // ─── Progress ─────────────────────────────────────────────────────────────

  await request(
    `/application-runs/${runId}/progress`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        currentStep: 2,
        stepsCompleted: 2,
      }),
    },
  );

  // ─── Fail ─────────────────────────────────────────────────────────────────

  await request(
    `/application-runs/${runId}/fail`,
    {
      method: 'POST',
      body: JSON.stringify({
        errorMessage: 'Test application failed intentionally',
        logFile: null,
        historyFile: null,
      }),
    },
  );

  // ─── Read application-run history ─────────────────────────────────────────

  const result = await request(
    `/jobs/${JOB_ID}/application-runs`,
  );

  const failedRun = result.runs.find(
    (item: any) => item.id === runId,
  );

  if (!failedRun) {
    throw new Error(
      `Could not find failed run ${runId} in job history`,
    );
  }

  if (failedRun.status !== 'ERROR') {
    throw new Error(
      `Expected run ${runId} to be ERROR, got ${failedRun.status}`,
    );
  }

  if (
    failedRun.errorMessage !==
    'Test application failed intentionally'
  ) {
    throw new Error(
      `Unexpected error message: ${failedRun.errorMessage}`,
    );
  }

  console.log('\n✓ Failed lifecycle passed');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Starting application-run API tests...');
  console.log(`API: ${API_BASE_URL}`);
  console.log(`Test job ID: ${JOB_ID}`);

  try {
    await testCompleteLifecycle();
    await testFailedLifecycle();

    console.log('\n========================================');
    console.log('ALL APPLICATION-RUN API TESTS PASSED');
    console.log('========================================');
  } catch (error) {
    console.error('\n========================================');
    console.error('APPLICATION-RUN API TEST FAILED');
    console.error('========================================');
    console.error(error);

    process.exit(1);
  }
}

main();
