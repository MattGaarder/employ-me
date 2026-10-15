# employ-me

**An end-to-end, AI-assisted job search pipeline** that finds relevant LinkedIn roles, scores each one against my career profile, writes a tailored cover letter (also saved as a `.docx`), tracks everything in SQLite and Notion, and then uses an autonomous browser agent to fill in the application form.

```
LinkedIn ──► Scraper API ──► Seniority filter ──► Gemini evaluator ──► SQLite ◄──► Notion
                                                     │                   │
                                                     ▼                   ▼
                                              Cover letter .docx   Browser Use agent ──► Application form
```

---

## Built on top of

This project extends two open-source projects. Many thanks to their authors:

| Project | What it provides | How I extended it |
|---|---|---|
| [**atharv01h/Linkedin-Jobs-Api**](https://github.com/atharv01h/Linkedin-Jobs-Api) | Express + Puppeteer REST API for searching LinkedIn job listings | Rewrote much of `scraper.service.ts` to extract **full descriptions, post dates and external application URLs**. Added an **authenticated Chrome-profile fallback** that decodes LinkedIn's `safety/go` redirect links, plus request pacing and detection of LinkedIn rate limiting/restrictions |
| [**browser-use/browser-use**](https://github.com/browser-use/browser-use) | An LLM-driven browser automation agent | Embedded it in a **run lifecycle** reported to my own API, added **custom Ctrl+C / SIGTERM cancellation hooks**, retry/backoff tuning, a local LLM fallback, and a full **diagnostics/observability layer** |

Everything in `app/` and the orchestration in `browser-use/main.py` and `browser-use/diagnostics.py` is my own work.

---

## Features

### 1. Job import pipeline (`app/src/jobs`)
- Runs keyword searches defined in [`config/job-searches.ts`](app/src/config/job-searches.ts) (Boolean LinkedIn queries such as `("Frontend Developer" OR ...) NOT Senior`), each with its own location and date window
- Filters out senior, lead, principal and manager roles with a regex ([`filter.service.ts`](app/src/services/filter.service.ts))
- **Skips duplicates before doing any expensive work**: a `UNIQUE(source, source_job_id)` check runs before fetching details or calling the AI
- Handles failures per job, so one bad listing never stops a batch; each run is recorded in an `import_runs` table

### 2. AI job evaluator (`app/src/ai/evaluator.ts`)
- Uses **Google Gemini** (`@google/genai`) with **structured JSON output** (`responseSchema`), returning:
  - `fitScore` (0–100, on a defined scale from *very poor* to *exceptional*)
  - `fitExplanation` (strengths **and** significant gaps)
  - `coverLetter`
- Prompt design ([`prompt.ts`](app/src/ai/prompt.ts)):
  - Grounded in a written **career profile** (`career-profile.md`) and a **voice and style guide** of real past cover letters (`cover-letter-examples.md`)
  - Strict guardrails: *never invent experience, qualifications, employers or technologies*; weigh required vs. desirable skills; consider seniority and career direction
  - Style rules: open directly, show rather than tell, about 200–250 words, match the candidate's pacing
- **Validates the response at runtime** (integer range, field types) before anything is saved
- Can switch providers: a local **Ollama** (`qwen3.5`) path is kept for offline or zero-cost evaluation

### 3. Cover letter generator (`app/src/ai/cover-letter-generator.ts`)
- Turns the AI-written letter into a formatted **Word document** with the [`docx`](https://www.npmjs.com/package/docx) library (Arial 11pt, 1.15 line spacing)
- Builds filesystem-safe filenames (`GAARDER-<Company>-COVER.docx`), which the browser agent later finds and uploads

### 4. SQLite ⇄ Notion two-way sync (`app/src/services`)
SQLite (`better-sqlite3`) is the source of truth for the pipeline. Notion is the front end where I review jobs and manage the application queue.

| Direction | Script | Purpose |
|---|---|---|
| Notion → SQLite | `npm run sync:notion` | Picks up statuses I set by hand in Notion (e.g. marking a job `QUEUED` to apply, or `REJECTED`) |
| SQLite → Notion | `npm run sync:notion:reverse` | Pushes pipeline statuses (`RUNNING`, `COMPLETE`, `FAILED`, `CANCELLED`) back to Notion |

- Rows are matched by LinkedIn **source job ID**
- Statuses are checked against a typed `ApplicationStatus` list (`NOT_READY`, `QUEUED`, `RUNNING`, `COMPLETE`, `FAILED`, `CANCELLED`, `REJECTED`), and unknown values are skipped with a warning
- Safeguards stop the reverse sync from overwriting statuses set by hand in Notion
- New jobs are created in Notion with all properties, and long descriptions are split into chunks to fit Notion's 2,000-character block limit

### 5. Autonomous application agent (`browser-use/main.py`)
`npm run apply` syncs Notion → SQLite, then starts a Browser Use agent that:

1. **Claims** the oldest `QUEUED` job that has an application URL, in a single SQLite transaction (`POST /api/application-runs/claim`)
2. Reports **start → step-by-step progress → complete / fail / cancel** to the Express API
3. Fills the form from structured candidate data (`form-details.json`), with strict rules: *only answer dropdowns, radios and yes/no questions when the data supports it explicitly*
4. Uploads the **CV** and the **matching cover letter** for that job
5. Syncs the final status back to Notion

**Resilience:**
- Gemini retries with exponential backoff and jitter (12 attempts, 5s base, 120s cap) to ride out `503 UNAVAILABLE` spikes
- Falls back to a local Ollama model if Gemini can't be used
- 15-minute LLM timeout for long multi-step reasoning

### 6. Custom exit/cancellation handling
Browser Use installs its own asyncio signal handler. The first Ctrl+C pauses the agent; the second calls `os._exit(0)`. That **skips `atexit` and Python exception handlers**, which used to leave jobs stuck as `RUNNING` in both databases.

My first fix was editing `custom_exit_callback` inside `.venv`. A library upgrade then **silently overwrote it**: the new `Agent` accepts `**kwargs`, so the old argument was swallowed without an error.

The current fix is **upgrade-proof**. `main.py` subclasses browser-use's `SignalHandler` and replaces it at module level, **chaining** my cleanup in front of browser-use's own telemetry callback:

```python
class _EmployMeSignalHandler(_OriginalSignalHandler):
    def __init__(self, *args, custom_exit_callback=None, **kwargs):
        def chained_exit_callback():
            try:
                _cancel_on_exit()          # mark run CANCELLED, sync Notion, save diagnostics
            finally:
                if custom_exit_callback:
                    custom_exit_callback() # browser-use's own telemetry flush
        super().__init__(*args, custom_exit_callback=chained_exit_callback, **kwargs)

_bu_utils.SignalHandler = _EmployMeSignalHandler
```

An idempotency flag means cancellation runs **exactly once**, whether it is triggered by the signal handler, `atexit`, or a `KeyboardInterrupt`.

### 7. Run diagnostics and observability (`browser-use/diagnostics.py`)
- Wraps the LLM's `ainvoke` to record **request latency, status and token usage** for each step
- Separates **LLM latency from browser/page latency**
- Captures each step's goal, memory, evaluation, actions and results, plus token cost estimates
- For each run, writes `runs/<id>/run.log` (stdout/stderr tee'd to file), `history.json` and `diagnostics.json`, including for failed or cancelled runs

---

## Architecture

```
employ-me/
├── app/                         # My TypeScript backend (Express + SQLite)
│   └── src/
│       ├── ai/                  # Gemini evaluator, prompts, career profile, .docx generator
│       ├── application-runs/    # Run lifecycle: claim / start / progress / complete / fail / cancel
│       ├── jobs/                # Import pipeline, repository, controller
│       ├── integrations/        # LinkedIn scraper client, Notion client
│       ├── services/            # Seniority filter, SQLite ⇄ Notion sync
│       ├── db/                  # Schema + lightweight migrations
│       └── config/              # LinkedIn search definitions
├── Linkedin-Jobs-Api/           # Extended fork of atharv01h/Linkedin-Jobs-Api (Puppeteer scraper)
└── browser-use/                 # Python agent runner + diagnostics (uses browser-use library)
```

### REST API (`http://localhost:3001/api`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/jobs` | List jobs |
| `POST` | `/jobs/import` | Trigger an import |
| `POST` | `/application-runs/claim` | Atomically claim the next queued job |
| `POST` | `/application-runs/:id/start` | Mark run `RUNNING` (records browser-use version and model) |
| `PATCH` | `/application-runs/:id/progress` | Step progress updates |
| `POST` | `/application-runs/:id/complete` \| `/fail` \| `/cancel` | Final run states |
| `GET` | `/jobs/:jobId/application-runs` | Attempt history for a job |

### Data model
- **`jobs`**: listing details, AI fit score and explanation, cover letter, `application_status`, application URL
- **`application_runs`**: one row per attempt (attempt number, timings, duration, steps, model, browser-use version, final result or error, log and history paths)
- **`import_runs`**: one row per search run (found / new / duplicate counts, status, error)

---

## Getting started

### Prerequisites
- Node.js 20+, Python 3.12+ (developed on 3.14)
- A Google Gemini API key
- A Notion integration token and database
- *(Optional)* [Ollama](https://ollama.com) with `qwen3.5` for local fallback

### Setup
```bash
# Scraper API
cd Linkedin-Jobs-Api && npm install

# Backend
cd ../app && npm install

# Browser agent
cd ../browser-use
python -m venv .venv && source .venv/bin/activate
pip install browser-use requests python-dotenv
```

Create `app/.env`:
```env
GOOGLE_API_KEY=...
NOTION_TOKEN=...
NOTION_DATABASE_ID=...
# Optional
PORT=3001
DB_PATH=./data/employ-me.db
LINKEDIN_API_URL=http://localhost:3000
```
> The evaluator also reads `GOOGLE_API_KEY` from a project-root `.env`.

### Usage
```bash
cd app

npm run dev                    # Start scraper API (:3000) + employ-me API (:3001)
npm run import                 # Search → filter → evaluate → cover letters → SQLite + Notion

# In Notion: set "Application status" to QUEUED on jobs you want to apply to

npm run apply                  # Notion → SQLite sync, then launch the browser agent
npm run sync:notion:reverse    # Push SQLite statuses to Notion manually
npm run backfill:notion:descriptions # Backfill job descriptions from SQLite to Notion Description column
```

---

## Technologies

**Languages:** TypeScript, Python, SQL
**Backend:** Node.js, Express, `better-sqlite3`, `ts-node-dev`, `concurrently`
**AI / LLMs:** Google Gemini (`@google/genai`, structured output), Ollama (local LLMs), Browser Use agent framework
**Automation and scraping:** Puppeteer (+ stealth plugin), authenticated Chrome profiles, Chrome DevTools Protocol (via Browser Use)
**Integrations:** Notion API (`@notionhq/client`), `docx` document generation
**Tooling:** asyncio, `requests`, dotenv, Git

## Skills demonstrated

- **System design:** a multi-service pipeline (Node scraper, Node API, Python agent) linked by a REST contract and a shared run lifecycle state machine
- **Applied LLM engineering:** prompt design with grounding documents and anti-hallucination guardrails, schema-constrained JSON output, runtime validation, provider fallback, and retry/backoff for transient errors
- **Data engineering:** idempotent imports, deduplication by natural key, atomic queue claiming in transactions, schema migrations, and two-way sync with conflict safeguards
- **Debugging library internals:** traced a silent regression through browser-use's signal handling (`os._exit` skipping `atexit`, swallowed `**kwargs`) and replaced a fragile `.venv` patch with a monkey-patch that survives upgrades
- **Observability:** structured logging, per-step LLM and browser timing, token and cost accounting, and saved run artefacts
- **Web scraping:** reverse-engineering LinkedIn redirect URLs, authenticated session fallback, rate-limit awareness
- **Pragmatic engineering:** extending existing open-source projects rather than rebuilding them, with failure handling per item throughout

---

## Notes and disclaimer
This is a personal project for automating my own job search. Automated scraping and form submission may conflict with some websites' terms of service. Use responsibly, keep request rates low, and review applications before they are submitted.

## Credits
- [atharv01h/Linkedin-Jobs-Api](https://github.com/atharv01h/Linkedin-Jobs-Api): see its [LICENSE](Linkedin-Jobs-Api/LICENSE)
- [browser-use/browser-use](https://github.com/browser-use/browser-use)
