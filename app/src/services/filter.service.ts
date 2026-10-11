import { Job } from '../types';

export function filterSeniorJobs(jobs: Job[]): Job[] {
  const excludedTitles = /\b(senior|sr\.?|lead|principal|manager|director|head)\b/i;

  return jobs.filter((job) => {
    return !excludedTitles.test(job.title);
  });
}