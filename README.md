# Engineering Knowledge Copilot

A RAG system that indexes a codebase (manual upload or a live GitHub repo)
and answers engineering questions with citations down to the exact file and
line — grounded, hybrid retrieval, a real reranker, a code dependency graph,
JWT auth + RBAC, multi-provider LLM support, an evaluation harness, an
automated test suite, and a Docker deployment. Every piece below has been
run against the real stack (Postgres 16 + pgvector, Redis 7, BullMQ), not
mocked — the "verified" claims in this doc mean an actual curl request or
test run produced that result.

## Architecture

```
                    React frontend (Vite)
                            │
                            ▼
                  Express API (Node/TS)
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
  PostgreSQL 16         Redis 7              BullMQ
  + pgvector      (cache, rate limit,     ingestion queue
  (HNSW index +     repo-job progress)         │
  full-text search)                            ▼
        ▲                                 ingestion worker
        │                            (chunk → embed → store,
        └────────────────────────────  + dependency edges)
```

- **Retrieval**: pgvector cosine similarity (HNSW index) + Postgres
  full-text search (`tsvector`/`ts_rank`), fused, then reranked by a real
  BM25 second-stage pass (`src/reranker.ts`).
- **Ingestion**: async via a real BullMQ queue backed by Redis — not an
  in-process stub. `POST /documents` returns `202 PENDING` immediately; a
  separate worker process (or the API's own in-process one, for a
  one-command dev setup) consumes the queue.
- **Dependency graph**: regex-based import/require extraction for
  JS/TS/Python, with self-healing resolution (a file can be ingested before
  the file it imports — resolution retries at both write time and read
  time, so a query is always correct regardless of ingestion order).
- **Citations**: every answer returns exact `{filePath, startLine, endLine}`
  plus a token-overlap faithfulness check flagging citations the answer
  doesn't actually support.
- **LLM providers**: Anthropic, OpenAI-compatible (also covers
  Groq/Together/OpenRouter/Ollama/Azure via `OPENAI_BASE_URL`), Gemini, and
  an offline extractive Mock — selectable per-request, with automatic
  fallback to Mock if the requested provider has no key configured.

## Run it

### Docker (closest to production)

```bash
cp .env.example .env
# edit .env -- JWT_SECRET is required, LLM provider keys are optional
docker compose up --build
```

Frontend on `http://localhost:8080`, API on `http://localhost:4000`. Scale
ingestion workers independently of the API with
`docker compose up --scale worker=3`.

**Honest caveat**: `docker-compose.yml` and both Dockerfiles were written
and YAML/syntax-validated, and the backend's production build
(`npm run build && node dist/server.js`) was run for real against live
Postgres/Redis in this environment and confirmed working end-to-end — but
there's no Docker daemon in the sandbox this was built in, so the compose
file itself has not been run. If `docker compose up` surfaces an issue, it's
most likely a compose-specific detail (networking, healthcheck timing), not
the application code, which has been verified independently.

### Local dev (no Docker)

Needs PostgreSQL 16+ with the `pgvector` extension installed, and Redis.

```bash
# one-time setup
createuser eng_copilot -P   # set password, update DATABASE_URL below if different
createdb eng_copilot -O eng_copilot
psql eng_copilot -c "CREATE EXTENSION vector;"

cd backend
npm install
export DATABASE_URL="postgresql://eng_copilot:<password>@localhost:5432/eng_copilot"
export REDIS_URL="redis://localhost:6379"
export JWT_SECRET="$(openssl rand -base64 32)"
npm run dev          # http://localhost:4000 -- schema auto-creates on boot

# in another terminal
cd frontend
npm install
npm run dev           # http://localhost:5173
```

Fastest way to see it work end-to-end:
```bash
npm run seed-demo                          # creates a user/org/project + 3 sample docs
npm run evaluate -- <projectId-it-prints>  # real Precision@K/Recall@K/MRR numbers
npm test                                   # 22 automated tests against the real stack
```

## LLM providers — bring your own model

| Provider | Env var | Notes |
|---|---|---|
| Anthropic (Claude) | `ANTHROPIC_API_KEY` | Verified live in this environment |
| OpenAI-compatible | `OPENAI_API_KEY` (+ optional `OPENAI_BASE_URL`, `OPENAI_MODEL`) | Covers OpenAI, Groq, Together, Fireworks, OpenRouter, Mistral, local Ollama, Azure OpenAI — implemented against the standard `/chat/completions` shape, not network-tested from this sandbox |
| Google Gemini | `GEMINI_API_KEY` | **Verified live** — used by the project owner directly; also caught and fixed a real bug this way (a deprecated default model name returning a 404, which was crashing the whole process before an Express-4 async-handler fix was added) |
| Mock (offline, extractive) | none — always on | Composes the answer from the top retrieved chunks verbatim; zero hallucination risk, no fluent prose |

`GET /api/v1/projects/:id/chat/providers` reports which are configured (no
keys leaked) for the frontend's model picker. `POST .../chat` accepts an
optional `provider`/`model` per request; requesting an unconfigured provider
falls back to Mock visibly (the response's `provider`/`model` fields show
what actually ran), not silently.

## Security

Found and fixed during development, each with a **regression test**, not
just a code review:

1. **Privilege escalation** — an org ADMIN could grant themselves (or
   anyone) the OWNER role via `POST /organizations/:id/members`. Fixed:
   only an existing OWNER can assign OWNER. (`test/security.test.ts`)
2. **IDOR** — `GET /chat/:conversationId` checked the caller was a VIEWER of
   *some* project but never verified the conversation belonged to the
   project in the URL, so any user could read another org's conversation by
   guessing/reusing a conversationId. Fixed: scoped to the URL's project.
   (`test/security.test.ts`)
3. **No brute-force protection** — `/auth/login` had no rate limiting.
   Fixed: 10 attempts / 15 min per IP, backed by real Redis
   `INCR`+`EXPIRE`. (`test/security.test.ts`)

Also: a startup warning if `JWT_SECRET` is unset (the fallback value is
public in this source), CORS currently wide-open (fine for dev, restrict
before any real deployment — `docker-compose.yml` doesn't set this either),
and no JWT revocation (a stolen token is valid for the full 7-day expiry
with no logout/blacklist mechanism).

## What's real vs. explicitly not built

| Component | Status |
|---|---|
| PostgreSQL + pgvector | **Real** — HNSW index, verified with live queries |
| Redis (cache, rate limit, job progress) | **Real** — verified via `redis-cli` inspection during testing |
| BullMQ ingestion queue + worker | **Real** — verified processing real jobs, plus a standalone `worker.ts` entrypoint for independent scaling |
| Postgres full-text search (keyword retrieval) | **Real** — `tsvector`/`ts_rank`, not a JS token-overlap loop |
| BM25 reranker | **Real** algorithm (Okapi BM25), not a neural cross-encoder — no model host was reachable from the build environment. Swappable: `rerank()` in `src/reranker.ts` is the one function to replace |
| Code dependency graph | **Real** regex-based extraction (JS/TS/Python), with a genuine race condition found via testing and fixed with read-time re-resolution |
| Automated tests | **Real** — 22 tests, unit + integration, run against the live stack, stress-tested for reliability across repeated runs |
| Docker deployment | Written and YAML-validated; **not run** (no Docker daemon in the build sandbox) |
| GitHub ingestion | **Real** — hits the actual GitHub API; verified via a genuine `403 rate-limit` response from `api.github.com` |
| OpenAI/Gemini providers | Implemented against documented API shapes; OpenAI not network-tested, Gemini **was** (live, by the project owner) |

## Module map

```
backend/src/
  db.ts              PostgreSQL connection + schema (vector column, HNSW index, tsvector/GIN index)
  auth.ts            bcrypt + JWT, startup warning for the insecure default secret
  rbac.ts            authenticate + authorize(minRole) middleware
  asyncHandler.ts     closes Express 4's async-handler-crashes-the-process gap
  chunking.ts        code-aware (function/class boundary) + prose (windowed) chunkers
  embeddings.ts      EmbeddingProvider interface + offline hashing implementation
  ingestion.ts       parse -> chunk -> embed -> store -> extract dependency edges
  queue.ts           BullMQ queue + worker wiring, graceful shutdown
  worker.ts          standalone worker process entrypoint (docker-compose `worker` service)
  github.ts          GitHub API client (tree listing + raw file fetch)
  retrieval.ts       hybrid search: pgvector + Postgres full-text search, fused, reranked
  reranker.ts        real Okapi BM25 second-stage reranking
  dependencyGraph.ts import/require extraction + neighbor/full-graph queries, self-healing resolution
  citations.ts       token-overlap faithfulness check
  llm.ts             LLMProvider interface: Anthropic/OpenAI-compatible/Gemini/Mock
  cache.ts           Redis-backed answer cache
  rateLimit.ts       Redis-backed rate limiter (chat + auth)
  repoJobs.ts        Redis-backed repo-ingestion job progress
  app.ts             Express app definition (importable by tests, no listen())
  server.ts          schema init, worker startup, listen
  routes/            auth, orgs+projects, documents, chat, repositories, dependencies
backend/test/
  chunking.test.ts, reranker.test.ts, dependencyGraph.test.ts   -- unit tests, no DB
  security.test.ts, pipeline.test.ts                             -- integration, real Postgres/Redis
backend/evaluation/
  questions.json, run.ts   Precision@K, Recall@K, MRR, citation coverage
frontend/src/
  api.ts             typed fetch client
  App.tsx            auth gate + sidebar + tabbed project workspace
  components/        AuthScreen, Sidebar, ChatView, DocumentsPanel, RepositoriesPanel, DependencyGraphPanel, StatsBar
```


