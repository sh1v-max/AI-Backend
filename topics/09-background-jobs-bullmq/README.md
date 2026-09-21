# 09 — Background Jobs (BullMQ)

Right now `POST /upload` makes the browser wait while the server does *everything*: parse the PDF, chunk it, and then embed each chunk with its own API call — one after another. For a 3-page PDF that's a few seconds. For a 60-page PDF it's a long, blocking request that can time out, and if the server restarts halfway through, the work is simply lost. This topic is how real systems fix that: **the request hands the work to a queue and returns immediately; something else does the work in the background.**

---

## The idea: online work vs offline work

There are two very different kinds of work in DocMind:

- **Online work — a human is waiting.** Chat. They asked a question and are watching the screen. It has to run *now* and (ideally) stream.
- **Offline work — nobody is waiting on the result this second.** Ingesting a PDF. The user needs it to be *done* before they can chat with it, but they don't need to sit inside one HTTP request for it.

Name it exactly like that in an interview: *"Ingestion is offline work, so it runs on a queue. Chat is online work, so it runs inline and streams."* The split is the whole point of the phase.

## The three words: queue, job, worker

- **Queue** — an ordered to-do list that lives outside your web server (in Redis).
- **Job** — one item on that list: a name plus a small blob of data (`{ documentId, filePath }`).
- **Worker** — a *separate process* that pulls jobs off the queue and runs them.

```
BEFORE:   browser ──POST /upload──► [ parse → chunk → embed × N → store ] ──► response (slow)

AFTER:    browser ──POST /upload──► save file, create document row (status: processing),
                                    add job to queue ──► response "202, processing" (instant)
                                            │
                                            ▼
                                       Redis queue
                                            │
                                            ▼
          worker process ──► [ parse → chunk → embed × N → store ] ──► mark status: ready
          browser ──GET /documents/:id/status (poll) ──► "processing" … "ready"
```

## Why Redis, and what BullMQ is

A queue needs somewhere durable and fast to keep the list. **Redis** is an in-memory data store that's perfect for this. **BullMQ** is the Node library that turns Redis into a proper job system: adding jobs, running workers, **retrying failures with backoff**, limiting concurrency, and tracking job state (waiting / active / completed / failed). You don't hand-roll any of that.

The free option: **Upstash** — hosted Redis with a free tier, no card.

```ts
import { Queue, Worker } from 'bullmq'

const connection = { /* your Upstash connection */ }

// producer (in the API)
const ingestQueue = new Queue('ingest-pdf', { connection })
await ingestQueue.add('ingest', { documentId, filePath }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } })

// consumer (in worker.ts — a separate process)
new Worker('ingest-pdf', async (job) => {
  await ingestPdf(/* ... */)        // the function you already have
}, { connection, concurrency: 2 })
```

## How this fits the code you already have

- **`ingestPdf()` is already the right shape.** Because the earlier restructure pulled the pipeline out of the route into a plain function that never touches `req`/`res`, the worker can call it as-is. That was the reason for splitting it.
- **The `documents` table needs a `status` column** — `'processing' | 'ready' | 'failed'`. Unlike the multi-document feature (which avoided a migration), this one *does* need a schema change on the live table, so plan that step deliberately. The route creates the row **up front** with status `processing` and the worker flips it to `ready`.
- **`GET /documents/:id/status`** lets the frontend (or curl) poll. The UI shows "Processing…" and enables chat when it's `ready`.

## Things that will bite you (worth knowing before you hit them)

- **Redis can't hold a big file comfortably.** Don't put the PDF bytes in the job data. Put a *reference* in the job (a `documentId` + where the file is) and keep the bytes elsewhere. Locally a temp folder is fine.
- **…but a temp folder won't survive deployment.** On Render, the web service and the worker are *separate services with separate disks* — a file the API saved isn't visible to the worker. For Phase 10 you'll need shared storage (e.g. object storage, or storing the bytes in Postgres). Another option: parse in the request (it's fast) and put the extracted text/chunks in the job instead of the file. Decide this consciously.
- **Make jobs safe to run twice (idempotent).** Retries mean the same job can run again after failing *halfway* — leaving some chunks already inserted. On retry, delete the document's existing chunks first, or you'll get duplicates. (This is the same class of problem as the orphaned chunks that showed up in the multi-document work: partial ingestion leaves data nobody can see.) A job that fails for good should set `status: 'failed'`.
- **BullMQ has connection requirements.** The Redis connection a *Worker* uses must be configured with `maxRetriesPerRequest: null`, and Upstash needs its TLS (`rediss://`) URL. Read the BullMQ connection docs when you set it up.
- **Watch the free tier.** Workers poll Redis, and on Upstash's free plan that uses up your command allowance — keep an eye on usage in the dashboard, especially if you leave a worker running.
- **Two processes to run now.** `npm run dev` for the API and a second command (e.g. `npm run worker`) for `worker.ts`. Forgetting the worker looks like "my upload is stuck on processing forever."

## Where this connects

```
05 RAG            → upload pipeline exists, but blocks the request
09 (here)         → the same pipeline, moved off the request path onto a queue
13 deployment     → the worker becomes its own free Render background service
advanced/05       → rate limiting & retries: what to do when Gemini's free tier says "slow down"
```

---

## What you need to learn

- [ ] **Online vs offline work** — and why ingestion belongs on a queue while chat doesn't
- [ ] **Queue vs job vs worker**, and what Redis's role is
- [ ] **Why the request returns immediately** with a `processing` status instead of waiting
- [ ] **Retries with backoff** — and what "idempotent" means for a job that might run twice
- [ ] **Why the job carries a reference, not the file** — and why that matters again at deployment time
- [ ] **How the frontend finds out it's done** — polling a status endpoint

## What to build

**Step 6.1** — set up a free Upstash Redis, connect BullMQ to it, and get a trivial job running end to end (add a job, see a worker log it) before touching the real pipeline.

**Step 6.2** — move PDF ingestion onto the queue. `POST /upload` saves the file and creates the `documents` row with `status: processing`, enqueues an `ingest-pdf` job, and returns immediately. A separate `worker.ts` process runs `ingestPdf()`, then marks the row `ready` (or `failed`). Add `GET /documents/:id/status`. Add the idempotent-retry cleanup.

**Frontend** — after upload, show "Processing…" and poll the status endpoint until it's `ready`, then open the chat.

## Resources

- [How to Build a Job Queue in Node.js with BullMQ and Redis](https://oneuptime.com/blog/post/2026-01-06-nodejs-job-queue-bullmq-redis/view)
- [Building a Scalable Queue System with BullMQ & Redis (YouTube)](https://www.youtube.com/watch?v=vFI_Nf2PWFQ)
- [BullMQ docs](https://docs.bullmq.io/) — especially the connection and "going to production" pages
- [Upstash](https://upstash.com) — free hosted Redis, no card needed

## After you finish

Fill in [NOTES.md](NOTES.md) — specifically, be able to explain the online/offline split out loud in one sentence, and what would go wrong if a retried ingestion job wasn't idempotent. Those two answers are what an interviewer is really probing when they ask "why a queue?"
