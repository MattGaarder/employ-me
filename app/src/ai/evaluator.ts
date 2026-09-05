import ollama from 'ollama';
import fs from 'fs';
import path from 'path';
import { Job } from '../types';
import { SYSTEM_PROMPT } from './prompt';

export interface AIJobEvaluation {
  fitScore: number;
  fitExplanation: string;
  coverLetter: string;
}

const careerProfile = fs.readFileSync(
  path.join(process.cwd(), 'src/ai/career-profile.md'),
  'utf8'
);

const evaluationSchema = {
  type: 'object',
  properties: {
    fitScore: {
      type: 'integer',
      minimum: 0,
      maximum: 100
    },
    fitExplanation: {
      type: 'string'
    },
    coverLetter: {
      type: 'string'
    }
  },
  required: [
    'fitScore',
    'fitExplanation',
    'coverLetter'
  ]
};

export async function evaluateJob(
  job: Job
): Promise<AIJobEvaluation> {

  console.log(`[ai] Evaluating: ${job.title} — ${job.company}`);

  const userPrompt = `
## Candidate Career Profile
${careerProfile}

---
## Job
Title: ${job.title}
Company: ${job.company}
Location: ${job.location ?? 'Not specified'}
Job Description:${job.description ?? 'No description available.'}

---
Evaluate this job according to the instructions.
`;

const start = Date.now();
  const response = await ollama.chat({
    model: 'qwen3.5:latest',
    messages: [
      {
        role: 'system',
        content: SYSTEM_PROMPT
      },
      {
        role: 'user',
        content: userPrompt
      }
    ],
    format: evaluationSchema,
    stream: false,
    think: false,
    options: {
        num_ctx: 8192,
        num_predict: 2048
    }
  });
  const duration = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[ai] Evaluation completed in ${duration}s`);
  console.log('[ai] Raw response:');
  console.dir(response, { depth: null });

  const evaluation = JSON.parse(
    response.message.content
  ) as AIJobEvaluation;

  console.log(
    `[ai] Fit score: ${evaluation.fitScore}`
  );

  return evaluation;
}