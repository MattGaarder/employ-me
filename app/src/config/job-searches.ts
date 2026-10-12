// export interface JobSearchConfig {
//   name: string;
//   keywords: string;
//   location: string;
//   dateSincePosted: 'past_24h' | 'past_week' | 'past_month';
//   enabled: boolean;
// }

// export const jobSearches: JobSearchConfig[] = [
//   {
//     name: 'UK — Frontend / Web',
//     keywords: `
//       ("Frontend Developer" OR
//        "Front-End Developer" OR
//        "Web Developer" OR
//        "JavaScript Developer" OR
//        "TypeScript Developer" OR
//        "Vue Developer")
//       NOT Senior
//       NOT Lead
//       NOT Principal
//       NOT Staff
//       NOT Manager
//       NOT Director
//       NOT Head
//     `.replace(/\s+/g, ' ').trim(),
//     location: 'United Kingdom',
//     dateSincePosted: 'past_week',
//     enabled: true,
//   },
//   {
//     name: 'UK — Learning Technology',
//     keywords: `
//       ("Learning Technologist" OR
//        "Digital Learning Developer" OR
//        "E-learning Developer" OR
//        "Learning Experience Designer" OR
//        "Instructional Designer" OR
//        "Learning Designer")
//       NOT Senior
//       NOT Lead
//       NOT Principal
//       NOT Manager
//       NOT Director
//       NOT Head
//     `.replace(/\s+/g, ' ').trim(),
//     location: 'United Kingdom',
//     dateSincePosted: 'past_week',
//     enabled: true,
//   },
//   {
//     name: 'UK — AI Training / Evaluation',
//     keywords: `
//       ("AI Trainer" OR
//        "AI Evaluator" OR
//        "AI Data Trainer" OR
//        "LLM Evaluator" OR
//        "AI Content Specialist" OR
//        "AI Training Specialist" OR
//        "AI Quality Analyst")
//       NOT Senior
//       NOT Lead
//       NOT Principal
//       NOT Manager
//       NOT Director
//       NOT Head
//     `.replace(/\s+/g, ' ').trim(),
//     location: 'United Kingdom',
//     dateSincePosted: 'past_week',
//     enabled: false,
//   },
// ];

export interface JobSearchConfig {
  name: string;
  keywords: string;
  location: string;
  dateSincePosted: 'past_24h' | 'past_week' | 'past_month';
  enabled: boolean;
}

export const jobSearches: JobSearchConfig[] = [
  {
    name: 'UK — All Target Roles (Web, Learning Tech, AI)',
    keywords: `
      ("Frontend Developer" OR
       "Front-End Developer" OR
       "Web Developer" OR
       "JavaScript Developer" OR
       "TypeScript Developer" OR
       "Vue Developer" OR
       "Learning Technologist" OR
       "Digital Learning Developer" OR
       "E-learning Developer" OR
       "Learning Experience Designer" OR
       "Instructional Designer" OR
       "Learning Designer" OR
       "AI Trainer" OR
       "AI Evaluator" OR
       "AI Data Trainer" OR
       "AI Training Specialist" OR
       "AI Quality Analyst")
      NOT Senior
      NOT Lead
      NOT Principal
      NOT Staff
      NOT Manager
      NOT Director
      NOT Head
    `.replace(/\s+/g, ' ').trim(),
    location: 'United Kingdom',
    dateSincePosted: 'past_week',
    enabled: true,
  }
];
