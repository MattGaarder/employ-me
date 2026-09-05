// app/src/config/job-config.ts

export interface JobSearchConfig {
  name: string;
  keywords: string;
  location: string;
  dateSincePosted: 'past_24h' | 'past_week' | 'past_month';
  enabled: boolean;
}

export const jobSearches: JobSearchConfig[] = [

  {
    name: 'Remote — Frontend / Web',
    keywords: `
      ("Web Developer" OR
       "Web Engineer" OR
       "Frontend Developer" OR
       "Front-End Developer" OR
       "React Developer" OR
       "Vue Developer" OR
       "JavaScript Developer" OR
       "TypeScript Developer" OR
       "Full Stack Developer" OR
       "Junior Developer" OR
       "Associate Developer" OR
       "Graduate Developer")
      NOT Senior
      NOT Lead
      NOT Principal
      NOT Staff
      NOT Manager
      NOT Director
      NOT Head
    `,
    location: 'Remote',
    dateSincePosted: 'past_24h',
    enabled: true,
  },

  {
    name: 'Remote — Instructional Design',
    keywords: `
      ("Learning Designer" OR
       "Learning Developer" OR
       "Digital Learning Designer" OR
       "Digital Learning Developer" OR
       "E-learning Designer" OR
       "E-learning Developer" OR
       "Instructional Designer" OR
       "Learning Experience Designer" OR
       "Learning Technologist" OR
       "Digital Learning" OR
       "Training Designer" OR
       "Learning Content Developer" OR
       "Learning Solutions Designer")
      NOT Senior
      NOT Director
      NOT Head
      NOT Lead
    `,
    location: 'Remote',
    dateSincePosted: 'past_24h',
    enabled: true,
  },

  {
    name: 'Remote — AI / Automation',
    keywords: `
      ("AI Trainer" OR
       "AI Evaluator" OR
       "AI Specialist" OR
       "LLM Trainer" OR
       "Prompt Engineer" OR
       "Prompt Designer" OR
       "AI Automation" OR
       "Automation Developer" OR
       "AI Developer" OR
       "AI Engineer" OR
       "AI Solutions Engineer" OR
       "LLM Developer" OR
       "AI Agent Developer")
      NOT Senior
      NOT Director
      NOT Head
      NOT Lead
      NOT Python
    `,
    location: 'Remote',
    dateSincePosted: 'past_24h',
    enabled: true,
  },

  {
    name: 'UK — Frontend / Web',
    keywords: `
      ("Web Developer" OR
       "Frontend Developer" OR
       "Front-End Developer" OR
       "React Developer" OR
       "Vue Developer" OR
       "JavaScript Developer" OR
       "TypeScript Developer" OR
       "Full Stack Developer" OR
       "Junior Developer" OR
       "Associate Developer" OR
       "Graduate Developer")
      NOT Senior
      NOT Lead
      NOT Principal
      NOT Staff
      NOT Manager
      NOT Director
      NOT Head
    `,
    location: 'United Kingdom',
    dateSincePosted: 'past_24h',
    enabled: true,
  },

  {
    name: 'UK — Instructional Design',
    keywords: `
      ("Learning Designer" OR
       "Learning Developer" OR
       "Digital Learning Designer" OR
       "Instructional Designer" OR
       "Learning Experience Designer" OR
       "Learning Technologist" OR
       "Digital Learning" OR
       "Training Designer")
      NOT Senior
      NOT Director
      NOT Head
      NOT Lead
    `,
    location: 'United Kingdom',
    dateSincePosted: 'past_24h',
    enabled: true,
  },

  {
    name: 'UK — AI / Automation',
    keywords: `
      ("AI Trainer" OR
       "AI Evaluator" OR
       "Prompt Engineer" OR
       "AI Automation" OR
       "Automation Developer" OR
       "AI Developer" OR
       "AI Engineer" OR
       "AI Solutions Engineer" OR
       "LLM Developer")
      NOT Senior
      NOT Director
      NOT Head
      NOT Lead
      NOT Python
    `,
    location: 'United Kingdom',
    dateSincePosted: 'past_24h',
    enabled: true,
  },

  {
    name: 'Brazil — Frontend / Web',
    keywords: `
      ("Web Developer" OR
       "Frontend Developer" OR
       "Front-End Developer" OR
       "React Developer" OR
       "Vue Developer" OR
       "JavaScript Developer" OR
       "TypeScript Developer" OR
       "Full Stack Developer" OR
       "Junior Developer")
      NOT Senior
      NOT Lead
      NOT Principal
      NOT Staff
      NOT Manager
      NOT Director
      NOT Head
    `,
    location: 'Brazil',
    dateSincePosted: 'past_24h',
    enabled: true,
  },

  {
    name: 'Brazil — Instructional Design',
    keywords: `
      ("Learning Designer" OR
       "Learning Developer" OR
       "Digital Learning Designer" OR
       "Instructional Designer" OR
       "Learning Experience Designer" OR
       "Learning Technologist" OR
       "Digital Learning" OR
       "Training Designer")
      NOT Senior
      NOT Director
      NOT Head
      NOT Lead
    `,
    location: 'Brazil',
    dateSincePosted: 'past_24h',
    enabled: true,
  },

  {
    name: 'Brazil — AI / Automation',
    keywords: `
      ("AI Trainer" OR
       "AI Evaluator" OR
       "Prompt Engineer" OR
       "AI Automation" OR
       "Automation Developer" OR
       "AI Developer" OR
       "AI Engineer" OR
       "AI Solutions Engineer" OR
       "LLM Developer")
      NOT Senior
      NOT Director
      NOT Head
      NOT Lead
      NOT Python
    `,
    location: 'Brazil',
    dateSincePosted: 'past_24h',
    enabled: true,
  },
];