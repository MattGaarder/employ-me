import ollama from 'ollama';
import { GoogleGenAI, Type } from '@google/genai';
import { config as loadEnv } from 'dotenv';
import fs from 'fs';
import path from 'path';
import { Job } from '../types';
import { SYSTEM_PROMPT } from './prompt';

loadEnv({
  path: path.resolve(process.cwd(), '../.env'),
});

const apiKey = process.env.GOOGLE_API_KEY;

if (!apiKey) {
  throw new Error('GOOGLE_API_KEY is missing. Check your .env file.');
}

const ai = new GoogleGenAI({ apiKey });

export interface AIJobEvaluation {
  fitScore: number;
  fitExplanation: string;
  coverLetter: string;
}

const careerProfile = fs.readFileSync(
  path.join(process.cwd(), 'src/ai/career-profile.md'),
  'utf8'
);

// const evaluationSchema = {
//   type: 'object',
//   properties: {
//     fitScore: {
//       type: 'integer',
//       minimum: 0,
//       maximum: 100
//     },
//     fitExplanation: {
//       type: 'string'
//     },
//     coverLetter: {
//       type: 'string'
//     }
//   },
//   required: [
//     'fitScore',
//     'fitExplanation',
//     'coverLetter'
//   ]
// };

const evaluationSchema = {
  type: Type.OBJECT,
  properties: {
    fitScore: {
      type: Type.INTEGER,
      description: 'An integer from 0 to 100 inclusive.',
    },
    fitExplanation: {
      type: Type.STRING,
      description: 'An explanation of the candidate-job fit.',
    },
    coverLetter: {
      type: Type.STRING,
      description: 'A tailored cover letter for the job.',
    },
  },
  required: ['fitScore', 'fitExplanation', 'coverLetter'],
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


  // const response = await ollama.chat({
  //   model: 'qwen3.5:latest',
  //   messages: [
  //     {
  //       role: 'system',
  //       content: SYSTEM_PROMPT
  //     },
  //     {
  //       role: 'user',
  //       content: userPrompt
  //     }
  //   ],
  //   format: evaluationSchema,
  //   stream: false,
  //   think: false,
  //   options: {
  //       num_ctx: 8192,
  //       num_predict: 2048
  //   }
  // });

  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash',
    contents: userPrompt,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseSchema: evaluationSchema,
      maxOutputTokens: 2048,
    },
  });


  const duration = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[ai] Evaluation completed in ${duration}s`);

  const rawText = response.text;

  if (!rawText) {
    throw new Error(
      `Gemini returned an empty response for ${job.title} — ${job.company}`
    );
  }


  console.log('[ai] Raw response:');
  console.log(rawText);

  let evaluation: AIJobEvaluation;

  try {
    evaluation = JSON.parse(rawText) as AIJobEvaluation;
  } catch {
    throw new Error(
      `Gemini returned invalid JSON for ${job.title} — ${job.company}`
    );
  }

  // Validate important assumptions before the result reaches your database.
  if (
    !Number.isInteger(evaluation.fitScore) ||
    evaluation.fitScore < 0 ||
    evaluation.fitScore > 100
  ) {
    throw new Error(
      `Gemini returned an invalid fit score: ${evaluation.fitScore}`
    );
  }

  if (
    typeof evaluation.fitExplanation !== 'string' ||
    typeof evaluation.coverLetter !== 'string'
  ) {
    throw new Error('Gemini returned an invalid evaluation structure.');
  }

  console.log(
    `[ai] Fit score: ${evaluation.fitScore}`
  );

  return evaluation;
}