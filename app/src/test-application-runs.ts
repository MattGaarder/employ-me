import {
  createApplicationRun,
  findApplicationRunsByJobId,
  getNextApplicationAttemptNumber,
  startApplicationRun,
  updateApplicationRunProgress,
  completeApplicationRun,
} from './application-runs/application-runs.repository';

async function main() {
  const jobId = 61;

  const attemptNumber = getNextApplicationAttemptNumber(jobId);

  console.log(`Next attempt number: ${attemptNumber}`);

  const run = createApplicationRun(jobId, attemptNumber);

  console.log('\nCreated application run:');
  console.dir(run, { depth: null });

  // Simulate Browser Use starting
  const startedAt = new Date().toISOString();

  startApplicationRun(
    run.id!,
    startedAt,
    '0.13.8',
    'qwen3.5:latest',
  );

  console.log('\nApplication run → RUNNING');

  // Simulate Browser Use progressing
  updateApplicationRunProgress(run.id!, 1, 1);

  updateApplicationRunProgress(run.id!, 2, 2);

  updateApplicationRunProgress(run.id!, 3, 3);

  console.log('\nApplication run → step 3');

  // Simulate Browser Use completing
  const finishedAt = new Date().toISOString();

  const durationSeconds =
    (new Date(finishedAt).getTime() -
      new Date(startedAt).getTime()) / 1000;

  completeApplicationRun(
    run.id!,
    finishedAt,
    durationSeconds,
    3,
    'Test application completed successfully',
    null,
    null,
  );

  console.log('\nApplication run → COMPLETE');

  // Read it back from SQLite
  const runs = findApplicationRunsByJobId(jobId);

  console.log('\nApplication runs for job:');
  console.dir(runs, { depth: null });
}

main().catch((error) => {
  console.error('Application run lifecycle test failed:', error);
  process.exit(1);
});