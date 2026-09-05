import { findById } from './jobs/jobs.repository';
import { evaluateJob } from './ai/evaluator';

async function main() {
  // Change this to the SQLite ID of the job you want to test
  const jobId = 4;

  console.log(`[test-ai] Loading job ${jobId} from SQLite...`);

  const job = findById(jobId);

  if (!job) {
    throw new Error(`Job with SQLite ID ${jobId} was not found`);
  }

  console.log(`[test-ai] Found job: ${job.title} — ${job.company}`);
  console.log(`[test-ai] Description length: ${job.description?.length ?? 0} chars`);

  if (!job.description) {
    throw new Error(`Job ${jobId} has no description`);
  }

  console.log(`[test-ai] Sending job to AI...\n`);

  const start = Date.now();

  const evaluation = await evaluateJob(job);

  const duration = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`\n========================================`);
  console.log(`AI EVALUATION COMPLETE`);
  console.log(`========================================`);

  console.log(`\nJob: ${job.title}`);
  console.log(`Company: ${job.company}`);
  console.log(`AI processing time: ${duration}s`);

  console.log(`\nFit Score: ${evaluation.fitScore}/100`);

  console.log(`\nFit Explanation:`);
  console.log(evaluation.fitExplanation);

  console.log(`\nCover Letter:`);
  console.log(`----------------------------------------`);
  console.log(evaluation.coverLetter);
  console.log(`----------------------------------------`);
}

main().catch((error) => {
  console.error('\n[test-ai] ERROR:');
  console.error(error);
  process.exit(1);
});