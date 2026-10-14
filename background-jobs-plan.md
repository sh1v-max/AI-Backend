# Background Jobs Plan: PDF ingestion on a queue (BullMQ + Redis)

**Status:** **built and live** (BG.0–BG.6, 2026-10-06 → 10-15). Written 2026-10-05, finalised 2026-10-06. Phase 6 of the roadmap (topic [09-background-jobs-bullmq](topics/09-background-jobs-bullmq)). §9 is the record of what was built, tested and what bit; where the build differed from §2/§4/§11, §9 says so (e.g. chunk texts in the job, `getState()` for the last attempt, `uploadFile()` waiting for ready). §0 and §10–§12 describe the repo *before* the build. Nothing open: the Upstash count was read on 2026-10-15 (3.5K/500K for the month, see BG.5).

Same shape as [auth-jwt-plan.md](auth-jwt-plan.md): the problem, the design, rules, steps with tests, file list, what's left out, decisions, results log. §0 and §10–§12 exist so a fresh Claude session can start building without re-reading the whole codebase or re-doing the research.

## Contents

0. Start here (new session)
1. The problem in one picture
2. Design
3. Rules to follow while building
4. Roadmap (build order, with time, per-step tests)
5. File edits, file by file
6. Test checklist
7. What this plan deliberately does NOT cover
8. Decisions (made)
9. Results log
10. Code facts (what the code looks like today)
11. Implementation sketches
12. How to test (the setup that worked before)
13. Research facts + sources

---

## 0. Start here (new session)

**For Claude:** read [CLAUDE.md](CLAUDE.md) (always), then this file. You don't need to re-research Upstash/BullMQ/Render limits, they're in §13. Build **one step at a time** (BG.0 → BG.6), let Shiv review each, run its tests, fill in §9, then move on. Shiv commits and pushes himself; never run `git commit`/`git push`.

**Before BG.0, Shiv does (outside the code):**
- [ ] Create a free Upstash Redis database at upstash.com (no card). Region near Render's (Render's region is set on the service; pick the closest Upstash region). Copy the **`rediss://`** connection URL (TLS, two s's).
- [ ] Add to local `.env`: `REDIS_URL=rediss://...` and `BULLMQ_PREFIX=docmind-dev`.
- [ ] In the Upstash dashboard, check that eviction is **disabled** for the database (BullMQ needs `noeviction`).
- [ ] Add to Render → Environment: the same `REDIS_URL` and `BULLMQ_PREFIX=docmind`. (Can wait until BG.5, but nothing breaks if it's there early.)
- [ ] Run on Neon (SQL editor), **before** deploying any BG code:
  ```sql
  ALTER TABLE documents ADD COLUMN status TEXT NOT NULL DEFAULT 'ready';
  ALTER TABLE documents ADD COLUMN error TEXT;
  ```
- [ ] Optional cleanup noticed 2026-10-05: in `DATABASE_URL` (local `.env` and Render) change `sslmode=require` → `sslmode=verify-full`. Same behaviour, silences `pg`'s SSL warning.

**State of the repo when this plan was written:** `main` = `origin/main`, last commits `3cda5d5` (post12 notes) and `98319c0` (`/chat-stream` is POST now, verified live). Plus uncommitted doc edits (CLAUDE.md, this file). Live: API https://ai-backend-docmind.onrender.com, frontend https://docmind-jet.vercel.app. Auth is done (every repository read/delete takes a required `userId`).

---

## 1. The problem in one picture

Today `POST /upload` does all the work while the browser waits:

```
browser ── POST /upload ──► parse PDF ─► chunk ─► embed chunk 1 (Gemini, ~0.5–5 s)
                                                 ─► embed chunk 2
                                                 ─► ...
                                                 ─► embed chunk N
                                                 ─► insert documents row
        ◄────────────── 200 { documentId } ───────┘   (only now)
```

- A 30-chunk PDF keeps one HTTP request open for 15 s to a few minutes. Proxies (Cloudflare, Render) and browsers give up on very long requests.
- If the connection drops or Gemini fails on chunk 17, the work is lost and the user has to upload again.
- One retry for a Gemini 503 means retrying the whole upload.

**The idea of a queue:** split the work into the part someone is waiting for and the part nobody is waiting for.

```
browser ── POST /upload ──► parse + chunk (fast, ~100 ms)
                            insert documents row, status = 'processing'
                            add a job to the queue ──► Redis
        ◄── 202 { documentId, status: 'processing' }   (right away)

                 worker (same Node process on Render) ◄── takes the job from Redis
                            embed + store every chunk
                            status = 'ready'   (or 'failed' + error)

browser polls GET /documents every ~2 s while something is 'processing'
```

That's the "offline / online split": ingestion is offline work, chat is online work.

---

## 2. Design

### 2.1 The three words

| Word | What it is in DocMind |
|---|---|
| **Queue** | A named list in Redis (`ingest-pdf`). The API adds jobs to it. |
| **Job** | One unit of work + its data: `{ documentId, userId, chunks }`. Lives in Redis until it's done. |
| **Worker** | Code that takes jobs off the queue one at a time and runs them. Here: embed + store. |

BullMQ is the library that does the hard parts on top of Redis: atomic "take the next job", locks so two workers never run the same job, retries with backoff, and "stalled" detection (a worker died mid-job, so someone else picks it up).

### 2.2 Where the PDF lives between the request and the job (D2)

The job needs the document's content, and Redis shouldn't hold a 10 MB PDF.

**Parse and chunk in the request, put only the chunk texts in the job.**
- Parsing is fast (pdf-parse, milliseconds to ~1 s) and needs the bytes, which only exist in the request (multer memory storage).
- A scanned PDF with no text is rejected **immediately** with a 400, instead of becoming a "failed" job the user finds later. (Today an empty-text PDF gets stored with 0 chunks; BG.3 adds the 400.)
- Job data is plain text: a 50-page PDF is ~100–300 KB. Upstash's free limit is 10 MB per request and 256 MB total, and finished jobs are removed (§2.6).
- The slow part (embedding = Gemini calls) is exactly what moves to the worker.

### 2.3 Database change

One additive change to `documents`, same pattern as auth (additive, safe for the deployed code):

```sql
ALTER TABLE documents ADD COLUMN status TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE documents ADD COLUMN error TEXT;
```

- `DEFAULT 'ready'`: every existing document is instantly "ready", and the currently deployed code (which never writes `status`) keeps inserting ready documents. Nothing breaks between running the SQL and deploying.
- Values: `'processing' | 'ready' | 'failed'`. `error` holds a short, user-safe message for `'failed'` (never a raw stack/SQL; the full error goes to the terminal via `summarizeError()`).
- `chunk_count` and `text_length` are known at request time (after chunking), so the row is inserted with real numbers.
- `schema.ts`: `status: text('status').notNull().default('ready')`, `error: text('error')`, SQL in a comment beside it (house style). Still manual SQL, no drizzle-kit migrate (CLAUDE.md §5).

### 2.4 What "processing" means for the rest of the app (D5)

A document that's still processing has **some** of its chunks stored. Rules:

| Route | Behaviour for a processing (or failed) document |
|---|---|
| `GET /documents` | listed, with `status` (and `error`) so the UI can show it |
| chat, one document | **409** `This document is still processing. Try again in a moment.` / failed: **409** `This document failed to process. Delete it and upload it again.` |
| chat, all documents | only `ready` documents are searched: `searchSimilar` adds `documents.status = 'ready'` to the join it already has |
| `POST /quiz` | same 409s as chat; `sampleChunks` also filters on `ready` |
| `DELETE /documents/:id` | allowed. The worker must notice the document is gone (§2.5) |
| upload cap | processing and failed documents count toward the 5 / 10 cap (they exist; failed ones can be deleted) |

409 (Conflict) and not 404: the document exists and it's yours, it just isn't in a usable state. Someone else's document stays a 404 (auth rule unchanged), so the status check must come **after** the ownership check.

### 2.5 The worker must be safe to run twice (idempotent)

BullMQ retries a failed job, and a "stalled" job (the process died mid-job, e.g. a Render redeploy) is run again. If chunks 1–17 were stored before the failure, a naive retry stores 1–17 a second time and search returns duplicates.

**Rule: a job starts by deleting any chunks for its `documentId`, then inserts all of them.** Running it once or three times leaves the same result. That's idempotency from topic 16, built for a real reason.

Two more edge cases:
- **Document deleted while processing.** The worker checks that the document still exists (`getDocumentForUser(documentId, userId)`) before it starts and again before marking it ready. If it's gone, the worker deletes the chunks it stored and returns quietly (job "completed", nothing to do). Without this the chunks become orphans again, like the 65 cleaned up on 2026-10-05.
- **Ownership.** The job carries `userId` from `req.user.id`. The worker never trusts anything else, and still goes through the repositories with a required `userId` (rule from auth).

### 2.6 Job options

| Option | Value | Why |
|---|---|---|
| `attempts` | 3 | Gemini 503s ("high demand") are real and usually pass |
| `backoff` | `{ type: 'exponential', delay: 5000 }` | waits 5 s, then 10 s before retrying |
| `removeOnComplete` | `true` | the documents row is the record of truth; the chunk text shouldn't sit in Redis |
| `removeOnFail` | `50` (keep the last 50) | so failures can be inspected in the Upstash data browser |
| `jobId` | the `documentId` | the same document can't be queued twice (BullMQ ignores a duplicate jobId while one exists) |
| worker `concurrency` | 1 | Gemini free tier is rate limited; one document at a time is fine |
| worker `drainDelay` | 30 (seconds) | idle long-poll length; default 5 burns the command budget (§2.7) |
| worker `stalledInterval` | 300000 (5 min) | default 30 s; fewer idle commands |
| worker `lockDuration` | 60000 (60 s) | default 30 s; a slow Gemini call on a busy 0.1-CPU Render box shouldn't get the job marked stalled while it's still running. The lock is renewed automatically while the job runs |

After the **last** attempt fails, the worker's `failed` event sets `status = 'failed'` and a short `error`. (Check `job.attemptsMade >= job.opts.attempts` in the handler, because `failed` also fires for attempts that will be retried.)

### 2.7 Redis: Upstash free (D1), and its command budget

| Option | Cost | Good | Bad |
|---|---|---|---|
| **Upstash free** (chosen) | free, no card | works from Render **and** the laptop with one `rediss://` URL; data browser + command counter in the dashboard | **500K commands / month**, and BullMQ talks to Redis even when idle |
| Render Key Value free | free | same platform, no command limit | 25 MB, **data lost on every restart**, laptop needs its own Redis (no Docker here) |
| Postgres queue (pg-boss) | free | no new service | not BullMQ/Redis (the point of the phase); polling would keep Neon awake and burn its compute hours |

**The command budget is the real catch.** An idle BullMQ worker keeps asking Redis "any jobs?" With the defaults (`drainDelay` 5 s, stalled check every 30 s) that's roughly 20K commands a day, ~600K/month if the worker never slept: over the free 500K.

What brings it under:
1. **Tuned worker** (§2.6): `drainDelay: 30`, `stalledInterval: 300000`. Roughly 3–4K commands per idle day, ~100K/month even awake 24/7.
2. **Render free spins the API down after ~15 min without requests,** and the worker lives in that process (§2.8), so most of the day it isn't polling at all.
3. **Local dev polls too** while `npm run dev` runs. Fine for working sessions; don't leave it running for days. `RUN_WORKER=false` in `.env` turns the local worker off when not working on Phase 6.

These are estimates from BullMQ's defaults. **Measured in BG.1 (2026-10-06, bullmq 6, 300 s idle windows): default ~34K/day (~1.02M/month 24/7, 204% of the free plan), tuned ~5.5K/day (~164K/month 24/7, 33%).** Details in §9. If the free limit is ever hit, Upstash refuses commands (no bill without a card): uploads fail with 503, chat keeps working.

**Local and production share the one free Upstash database.** Without care, the laptop's worker would take production's jobs (and vice versa). Fix: BullMQ's `prefix` option per environment (`BULLMQ_PREFIX=docmind-dev` locally, `docmind` on Render), so they're separate queues in the same Redis. Note both still write to the **same Neon database** (CLAUDE.md §5), so test data created locally is real data.

### 2.8 Where the worker runs (D4)

Render's free tier has no background worker service (only web services, Postgres and Key Value are free). So:

- The worker code lives in its **own module** (`src/workers/ingest.worker.ts`) with `startIngestWorker()`. It doesn't import Express and never touches `req`/`res`.
- `index.ts` starts it inside the API process unless `RUN_WORKER=false`. A separate entry point `src/worker.ts` + `npm run worker` also exists, so moving it to a real worker service later is a config change, not a rewrite.
- **Graceful shutdown:** Render sends `SIGTERM` on every deploy. The handler calls `await worker.close()` (waits for the current job), closes the queue and the Redis connections, then `process.exit(0)`. A job cut off anyway is picked up by the stalled check after the restart, and §2.5 makes running it again safe. Note `ts-node-dev --respawn` also restarts on file save; make sure the shutdown handler doesn't hang it.
- Honest limitation for the README: on the free tier the "background" worker shares a process (512 MB, 0.1 CPU) with the API. A heavy ingest can slow chat a little. The paid fix is one more Render service, no code change.

### 2.9 Status updates in the browser (D3)

No new route. `GET /documents` already returns the full rows, so it carries `status` and `error` once the columns exist. The frontend polls it every 2 s while any document is `processing`, and stops when none are. (The roadmap's `GET /documents/:id/status` is not needed; mention it in the walkthrough note as "replaced by polling the list".)

### 2.10 Libraries

- `bullmq` (queues, workers, retries, stalled jobs). Uses `ioredis` under the hood.
- `ioredis`, installed explicitly because we create the connections ourselves. Required BullMQ settings: `maxRetriesPerRequest: null` on the **worker's** connection; `enableOfflineQueue: false` on the **queue's** connection, so `/upload` fails fast with a clear 503 if Redis is down instead of hanging. That means two connections (the BullMQ docs recommend not sharing a blocking worker connection anyway).
- Upstash needs TLS: the URL starts with `rediss://`, and ioredis turns TLS on from that.

---

## 3. Rules to follow while building

1. The request does only what the user waits for: validate, parse, chunk, insert row, enqueue. Never call Gemini in `/upload` again.
2. The worker never touches `req`/`res`, and gets `userId` only from the job data, which only `/upload` writes (from `req.user.id`).
3. Every job is idempotent: delete the document's chunks first, then insert.
4. The worker checks the document still exists before starting and before marking it ready.
5. Search and quiz only ever read `ready` documents.
6. Never loop retries by hand: BullMQ's `attempts` + `backoff` does it, then `failed`.
7. Job data holds chunk text and ids, never the PDF bytes, never a token.
8. Remove completed jobs; keep a few failed ones for debugging.
9. Separate queue prefixes for local and production.
10. Every new code path logs through `pipelineLogger` (new `queue` theme, e.g. green), and job failures go through `summarizeError()`. Logging is a feature (CLAUDE.md §10).
11. Schema change = edit `schema.ts` + run the SQL on Neon by hand, additive first.
12. Measure the Redis command usage, don't assume it.
13. House style: heavy "why" comments, `BG.N —` marker comments on new code (like `Auth.N —`), new feature = own files, `index.ts`/`app.ts` stay small. `npx tsc --noEmit` after backend edits, `npm run build` in `frontend/` after frontend edits.

---

## 4. Roadmap (build order, with time, per-step tests)

| Step | What | Self-typed | With Claude |
|---|---|---|---|
| BG.0 | Prep: Upstash DB, env vars, packages, SQL, `schema.ts`, config | 30 min | 20 min |
| BG.1 | Learning script: a queue, a job, a worker, measure commands | 1 h | 30 min |
| BG.2 | Split `ingestPdf`, queue + worker modules, idempotent job | 2 h | 1 h |
| BG.3 | `/upload` → 202, status rules in chat / quiz / search / delete, start + shutdown in `index.ts` | 1.5 h | 45 min |
| BG.4 | Frontend: status badge, polling, disabled chat/quiz | 1.5 h | 45 min |
| BG.5 | Deploy: env on Render, live checks, command check after a day | 1 h | 45 min |
| BG.6 | Docs + topic 09 More_on re-check | 45 min | 30 min |
| | **Total** | **~8 h** | **~4.5 h** |

### BG.0: Prep
- Shiv's checklist in §0 (Upstash, env, SQL).
- `npm install bullmq ioredis`.
- `schema.ts`: `status` + `error` (§2.3). `config.ts`: `INGEST_QUEUE = 'ingest-pdf'`, `BULLMQ_PREFIX`, `RUN_WORKER`, job + worker options from §2.6, `DOCUMENT_POLL_MS = 2000` (frontend copy in its own config/const).
- `.env.example`: `REDIS_URL`, `BULLMQ_PREFIX`, `RUN_WORKER` with comments.
- **Test:** `npx tsc --noEmit`; the live app still lists and chats with existing documents after the SQL.

### BG.1: Learning script (`src/step5-bullmq.ts`, + `"step5"` npm script)
- Prefix `docmind-learn`. Creates a `hello` queue, adds 3 jobs (one throws on its first attempt, one throws every time), runs a worker with `attempts: 2`, logs each event (`active`, `completed`, `failed`, the retry), then closes everything and exits.
- Second part: leave a worker idle for ~2 min with default options, then ~2 min with the tuned ones; Shiv reads the Upstash command counter before/after each. Record the numbers in §9 and check §2.7's estimate.
- Safe: own prefix, touches no DB tables, cleans up its keys (`queue.obliterate()`).
- **Test:** the retry happens, the always-failing job ends up failed, the idle cost difference is visible.

### BG.2: Queue, worker, idempotent job
- `ingestion.service.ts` splits into `parsePdf(file)` → `{ text, chunks }` (request side; keep `parser.destroy()` in `finally`) and `embedAndStoreChunks({ documentId, userId, chunks })` (worker side). `pipelineLogger` calls move with their code.
- `src/queue/connection.ts` (two ioredis connections), `src/queue/ingest.queue.ts` (`ingestQueue`, `enqueueIngest()`), `src/workers/ingest.worker.ts` (`startIngestWorker()` returns the `Worker`; processor + `failed` handler).
- `documents.repository.ts`: `insertDocument(..., status)` (default `'ready'` so other callers don't change), new `setDocumentStatus(documentId, userId, status, error?)`. Both filter on `userId` like everything else.
- **Test (no HTTP yet, small script or `node -e`):** enqueue a job for a real test document; make the 2nd chunk throw once (temporary env flag, removed after) and check the retry leaves each chunk stored exactly once and `status = 'ready'`.

### BG.3: The API side
- `/upload`: `checkDocumentCap` → multer → mimetype check → `parsePdf` (400 if `text.trim()` is empty: "This PDF has no text layer…") → `insertDocument(..., 'processing')` → `enqueueIngest()` → **202** `{ documentId, filename, fileSizeBytes, textLength, chunkCount, createdAt, status: 'processing' }`. If enqueueing throws, delete the row and answer 503 `Upload queue is unavailable, try again shortly`.
- `DELETE /documents/:id`: delete the documents **row first**, then chunks + messages (closes the last race with a running job, see §9 BG.2).
- `chunks.repository.ts`: `searchSimilar` and `sampleChunks` add `eq(documents.status, 'ready')` to their existing `where(and(...))`.
- `chat.service.ts` `prepareChat()` (single-document branch) and `quiz.service.ts` `generateQuiz()`: after the ownership lookup, 409 if `status !== 'ready'` (§2.4 messages). Today both just return 404 when no chunks are found, so this needs a `getDocumentForUser()` call first.
- `index.ts`: `startIngestWorker()` unless `RUN_WORKER === 'false'`; `SIGTERM`/`SIGINT` → close worker, queue, connections, exit.
- **Test:** upload answers in well under a second with 202; the document turns `ready`; chat and quiz during processing get 409; deleting during processing leaves 0 chunks for it; a text-less PDF → 400; no token → 401 (unchanged); another user's document → 404 (unchanged).

### BG.4: The frontend
- `types/document.ts`: `status: 'processing' | 'ready' | 'failed'`, `error?: string`. `api/documents.ts`: map `status` + `error` in `fetchDocuments()` and `uploadDocument()`.
- `hooks/useDocuments.ts`: after an upload, and whenever any document is `processing`, poll `fetchDocuments()` every 2 s with a `setTimeout` loop inside a `useEffect` that depends on "is anything processing"; clear it on unmount and when nothing is processing. Log through `log.info('useDocuments', ...)`.
- `NewChatScreen.tsx` doc chips: "Processing…" (spinner) or "Failed" (with the error as the title + the existing delete button) instead of opening a chat.
- `App.tsx` starts a chat with the new document right after upload (`startNewChat(doc.documentId, doc.filename)`). Keep that, but `ChatView` shows a "Processing your PDF…" note and disables the composer and the Generate quiz button until the document is `ready` (it reads the live status from `documents`).
- `App.css`: the badge/spinner styles; check dark mode and mobile.
- **Test:** headless browser: upload, see Processing, see it turn Ready without a refresh, then chat works; a forced failure shows Failed; 0 console errors.

### BG.5: Deploy
- Render env vars (§0), push (Shiv), watch the first live upload in the Render logs.
- Check: upload → 202 fast → ready; chat; delete. Trigger a manual deploy mid-job → after restart the job finishes and `chunk_count` matches the rows.
- Next day: read the Upstash command count, compare with §2.7, record in §9.
- Push order: backend and frontend deploy separately (Render, Vercel). The new frontend handles both 200 and 202 the same (it just reads `status`, defaulting to `ready` if absent), so the order doesn't matter.

### BG.6: Docs
- CLAUDE.md (§3, §4 stack row for Redis/BullMQ, §5 env keys, §6 layout, §7 `/upload` 202 + 409s, §8 status column, §9 queue gotchas, §13 work log), README (flow diagram, setup incl. Upstash + SQL, the free-tier worker note), CODE_EXPLAINED (new BG section, verify links), PROGRESS (topic 09 ✅), walkthrough Phase 6 "how it turned out", roadmap ✅ note, §9 below. Topic 09's `More_on` re-checked ("will bite you" → "bit me"). NOTES.md stays Shiv's.

---

## 5. File edits, file by file

**New (backend):** `src/queue/connection.ts`, `src/queue/ingest.queue.ts`, `src/workers/ingest.worker.ts`, `src/worker.ts` (standalone entry), `src/step5-bullmq.ts`.

**Edited (backend):** `src/services/ingestion.service.ts` (split in two), `src/routes/documents.routes.ts` (`/upload` → 202), `src/repositories/documents.repository.ts` (status), `src/repositories/chunks.repository.ts` (`ready` filter), `src/services/chat.service.ts` + `src/services/quiz.service.ts` (409 for not-ready), `src/db/schema.ts`, `src/config.ts`, `src/index.ts` (start worker + shutdown), `src/utils/pipelineLogger.ts` (`queue` theme), `package.json` (deps + `step5` + `worker` scripts), `.env.example`, `tsconfig.build.json` (exclude `step5-bullmq.ts` like the other step scripts).

**Edited (frontend):** `types/document.ts`, `api/documents.ts`, `hooks/useDocuments.ts`, `components/chat/NewChatScreen.tsx`, `components/chat/ChatView.tsx`, `App.tsx` (pass status through), `App.css`.

---

## 6. Test checklist

1. Upload responds `202` in under a second, with `status: 'processing'`.
2. The document becomes `ready` and its `chunk_count` matches the rows in `chunks`.
3. A forced failure on one chunk is retried, and every chunk is stored exactly once.
4. A job that fails all 3 attempts leaves `status = 'failed'` with an error, and the UI shows it.
5. Chat with a processing document → 409; "all documents" chat ignores it.
6. `/quiz` on a processing document → 409.
7. Deleting a processing document leaves 0 chunks once the job ends.
8. A scanned PDF (no text) → 400 straight away, no job created.
9. A second user still can't see, chat with or delete the first user's document (404, auth rules unchanged).
10. Redis down (bad `REDIS_URL`) → `/upload` answers 503 quickly; chat still works.
11. Killing the server mid-job → after restart the stalled job finishes and the counts are right.
12. Local and production queues don't take each other's jobs (prefixes).
13. Upstash command count after a day roughly matches §2.7.

---

## 7. What this plan deliberately does NOT cover

- A separate paid worker service (the code allows it; the free tier doesn't).
- Pushing status to the browser (SSE / websockets). Polling every 2 s is enough here.
- Per-chunk progress ("12 of 30 embedded"). Easy later with `job.updateProgress()`.
- A Bull Board dashboard. The Upstash data browser is enough for now.
- Rate-limiting Gemini calls across users (BullMQ's `limiter` option). Worth it if 429s show up.
- Batch embeddings (one Gemini call for many chunks). A separate speed-up, not a queue topic.
- Moving to `drizzle-kit migrate`. Still manual SQL (CLAUDE.md §5 suggests a baseline "before the next schema change"; deliberately not mixed into this phase).

---

## 8. Decisions (made 2026-10-06: Shiv asked to record the recommendations as the plan)

| # | Question | Decision |
|---|---|---|
| D1 | Redis: Upstash free, Render Key Value free, or a Postgres queue? | **Upstash free**, tuned for the command budget (§2.7) |
| D2 | What goes in the job: chunk texts (parse in the request) or the PDF itself? | **Chunk texts** (§2.2) |
| D3 | Status updates: poll `GET /documents`, or a new `GET /documents/:id/status`? | **Poll `GET /documents`**, no new route (§2.9) |
| D4 | Worker inside the API process on Render, with a separate entry point for later? | **Yes** (§2.8) |
| D5 | Chat/quiz on a processing document: 409 or 404? | **409** with a clear message; someone else's stays 404 (§2.4) |

If Shiv changes one, update the section it points to before building.

---

## 9. Results log (fill in while building)

| Step | Date | Commit | What was done, what was tested, what bit |
|---|---|---|---|
| BG.0 | 2026-10-06 | | **Done.** Shiv's §0: Upstash DB in **Oregon `us-west-2`** (same AWS region as the Render service; Neon is in Ohio `us-east-2`, a pre-existing ~50–70 ms per query cross-US hop, left alone), local `.env` has `REDIS_URL` + `BULLMQ_PREFIX=docmind-dev`, Render has `REDIS_URL` + `BULLMQ_PREFIX=docmind`, `sslmode=verify-full` in both (pg's SSL warning gone). SQL run on Neon (a second run gave `42701 column already exists`, harmless: the first run had worked). Verified with a read-only script: both columns correct (`status` NOT NULL default `'ready'`, `error` nullable), all 3 documents `ready`; Redis `PING` → `PONG`, `maxmemory_policy: noeviction`, ~250 ms round trip from the laptop (India → Oregon; on Render it's same-region). What bit: Upstash's CLI tab was copied (`redis-cli --tls -u redis://...`) instead of the URL; then `redis://` (no TLS → Upstash hangs up, ioredis says "max retries per request"); and a `verify-fulle` typo that `pg` silently accepted. Code half: `npm install bullmq ioredis` → **bullmq 6.3.11** (the plan's research cited v5 docs) + ioredis 6.0.0, deduped to one copy (two copies = TS "incompatible connection" errors). Checked v6's types before relying on them: an ioredis instance is still accepted as `connection`, `drainDelay`/`stalledInterval`/`lockDuration`/`attempts`/`backoff`/`removeOn*` all still exist, `rediss://` still means TLS, and BullMQ still warns if a worker connection lacks `maxRetriesPerRequest: null`. v6 also lists `redis` and `pg` as optional peer backends (not used here). `schema.ts`: `status` + `error` with the SQL in a comment. `config.ts`: `INGEST_QUEUE`, `REDIS_URL`, `BULLMQ_PREFIX` (**no default on purpose**: a missing prefix on Render must not fall back to the dev queue; checked at startup in BG.2), `RUN_WORKER`, `INGEST_JOB_OPTIONS`, `INGEST_WORKER_OPTIONS` (typed with `satisfies`). `DOCUMENT_POLL_MS` not added to the backend (nothing there uses it), it goes in the frontend at BG.4. `.env.example` updated. `tsconfig.build.json` already excludes `src/step*.ts`, so `step5` needs nothing. `npx tsc --noEmit` clean. (Order mattered: from this `schema.ts` on, Drizzle selects/returns `status` + `error`, so local `GET /documents` and `/upload` would have failed until the SQL was run.) `npm audit` warnings are pre-existing dev deps (`ts-node-dev`, `drizzle-kit`), not the new packages. |
| BG.1 | 2026-10-06 | | **Done.** `src/step5-bullmq.ts` + `npm run step5` (prefix `docmind-learn`, no DB, obliterates its queues). Commands are counted client-side by wrapping `Redis.prototype.sendCommand` (catches pipelines and the connections BullMQ duplicates itself; probed first. Upstash's `INFO stats` counter said 7 after 17 sent, so it isn't used). **Part 1** (3 jobs, `attempts: 2`, fixed 2 s backoff): `greet` completed after 1, `flaky` failed once → retried 2 s later → completed after 2, `broken` failed for good after 2; Redis then held `completed: 2, failed: 1`, and the failed job kept `failedReason` + `data`. 30 commands for 3 jobs / 5 attempts (~6 per attempt: job cost is negligible, idle cost is what matters). **Part 2**, idle worker on an empty queue, 300 s each (300 not 120, so the tuned 5-min stalled check isn't flattered by a short window): **default options 118 commands → ~34K/day, ~1.02M/30 days awake 24/7 (204% of the free 500K)**; **tuned (`drainDelay 30`, `stalledInterval 300000`) 19 commands → ~5.5K/day, ~164K/30 days (33%)**. 6x fewer. Startup ~22 commands per process start either way. Both higher than §2.7's estimates (~20K/day default, 3–4K/day tuned), but the tuned worst case is comfortably under the limit, and Render's spin-down makes the real month lower. What bit: (1) in the `completed` event `job.attemptsMade` already includes the successful attempt on bullmq 6 (in the processor it doesn't yet), so `+1` there double-counted; (2) running the default and tuned measurements in parallel on the **same** queue name made the second run's `obliterate()` fail with "Cannot obliterate non-paused queue" (BullMQ refuses while a worker is attached): fixed by one queue per mode (`idle-default`/`idle-tuned`). |
| BG.2 | 2026-10-14 | | **Done (not wired to HTTP yet: `/upload` still works the old way via a thin `ingestPdf` = `parsePdf` + `embedAndStoreChunks` + `insertDocument`; BG.3 deletes it).** New: `queue/connection.ts` (two ioredis connections, created on first use, not on import; `getQueueSettings()` throws if `REDIS_URL`/`BULLMQ_PREFIX` is missing; `'error'` listener logs each distinct error once + "reconnected"), `queue/ingest.queue.ts` (`getIngestQueue()`, `enqueueIngest()` with `jobId = documentId`, `closeIngestQueue()`), `workers/ingest.worker.ts` (`processIngestJob`, `startIngestWorker`), `queue/shutdown.ts` (`closeQueueOnShutdown(worker)`: SIGTERM/SIGINT → `worker.close()` → queue → connections → exit, forced exit after `SHUTDOWN_TIMEOUT_MS` 20 s), `worker.ts` + `npm run worker`. Edited: `ingestion.service.ts` split, `documents.repository.ts` (`DocumentStatus` type, `insertDocument(..., status = 'ready')`, `setDocumentStatus()` returning **whether a row was updated**), `pipelineLogger.ts` (`queue` theme = green, `pipelineEnd(..., label)`), `config.ts` (`INGEST_FAILED_MESSAGE`, `SHUTDOWN_TIMEOUT_MS`), upload steps renumbered `/4`. **Two deliberate changes from §11's sketch:** (1) "deleted while processing" is detected by `setDocumentStatus` updating 0 rows instead of a second `getDocumentForUser` before it (check + update in one statement, no gap); (2) "last attempt?" is decided by `await job.getState() === 'failed'`, not `attemptsMade >= attempts`, because a job failed for stalling too often can end before its attempts run out and the document would stay `processing` forever. On final failure the partial chunks are deleted too. **Tested** (scratch script, real worker in-process, real Neon + Upstash, prefix `docmind-test`, a throwaway guest, 5-chunk text; everything deleted by id afterwards, 0 leftovers): A, chunk 2 throws once with real Gemini → retry → `ready`, 5 chunks, 5 distinct, 7 embed calls (1 ok + 1 throw + 5), state in the `failed` event = `delayed`; B, chunk 3 always throws → states `delayed, delayed, failed` → `status failed` + the message, 0 chunks; C, document deleted after its 1st chunk while chunks 2–5 were still coming → the worker's final UPDATE found no row → it removed its chunks, 0 left; D, same `documentId` enqueued twice → same job id, 1 job. **9/9.** Also: `src/worker.ts` starts and exits 0 on SIGTERM ("Queue closed cleanly"); with `BULLMQ_PREFIX` empty it refuses to start; `tsc --noEmit` + `npm run build` clean (`dist/worker.js` built). Not tested: `/upload` over HTTP (same code, moved; BG.3 tests it end to end). What bit: nothing in the code; the test file had to be written with the editor tool (a long bash heredoc failed to parse on Windows). **Found for BG.3:** `DELETE /documents/:id` deletes chunks *then* the row. A worker that stores its last chunk and runs its final UPDATE between those two queries would still see the row, mark it ready, and leave orphan chunks once the row goes. Fix in BG.3: delete the **row first**, then chunks + messages (then either the worker's UPDATE finds no row and cleans up, or the route's chunk delete runs after the worker is done). |
| BG.3 | 2026-10-14 | | **Done.** `/upload` → `queuePdfIngestion()` (replaces `ingestPdf`): parse → no-text check → `insertDocument(..., 'processing')` → `enqueueIngest()` → **202** `{ documentId, filename, fileSizeBytes, textLength, chunkCount, createdAt, status: 'processing' }`; enqueue failure → row deleted + **503**. `searchSimilar` + `sampleChunks` filter `documents.status = 'ready'`. New `services/documents.service.ts` → `checkDocumentReady()` (404 not yours → 409 processing/failed → ok), called by `prepareChat` (single-document mode, **before** embedding the question, so no Gemini call is wasted) and `generateQuiz` (before sampling). `getDocumentForUser` also returns `status`. All-documents chat with no ready document: "No documents are ready yet…". `DELETE /documents/:id` now deletes the **row first**, then chunks + messages. `index.ts`: fail fast without Redis settings, opens the queue at startup, starts the worker unless `RUN_WORKER=false`, `closeQueueOnShutdown()`. `enqueueIngest()` has a **5 s timeout** (`ENQUEUE_TIMEOUT_MS`): bullmq 6's source showed that with Redis unreachable since startup, `add()` waits forever for a first `ready`. **What bit:** (1) `pdf-parse` v2 adds a `-- 1 of 1 --` marker per page to `result.text`, so a PDF with **no** text layer returned 12 chars and 1 chunk and would have passed `!text.trim()`: `parsePdf` now returns `hasText` from the per-page texts. (2) **Crash recovery takes up to ~2 `stalledInterval`s, not one:** a stalled check only *marks* active jobs (pass 1), the next one *moves* those whose lock expired (pass 2), and a check sets a `stalled-check` throttle key for one interval, so the restarted worker's startup check was skipped (the killed process's throttle was still live). Measured: killed 15:54:11 with 2/5 chunks stored → resumed at +624 s (16:04:35, matching the predicted timeline) → `ready`, 5 rows, 5 distinct (idempotency held after a real crash). A stalled rerun doesn't use an attempt (log said "attempt 1/3"). Kept `stalledInterval` at 5 min (graceful shutdown covers normal deploys; a stalled check is ~1 command, so 60 s would cost roughly +4 commands per 5 min idle if it's ever wanted) and documented it in `config.ts`. **Tested over HTTP** (test server on 3099, prefix `docmind-test`, real Neon/Upstash/Gemini, 2 throwaway guests, 3-page generated PDF = 5 chunks + a drawn-only PDF): no token 401; text-less PDF 400 + no row; upload **202 in ~1.0 s** (from India; Neon is cross-US) with `processing`; `/chat`, `/chat-stream` (plain JSON) and `/quiz` while processing → **409** "still processing"; other guest → 404 chat, 404 delete; ready after ~10 s, `chunk_count` 5 = 5 rows; chat after ready → 200 "founded in 1874 by … Orla Vantris"; all-documents chat while a 2nd upload was processing → sources only from doc 1; delete while processing → 200, 0 chunks after the job ("deleted while processing — removing its chunks" in the log). **16/16.** Redis down (2nd server, unreachable `REDIS_URL`, `RUN_WORKER=false`): upload **503 in 7.4 s**, no leftover row, chat still 200, one `ECONNREFUSED` log line (deduped). Cleanup by recorded id: 0 docs/chunks/users left, 0 orphan chunks in the whole DB, `docmind-test:*` keys deleted. Noticed: worker and request logs now interleave in one terminal (the green queue colour keeps them readable). |
| BG.4 | 2026-10-14 | | **Done.** Built differently from §4's sketch because the frontend had moved on (UI.1–UI.6: the home screen is a chat box with an upload chip, and a question typed during an upload is queued as "Will ask" and sent when the upload finishes). **`uploadFile()` now resolves only when the document is READY** (not when the 202 arrives), so the chip ("Reading & indexing…"), the queued question and `App.handleUpload` work unchanged, exactly like the old single long request. `useDocuments`: polls `GET /documents` while any document is `processing` (effect keyed on the boolean, `setTimeout` chain, 2 s, slowing to 10 s after 60 s), a `listVersion` ref drops poll answers that started before a local upload/delete (otherwise a poll in flight could wipe a just-uploaded document from state), and a `waiters` map settles the waiting upload when its document turns ready/failed/disappears; gives up holding the chip after `READY_WAIT_MS` 2 min with a banner (the document keeps processing). Failed → the server's `error` in the banner and the queued question goes back into the box. `types/document.ts`: `DocumentStatus`, `status` + `error` on `UploadedDocument`, poll constants. `api/documents.ts`: maps `status`/`error`, defaults to `ready` if absent (a pre-Phase-6 backend), so deploy order can't break uploads. `App.tsx`: `readyDocuments` for the home chips, "All documents (N)", the scope picker and `handleChangeScope`; the sample button refuses a processing/failed copy; `handlePickDocument` backstop. Sidebar `DocumentList`: spinner + "Processing…" or red icon + "Failed" (reason in the title), not clickable, ⋯ menu offers only Delete when not ready; the cap still counts every document. `QuizPickerModal`: lists all, non-ready disabled with "still processing…"/"failed to process", focus skips disabled items, hover scoped to `:not(:disabled)`. No `ChatView` change was needed: with these guards no chat can start on a non-ready document (the server's 409 stays as the safety net). `tsc -b` clean, `npm run build` ok, oxlint: only the 2 pre-existing warnings (QuizModal, useChat). **Tested in headless Chromium** (Vite 5173 → test API 3099, prefix `docmind-test`, real Neon/Upstash/Gemini): sidebar "Processing…" while the worker ran, item disabled, a question sent mid-processing showed "Will ask", the chip and badge disappeared without a refresh, the queued question was sent and answered ("…founded in 1874 by … Orla Vantris"); a `processing` row inserted directly + page reload → spinner → flipped to "Failed" by polling after an UPDATE, reason in the hover title, ⋯ menu = only Delete, quiz picker disabled it and kept the ready one enabled, deleted via the menu; **11/11, 0 console errors**; screenshots checked in light, dark and mobile. What bit: Playwright 1.64 wanted Chromium build 1248 and only 1243 is installed: launched with `executablePath` to the installed one instead of downloading. A first test run crashed after creating a guest; the state file was then overwritten, so that guest was found by its printed id prefix + "created in the last hour, no data" and deleted only after exactly one match. Cleanup: 2 guests, their document + messages, `docmind-test:*` keys, both servers; 0 orphan chunks. |
| BG.5 | 2026-10-14 | `849251a` | **In progress.** Shiv pushed BG.3 (`3b0db1d`) + BG.4 (`849251a`) together. Live API answered after a 21 s cold start. **Live end-to-end, throwaway guest (deleted by id after): 9/9** — upload **202 in 2.5 s** (5 chunks, `processing`), chat while processing **409**, the Render worker made it **ready in 4.4 s** (vs ~10 s locally: Render↔Upstash are both in Oregon), `chunk_count` 5 = 5 rows, 5 distinct, chat after **200 in 1.5 s** ("…1874 … Orla Vantris"), quiz **200 with 5 questions in 2.1 s**, completed job removed from Redis, delete → 0 chunks, CORS preflight from the Vercel origin still 204. Live Vercel bundle contains the BG.4 code ("Processing…", "still processing", `doc-item-status`, the timeout banner, the stale-poll log line). **What bit: Render's `BULLMQ_PREFIX` is `docmind-dev`, not `docmind`.** Found because the queue check reported 0 keys under `docmind:ingest-pdf:*`; the only queue keys in Upstash were `docmind-dev:ingest-pdf:*`, with the live job's `active`/`completed` events at 13:42 UTC, and no local DocMind node process was running. So production and the laptop share one queue (a local `npm run dev` would compete for live users' jobs). The check itself only asserted "job hash gone", which is true under any prefix: a weak assertion, caught by reading the key count, not by the PASS. Fix: set `BULLMQ_PREFIX=docmind` on Render, then re-verify a live upload lands under `docmind:`. **2026-10-15: Shiv set `BULLMQ_PREFIX=docmind` on Render. Re-verified with a real prefix assertion** (the job's events in each queue's `<prefix>:ingest-pdf:events` stream, `jobId = documentId`): **10/10**, the live job's `added → waiting → active → completed` are in `docmind:` and none in `docmind-dev:`; upload 202 in 2.0 s, ready in 4.8 s, chat 200, quiz 200, delete → 0 chunks, guest deleted. (The API took ~140 s to answer: a cold start right after the env-change redeploy.) **Upstash command count (dashboard, read 2026-10-15): 3.5K of 500K for the month so far (0.7%)**, including every test run since 2026-10-06. Daily chart: Sat 10-10 → Tue 10-13 = **0** (no worker existed yet: BG.2 was code only, nothing ran one), Wed 10-14 ≈ **2.25K** = all of BG.2–BG.5's testing (test servers, the crash test, the browser test, the live checks) **plus** the live worker from the ~13:40 UTC deploy. Even that heaviest day, every day, would be ~68K/month (~14%); the §2.7 worst case (awake 24/7, tuned) was ~5.5K/day. A normal day should be lower, since Render sleeps the API (and the worker in it) after ~15 min idle. **Phase 6 closed.** |
| BG.6 | 2026-10-15 | | **Done.** CLAUDE.md (§3 state, §4 Queue row, §5 env keys + scripts, §6 layout, §7 `/upload` 202 + 409s + delete order, §8 `status`/`error`, §9 new "Background jobs" gotchas block, §11 doc map, §13 work log), README (ingestion flow diagram, API table, structure, setup incl. required `REDIS_URL`/`BULLMQ_PREFIX` + `RUN_WORKER`, Render notes, two decisions, limitations, next), CODE_EXPLAINED (new Phase 6 section BG.0–BG.5 with line links + TOC; Step 2.1/2.2 rewritten for the split ingestion; 177 drifted links re-mapped from a diff of each changed file since the doc's last update), PROGRESS (topic 09 ✅, 13's worker note), walkthrough Phase 6 (done, with what changed from the plan), roadmap Phase A (✅ how-it-turned-out notes), topic 09 More_on (status line, 13 "In DocMind" notes, §30 marked ✓/⚡ with 4 new things that bit). Checks: all 500 line links in CODE_EXPLAINED resolve to existing files/ranges; 827 relative links + anchors across the 8 edited docs resolve. **Found, pre-existing, not fixed (not BG):** CODE_EXPLAINED still links `UploadDropzone.tsx` (removed in the UI.1–UI.6 redesign) and its Step 2.x frontend/UI text describes the pre-redesign UI; a `step4-quiz-zod.ts#L54` link points at code that moved to `quiz.service.ts` in Step 4.2; CLAUDE.md has no work-log entry for UI.1–UI.6. NOTES.md for topic 09 stays Shiv's. |

---

## 10. Code facts (what the code looks like today, 2026-10-06)

So a new session doesn't need to re-read everything. Function names are the anchor; line numbers drift.

- **`src/services/ingestion.service.ts` → `ingestPdf(file, userId)`**: `new PDFParse({ data: file.buffer })` → `parser.getText()` → `chunkText(result.text)` → `randomUUID()` documentId → loop: `getEmbedding(chunk)` + `insertChunk(chunk, embedding, documentId)` with `detail`/`preview` logs → `insertDocument(documentId, userId, filename, size, textLength, chunkCount)` → returns `{ documentId, filename, fileSizeBytes, textLength, chunkCount, createdAt }`. `parser.destroy()` in `finally`. Logs are `step('upload', 2..5, 5, ...)`.
- **`src/routes/documents.routes.ts`**: `POST /upload` = `checkDocumentCap` (before multer, 403 over cap) → `upload.single('file')` (memory storage, `MAX_UPLOAD_BYTES` 10 MB → 413 via `app.ts`) → 400 no file / not `application/pdf` → `step('upload', 1, 5, ...)` → `await ingestPdf(req.file, req.user!.id)` → `res.json(document)`. Not wrapped in `withErrorHandling` (Express 5 forwards errors to the last-resort handler in `app.ts`). `DELETE /documents/:documentId` = `getDocumentForUser` (404) → `deleteChunksByDocumentId` → `deleteMessagesByDocumentId` → `deleteDocument`.
- **`src/repositories/documents.repository.ts`**: `insertDocument(id, userId, filename, fileSizeBytes, textLength, chunkCount)` (`.returning()`), `listDocuments(userId)` (`select()` all columns, newest first, so new columns appear automatically), `getDocumentForUser(documentId, userId)` (null for missing or not-yours), `countDocuments(userId)`, `deleteDocument(documentId, userId)`.
- **`src/repositories/chunks.repository.ts`**: `insertChunk(content, embedding, documentId)`; `sampleChunks(documentId, userId, n)` and `searchSimilar(embedding, limit, userId, documentId?)` both `innerJoin(documents, eq(chunks.documentId, documents.id))` with a `where(and(..., eq(documents.userId, userId)))`; that `and(...)` is where `eq(documents.status, 'ready')` goes. `deleteChunksByDocumentId(documentId)` has no owner column (caller checks ownership first).
- **`src/services/chat.service.ts` → `prepareChat({ documentId, message, sessionId, userId }, t0)`**: validates input (400s), `searchAll = documentId === ALL_DOCUMENTS`, embeds, `searchSimilar`, returns `{ ok: false, status: 404 }` when 0 chunks. Never touches `res`; both chat routes send the response. The 409 check goes here for the single-document case.
- **`src/services/quiz.service.ts` → `generateQuiz()`**: rejects `'all'` (400), `sampleChunks(documentId, userId, CHUNKS_FOR_QUIZ)`, 404 when none. The 409 check goes before `sampleChunks`.
- **`src/index.ts`**: `import 'dotenv/config'`, `app`, `PORT`, `getJwtSecret()` (fail fast), `app.listen`. ~10 lines: keep it small, put start/shutdown wiring in a helper if it grows.
- **`package.json` scripts**: `dev` (`ts-node-dev --respawn --transpile-only src/index.ts`), `build` (`tsc -p tsconfig.build.json`), `start` (`node dist/index.js`), `step3`, `step4`, `test`. Must stay strict JSON.
- **Frontend:** `api/documents.ts` maps the backend `id` → `documentId` in `fetchDocuments()` (add `status`, `error`); `uploadDocument()` posts FormData via `authFetch` (no Content-Type). `hooks/useDocuments.ts` loads on mount, `uploadFile()` prepends the returned doc, `deleteDocument()`. `App.tsx` calls `startNewChat(doc.documentId, doc.filename)` right after a successful upload. `components/chat/NewChatScreen.tsx` renders `.doc-chip` / `.doc-chip-button` / `.doc-chip-delete`. `components/chat/ChatView.tsx` has the Generate quiz button (`disabled={quizLoading}`).

---

## 11. Implementation sketches

Starting points, not final code. Add the house-style comments when writing them for real.

```ts
// src/queue/connection.ts — BG.2
import IORedis from 'ioredis'
const url = process.env.REDIS_URL!   // rediss://... (TLS) for Upstash
// Worker: blocking commands, must wait through reconnects → maxRetriesPerRequest null (BullMQ requires it)
export const workerConnection = new IORedis(url, { maxRetriesPerRequest: null })
// Queue (used by /upload): fail fast if Redis is down instead of queueing commands in memory
export const queueConnection = new IORedis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false })
```

```ts
// src/queue/ingest.queue.ts — BG.2
import { Queue } from 'bullmq'
export interface IngestJobData { documentId: string; userId: string; chunks: string[] }
export const ingestQueue = new Queue<IngestJobData>(INGEST_QUEUE, {
  connection: queueConnection,
  prefix: BULLMQ_PREFIX,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: true,
    removeOnFail: 50,
  },
})
export function enqueueIngest(data: IngestJobData) {
  return ingestQueue.add('ingest', data, { jobId: data.documentId })
}
```

```ts
// src/workers/ingest.worker.ts — BG.2
import { Worker } from 'bullmq'
export function startIngestWorker() {
  const worker = new Worker<IngestJobData>(
    INGEST_QUEUE,
    async (job) => {
      const { documentId, userId, chunks } = job.data
      if (!(await getDocumentForUser(documentId, userId))) return      // deleted before we started
      await deleteChunksByDocumentId(documentId)                       // idempotent: clean slate on every attempt
      await embedAndStoreChunks({ documentId, userId, chunks })        // the slow Gemini part
      if (!(await getDocumentForUser(documentId, userId))) {           // deleted while we worked
        await deleteChunksByDocumentId(documentId)
        return
      }
      await setDocumentStatus(documentId, userId, 'ready')
    },
    {
      connection: workerConnection,
      prefix: BULLMQ_PREFIX,
      concurrency: 1,
      drainDelay: 30,
      stalledInterval: 300_000,
      lockDuration: 60_000,
    },
  )
  worker.on('failed', async (job, err) => {
    console.error(`[ingest worker] job ${job?.id} attempt ${job?.attemptsMade} failed: ${summarizeError(err)}`)
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await setDocumentStatus(job.data.documentId, job.data.userId, 'failed', 'Could not process this PDF. Delete it and upload it again.')
    }
  })
  return worker
}
```

```ts
// src/index.ts — BG.3 (keep it short; a helper is fine)
const worker = process.env.RUN_WORKER === 'false' ? null : startIngestWorker()
async function shutdown(signal: string) {
  console.log(`${signal} received, closing the worker...`)
  await worker?.close()            // waits for the job in progress
  await ingestQueue.close()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
```

```ts
// src/routes/documents.routes.ts — BG.3, the new end of POST /upload
const { text, chunks } = await parsePdf(req.file)
if (!text.trim()) return res.status(400).json({ error: 'This PDF has no text layer (scanned image?). Only typed or exported PDFs are supported.' })
const documentId = randomUUID()
const document = await insertDocument(documentId, userId, req.file.originalname, req.file.size, text.length, chunks.length, 'processing')
try {
  await enqueueIngest({ documentId, userId, chunks })
} catch (err) {
  console.error(`[POST /upload] enqueue failed: ${summarizeError(err)}`)
  await deleteDocument(documentId, userId)
  return res.status(503).json({ error: 'Upload queue is unavailable, try again shortly' })
}
res.status(202).json({ ...summaryOf(document), status: 'processing' })
```

---

## 12. How to test (the setup that worked before)

From the auth and POST-/chat-stream work. Saves re-discovering the gotchas.

- **Local test server on a spare port** so it doesn't clash with Shiv's `npm run dev`: run in the background `PORT=3099 npx ts-node-dev --transpile-only src/index.ts > <scratchpad>/server.log 2>&1`. Check the port is free first (`netstat -ano | grep :3099`).
- **Stopping it:** `TaskStop` on the background task is **not enough**, the node process survives. Find the PID (`netstat -ano | grep -E ":(3099|5173)\s.*LISTEN"`) and `Stop-Process -Id <pid> -Force` (PowerShell), after checking the PID's start time is yours.
- **The DB is production:** local `.env` = the live Neon database. Every guest a test creates is a real `users` row. **Record every id you create and delete only those ids** (never by time window). Throwaway guest: `POST /auth/guest`, take `token` + `user.id`.
- **A test PDF with a real text layer**, no files needed: a ~25-line Node script that writes a minimal one-page PDF (Helvetica, a few `BT ... Tj ET` lines, correct xref offsets). One was used on 2026-10-05 (photosynthesis text, 1 chunk). For BG tests make it longer (several pages or ~1,500+ words → 3+ chunks) so retries and partial inserts are visible.
- **curl on Windows:** `curl -F "file=@<path>"` needs a **Windows** path: use `$(cygpath -w <path>)`, otherwise the upload silently never reaches the server.
- **dotenv 17 in `node -e` scripts:** `require('dotenv').config({ quiet: true })`, or its banner ends up in captured output.
- **Cleanup script pattern:** `pg` `Pool` from `.env`; `DELETE FROM chat_messages WHERE user_id = $1`; `DELETE FROM users WHERE id = $1 AND is_guest = true AND email IS NULL`; documents/chunks through `DELETE /documents/:id` with the test token (it also removes chunks + messages). With BG, also check the Upstash data browser has no leftover test jobs under the dev prefix.
- **Headless browser:** Playwright installed in the session scratchpad (`npm i playwright@1`), launched with `chromium.launch({ channel: 'chromium' })` (the installed Chromium; the default headless shell isn't downloaded). Frontend: `VITE_API_URL=http://localhost:3099 npx vite --port 5173 --strictPort` (5173 is the CORS-allowed origin in `.env`). Seed the token with `page.addInitScript(t => localStorage.setItem('docmind:token', t), token)`. The doc chip button needs `getByRole('button', { name: 'file.pdf', exact: true })` (the delete button's label also contains the filename). Loading the page **without** a token creates a new guest: record and delete it too.
- **Live checks** (after Shiv pushes): health `GET /`, a throwaway guest (deleted after), CORS preflight from `https://docmind-jet.vercel.app`, and the frontend bundle grep (`curl` the `/assets/index-*.js` from the Vercel HTML and grep for the new code). The auth limiter allows 20 `/auth/*` requests per 15 min per IP; tests count against Shiv's IP.

---

## 13. Research facts + sources (checked 2026-10-05)

- **Upstash Redis free plan:** 256 MB data, **500K commands per month**, 10 GB monthly bandwidth, 10 MB max request, 100 MB max record, 10,000 commands/s, 1 database. No card for the free plan; entering a card upgrades to pay-as-you-go. ([pricing](https://upstash.com/pricing/redis))
- **Upstash on BullMQ:** "BullMQ accesses Redis regularly, even when there is no queue activity", which costs commands. Upstash recommends a fixed paid plan for BullMQ; on the free plan the answer is tuning + a worker that sleeps. ([Upstash BullMQ docs](https://upstash.com/docs/redis/integrations/bullmq))
- **BullMQ worker defaults:** `drainDelay` 5 (seconds, long-poll when the queue is empty), `stalledInterval` 30000 ms, `maxStalledCount` 1, `concurrency` 1, `lockDuration` 30000 ms, `autorun` true. ([WorkerOptions](https://docs.bullmq.io/api/interfaces/v5.WorkerOptions.html))
- **BullMQ in production:** `maxRetriesPerRequest: null` for workers' ioredis connections; `maxmemory-policy noeviction` on Redis (BullMQ breaks if Redis evicts its keys; during BG.0 check in the Upstash dashboard that **eviction is disabled** for the database); `enableOfflineQueue: false` on Queue connections so calls fail fast; close workers on `SIGINT`/`SIGTERM`. ([going to production](https://docs.bullmq.io/guide/going-to-production))
- **Render free:** web services spin down after ~15 min without traffic (cold start on the next request); one free Key Value per workspace, not persisted to disk (data lost on restart), 25 MB; **no free background workers**. ([Render free docs](https://render.com/docs/free), [Render community](https://community.render.com/t/confused-about-the-free-tier/19092/2))
