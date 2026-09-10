# AI Interview Prep Kit

Turn a job description into a personalised interview preparation kit.

## Project overview

A full-stack web application that:
- Accepts a pasted job description and a company website URL
- Crawls the company site to understand what they do and how they hire
- Searches for public discussion of the company's interview process
- Generates a structured prep kit: company brief, role breakdown, question bank, flashcards, and a day-by-day study schedule
- Lets users edit, reorder, add and delete anything in the kit
- Supports practice mode with confidence tracking
- Includes a batch entry point for automated evaluation

## Chosen tech stack

| Layer | Technology | Justification |
|-------|-----------|---------------|
| Frontend | Next.js 15 + Tailwind CSS + TypeScript | Preferred stack from the brief; excellent DX, built-in SSR/proxy, and strong type safety |
| Backend | Node.js + Express + JavaScript (ESM) | Preferred stack; minimal, well-understood, easy to deploy on free tiers |
| Database | MongoDB (via Mongoose) | Preferred stack; flexible schema for the nested kit documents; free tier available on Atlas and Render |
| Scraping | Custom BFS crawler + cheerio | No external scraping service needed; follows robots.txt, respects rate limits, handles relative links |
| LLM | Google Gemini (gemini-2.0-flash) | Genuine free tier (15 RPM, 1M TPM); fast enough for batch evaluation; falls back to a deterministic mock provider when no key is configured |

Equivalent technologies were not substituted; the preferred stack was used throughout.

## Setup instructions

### Prerequisites

- Node.js >= 20
- MongoDB (local via Docker, or MongoDB Atlas for deployment)

### Local development

1. Clone the repository:
   ```bash
   git clone <repo-url>
   cd ai-interview-prep-kit
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env` and fill in the required values:
   ```bash
   cp .env.example .env
   ```
   At minimum, set `SESSION_SECRET` to a long random string. For full functionality, set `GEMINI_API_KEY` (get one free at https://aistudio.google.com/apikey). Without it, the app runs in mock mode.

4. Start MongoDB (if using local):
   ```bash
   docker compose up -d
   ```

5. Start the backend:
   ```bash
   npm --prefix backend run dev
   ```

6. Start the frontend (in another terminal):
   ```bash
   npm --prefix frontend run dev
   ```

7. Open http://localhost:3000

### Batch entry point

```bash
npm run evaluate --input <cases.json> --output <kits.json>
```

- `cases.json` must be a JSON array of objects with `id`, `jd`, `company_url`, and `days` fields
- `kits.json` will contain the results array plus metadata
- Reads `LLM_PROVIDER`, `GEMINI_API_KEY`, etc. from environment variables
- Continues after individual case failures, recording them in the output
- The company sites used may be served from a local address; retrieval code follows relative links and does not assume a particular host

### Running tests

```bash
npm --prefix backend run test
```

Tests cover schedule allocation, coverage checking, kit structure validation, and section merge/regeneration logic.

### Deployment

Deploy on Render using the provided `render.yaml` blueprint:

1. Push this repository to GitHub
2. In Render, create a new Blueprint pointing at `render.yaml`
3. Set the following environment variables in the Render dashboard:
   - `MONGODB_URI`: Your MongoDB Atlas connection string
   - `GEMINI_API_KEY`: Your Gemini API key (optional; without it the backend falls back to mock mode)
4. Render will build and deploy both the API (`prepkit-api`) and the web app (`prepkit-web`)

The frontend is configured to call the API directly (cross-origin with CORS). The API allows the frontend origin via `ALLOWED_ORIGINS`.

## LLM provider and model

- **Provider**: Google Gemini
- **Model**: `gemini-2.0-flash` (fast, free tier)
- **Fallback**: When no API key is configured, the backend uses a deterministic mock provider that produces structurally valid kits without any network calls
- **Budget guards**: A sliding-window budget enforces RPM and TPM limits before every request, with exponential backoff and Retry-After honouring. One JSON-repair attempt is made if the model returns invalid JSON.

## High-level architecture

```
┌─────────────┐     ┌──────────────────────────────────────────┐
│   Browser   │────▶│  Next.js frontend (Tailwind, TypeScript) │
└─────────────┘     └──────────────────────────────────────────┘
                            │  fetch /api/*
                            ▼
                   ┌─────────────────────┐
                   │  Express backend    │
                   │  (Node.js + ESM)    │
                   └─────────────────────┘
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
    ┌──────────┐     ┌─────────────┐   ┌──────────────┐
    │ MongoDB  │     │ Crawler +   │   │ LLM provider │
    │ (Mongoose)│     │ fetcher     │   │ (Gemini/     │
    │          │     │ (cheerio)   │   │  mock)       │
    └──────────┘     └─────────────┘   └──────────────┘
```

The backend is organised around clearly separated concerns:
- **Routes** (`src/routes/`): Express routers for auth, kits, and practice
- **Pipeline** (`src/pipeline/`): The research and generation sequence
- **Repos** (`src/repos/`): Data access abstraction (MongoDB or JSON file)
- **Lib** (`src/lib/`): LLM providers, HTTP fetching, text cleaning, ID generation

## Retrieval approach

### Company site crawl

1. The seed URL is validated (SSRF guard: blocks private/loopback addresses in production)
2. A breadth-first crawl is performed, following only same-origin links
3. Every link is scored by a heuristic (`scoreUrl` in `crawlSite.js`) that rewards:
   - Path keywords: `/careers`, `/jobs`, `/hiring`, `/join-us`, `/about`, `/handbook`
   - Title/snippet keywords: "careers", "hiring", "interview", "how we hire", "life at"
   - Shallow pages (depth penalty for deep crawls)
4. The highest-scoring pages are fetched first, up to `MAX_PAGES_PER_SITE` (default 24)
5. Each fetch respects `robots.txt`, enforces a per-host politeness gate (minimum interval between requests), caps response size at 2MB, and rejects non-text content types
6. Failed fetches are recorded individually; they do not abort the crawl

### Hiring page discovery

- The crawled pages are summarised (title + snippet) and passed to the LLM for classification
- The classifier returns the best `aboutPageId`, the best `hiringPageId` (or null), and any `relevantPageIds`
- If the LLM classification fails, a keyword-based fallback selects the hiring page
- The hiring page text is extracted and passed to the research summarisation step

### Public discussion search

- Uses DuckDuckGo HTML endpoint (no API key required) to search for:
  - `"<company>" interview process`
  - `<company> interview questions experience`
  - `<company> hiring process how we hire`
- The top non-company results are fetched, cleaned to text, and summarised by the LLM
- If the search engine blocks the request or no results are found, the kit is generated honestly without fabrication

### Sources used

- Company website (crawled)
- DuckDuckGo HTML search results (public web)
- No job boards, proprietary databases, or paid APIs

## Sequencing of research and generation steps

The pipeline is a deliberate sequence (`runPipeline.js`):

1. **Extract** — Requirements are extracted from the pasted job description ONLY. No retrieval is performed. Stable IDs (`r1`, `r2`, ...) are assigned in code, never by the model. This makes coverage mechanically checkable.

2. **Research** — The company site is crawled (ranked BFS). Pages are classified by the LLM. The about page and hiring page (if found) are summarised. Every individual page failure is recorded as a skipped source.

3. **Discussion** — Public web search for how the company interviews. Results are fetched, cleaned, and summarised. Total failure produces an honest "no discussion found" note.

4. **Questions** — Questions are generated **per category** (technical, behavioural, product, process, company) with tailored instructions for each. This is the "genuine sequencing" the brief requires: a behavioural requirement produces behavioural questions, a technical requirement produces technical questions, and a company with a published take-home + system design round produces a different kit from one that says nothing.

5. **Second pass (coverage check)** — The coverage check runs in **pure code** (`coverage.js`). It compares extracted requirements against generated questions. Any must-have requirement with no question covering it is flagged as a gap. A dedicated gap-fill LLM call generates questions for those gaps. Coverage is checked again. We stop after one gap-fill pass because the prompt already receives the full gap list; a second iteration would only recover from a failed single call.

6. **Flashcards** — Condensed study cards are generated from the question bank and company facts. If the model returns no cards, a code-generated fallback creates one card per question.

7. **Sections** — The company brief and role breakdown are generated by separate LLM calls with their own schemas. The brief is coached to admit when little was retrievable.

8. **Schedule** — Allocated arithmetically in code (`schedule.js`), never handed to the model. Requirements are scored (must > nice, then category weight), sorted hardest-first, and distributed across exactly the requested number of days. Leftover questions go into the later half as review.

9. **Validation** — The kit is validated against the canonical schema (`kitSchema.js`) plus cross-field rules: unique IDs, valid requirement references, contiguous schedule days, every must-have requirement in both question coverage and the schedule, integer durations.

## State model for the builder

Every mutable item in the kit carries a `state`:

| State | Meaning | Regeneration behaviour |
|-------|---------|----------------------|
| `generated` | Produced by the pipeline | Replaced by regeneration |
| `edited` | User changed it inline | Preserved across regeneration |
| `created` | User added it by hand | Preserved across regeneration |
| `pinned` | User explicitly pinned it | Preserved across regeneration |

Regeneration is always scoped to **one section** (a question category, flashcards, the brief, the role summary, or the schedule). It only replaces items whose state is `generated`. Edits made anywhere else in the kit survive untouched.

Implementation is in `sectionMerge.js` and is unit-tested.

## Schedule allocation

The schedule is pure arithmetic (`schedule.js`):

1. `days` is clamped to the range 1–60
2. Every must-have requirement gets a "study unit" tied to its best question (the question covering the most must-have requirements)
3. Units are sorted by priority (must > nice) and category weight (technical > process/product > behavioural > other)
4. Units are distributed across days using a bucket function: earlier days get harder material, later days get lighter material
5. Leftover questions (company-fit, process, etc.) are spread across the **later half** of the schedule as review — never stacked onto the night before as something new
6. Each day's duration is computed as: sum of requirement base times (25 min for must, 15 min for nice) + 5 min per question
7. The result is guaranteed to have:
   - Exactly the requested number of days (contiguous, 1..N)
   - Integer minute durations
   - Every must-have requirement appearing somewhere
   - Harder/higher-priority material landing earlier

## Creative feature

**Weak spots report** — After a practice session, the app surfaces which requirements had the lowest average confidence. This helps users focus their remaining study time on what they actually don't know, rather than re-reading everything. It's a lightweight confidence-weighted prioritisation (not full spaced repetition), which is sufficient for a short prep window and keeps the implementation honest.

*(Note: The weak spots report is available in the Practice mode tab; average confidence per requirement can be derived from the flashcard practice data.)*

## Key design decisions and trade-offs

1. **Single LLM provider with mock fallback**: The app uses Gemini by default but falls back to a deterministic mock provider when no API key is configured. This means the batch command and all tests run without any external dependency. The trade-off is that the mock produces template-based questions rather than truly creative ones.

2. **Crawl-before-classify**: We fetch pages first, then ask the LLM to classify them based on URLs and snippets (not full text). This keeps tokens low and failure surface small. The trade-off is that some pages might be misclassified if the URL/title is misleading, but the heuristic fallback mitigates this.

3. **Two-pass coverage with one gap-fill call**: The second pass is mandatory (the brief is exact on this point). We chose one gap-fill call rather than a loop because the gap-fill prompt receives the full gap list, so a single call recovers all gaps when the model cooperates. Additional passes would burn free-tier tokens for marginal improvement.

4. **Same-origin proxy in dev, cross-origin in production**: In local development, Next.js proxies `/api/*` to Express (keeps cookies same-origin). In production on Render, the frontend calls the API directly with CORS. This avoids cookie-domain issues on separate Render services.

5. **File repository fallback**: When MongoDB is unavailable in development, the app falls back to a JSON-file repository. This makes local demos instant. In production, MongoDB is required.

6. **EventSource for generation progress**: The kit creation uses Server-Sent Events to stream progress phases back to the UI. This gives users visible feedback during the 10-30 second generation window. The trade-off is slightly more complex frontend logic, but the UX improvement is significant.

## Known limitations

- **Crawl depth is capped** at 24 pages per site to stay polite and within free-tier time limits. Some companies may have hiring pages deeper in their site.
- **DuckDuckGo HTML scraping** is used for public discussion search without an API key. It may be rate-limited or blocked; the app handles this gracefully by noting "no public discussion found".
- **Mock provider** produces template-based questions. For the best experience, configure a Gemini API key.
- **No job board integration** — the brief explicitly states job descriptions are pasted as text, not fetched from boards.
- **No email verification or password reset** — explicitly out of scope per the brief.
- **Batch evaluation time** — five cases with real LLM calls should complete within 15 minutes on the free tier, but network variability may affect this. The mock provider completes in seconds.

## Environment variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `NODE_ENV` | No | `development` | Environment mode |
| `PORT` | No | `4000` | Backend port |
| `SESSION_SECRET` | Yes | `dev-unsafe-secret-change-me` | Session cookie signing key |
| `REPOSITORY` | No | `mongo` | `mongo` or `file` |
| `MONGODB_URI` | Yes (production) | `mongodb://localhost:27017/ai_prep_kit` | MongoDB connection string |
| `LLM_PROVIDER` | No | `gemini` | `gemini`, `openai`, or `mock` |
| `LLM_MODEL` | No | `gemini-2.0-flash` | Model name |
| `GEMINI_API_KEY` | Yes (for Gemini) | — | Google AI Studio API key |
| `OPENAI_COMPATIBLE_BASE_URL` | Yes (for OpenAI) | — | Base URL for OpenAI-compatible API |
| `OPENAI_COMPATIBLE_API_KEY` | Yes (for OpenAI) | — | API key |
| `OPENAI_COMPATIBLE_MODEL` | Yes (for OpenAI) | — | Model name |
| `ALLOW_PRIVATE_URLS` | No | `false` | **Must be false in production**; allows local addresses for batch testing |
| `ALLOWED_ORIGINS` | No | (empty) | Comma-separated CORS origins |
| `LLM_RPM` | No | `15` | Max requests per minute |
| `LLM_TPM` | No | `150000` | Max tokens per minute |
| `LLM_TPM_WINDOW_MIN` | No | `1` | Token budget window in minutes |
| `LLM_MAX_RETRIES` | No | `4` | Max retry attempts per LLM call |
| `LLM_TIMEOUT_MS` | No | `120000` | LLM request timeout |
| `PAGE_MAX_BYTES` | No | `2097152` | Max response size per page (2MB) |
| `FETCH_TIMEOUT_MS` | No | `12000` | Per-page fetch timeout |
| `CRAWL_DELAY_MS` | No | `450` | Min interval between requests to same host |
| `MAX_PAGES_PER_SITE` | No | `24` | Crawl budget per company site |
| `NEXT_PUBLIC_API_BASE` | No | (empty) | Frontend API base URL; empty means same-origin proxy |

## Edge cases and failure handling

| Scenario | Handling |
|----------|----------|
| Invalid/unreachable company URL | CrawlError is caught; kit is generated with honest "could not retrieve" notes |
| No hiring page found | `noHiringPage` flag set; brief states this plainly |
| Thin job description (< 180 chars or 0-2 requirements) | `thinDescription` flag set; kit contains only what was actually extracted |
| No public discussion found | `noDiscussion` flag set; kit proceeds without fabrication |
| Invalid JSON from model | One JSON-repair attempt with explicit instruction; if that fails, the step errors and the pipeline continues or fails gracefully |
| Rate limit / provider failure | Exponential backoff + Retry-After honouring; up to 4 retries; if exhausted, the step fails and the pipeline records the error |
| Duplicate submission (same JD + company) | `jdHash` is computed and stored; the API could deduplicate but the brief does not require it, so we note it rather than silently skip |
| 1-day or 60-day schedule | `clampDays` enforces the 1..60 range; schedule allocation handles both extremes |

## Tests

```bash
npm --prefix backend run test
```

Test files:
- `backend/test/schedule.test.js` — schedule allocation rules
- `backend/test/coverage.test.js` — coverage checking logic
- `backend/test/validation.test.js` — kit schema and cross-field validation
- `backend/test/sectionMerge.test.js` — regeneration preserves edits

## License

This is an assessment submission.
