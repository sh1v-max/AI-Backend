# 09 — Background Jobs (BullMQ)

**Roadmap: Phase 6** · **Status in DocMind: not built yet.** Everything below is the concept plus how it would land in this codebase. Version-specific details (BullMQ options, Upstash limits) should be checked against current docs when you build it.

Code this file talks about: [documents.routes.ts](../../src/routes/documents.routes.ts) (`POST /upload`), [ingestion.service.ts](../../src/services/ingestion.service.ts) (`ingestPdf`)

---

# 1. What is a Background Job?

Right now upload looks like this:

```text
Browser → POST /upload
              ↓
          parse PDF
              ↓
          chunk
              ↓
          embed chunk 1  (API call)
          embed chunk 2  (API call)
          ...
          embed chunk N  (API call)
              ↓
          save document row
              ↓
Browser ← 200 (finally)
```

The browser waits for all of it. `ingestPdf()` embeds chunks **one at a time, in a loop**, so a 60-page PDF is dozens of sequential network calls inside one HTTP request.

A background job means:

> The request only writes down "this work needs doing" and returns. A different process does the work later.

```text
Browser → POST /upload → "noted, here's your documentId" (instant)

                 meanwhile, somewhere else:
                 worker → parse → chunk → embed → store → mark ready
```

---

# 2. Simple Analogy

### No queue

A restaurant where the waiter takes your order, walks into the kitchen, cooks it himself, and only then comes back. Nobody else can order while he cooks.

### Queue

```text
Waiter  → writes the order on a ticket → pins it on the rail → goes back to tables
Rail    → holds tickets in order
Cook    → takes the next ticket, cooks it, rings the bell
```

- **Waiter** = the API (the _producer_)
- **Ticket** = the job
- **Rail** = the queue (Redis)
- **Cook** = the worker (the _consumer_)
- **Bell / "your order is ready" screen** = status endpoint

If the cook burns a dish, he takes the same ticket again. That's a **retry**.

---

# 3. Online Work vs Offline Work

This split is the whole point of the phase.

```text
ONLINE   a human is watching the screen right now
         → run inline, ideally stream
         → DocMind: /chat, /chat-stream, /quiz

OFFLINE  nobody needs the result this second, they need it DONE
         → queue it
         → DocMind: PDF ingestion
```

One-sentence version for interviews:

> "Ingestion is offline work so it runs on a queue; chat is online work so it runs inline and streams."

---

# 4. What Goes Wrong Without a Queue

1. **Timeouts.** Proxies and hosts cut long requests. Render, browsers, and load balancers all have limits.
2. **Lost work.** Server restarts (deploy, crash, free-tier spin-down) halfway through → the request dies, half the chunks are in the DB, no document row. That's exactly how the **orphan chunks** in DocMind's database happened.
3. **No retry.** Gemini returns a 503 on chunk 37 of 60 → the whole upload fails and the user starts over.
4. **No backpressure.** Ten people upload at once → ten loops hammering the embedding API at the same time → rate limits.
5. **The web server is busy.** Node is single-threaded for JS. `pdf-parse` on a big file is CPU work that blocks every other request while it runs.
6. **Bad UX.** A spinner with no progress, for a minute.

A queue fixes all six.

---

# 5. The Three Words

```text
QUEUE   an ordered to-do list that lives OUTSIDE your web server (in Redis)
JOB     one item on that list: a name + a small JSON blob
WORKER  a SEPARATE PROCESS that takes jobs and runs them
```

Plus two roles:

```text
PRODUCER  whoever adds jobs      (the API)
CONSUMER  whoever processes them (the worker)
```

The producer and consumer never talk to each other. They only talk to Redis. That's the decoupling.

---

# 6. Before and After

```text
BEFORE
browser ──POST /upload──► [ parse → chunk → embed × N → store ] ──► 200 (slow)


AFTER
browser ──POST /upload──► create documents row (status: processing)
                          add job to queue
                     ◄──── 202 { documentId, status: "processing" }   (instant)
                                   │
                                   ▼
                              Redis queue
                                   │
                                   ▼
         worker ──► [ parse → chunk → embed × N → store ] ──► status: ready

browser ──GET /documents/:id/status (every 2s)──► processing … processing … ready
```

`202 Accepted` is the correct status: "I've accepted the request, the work isn't finished."

---

# 7. Why Redis?

A queue needs storage that is:

- **fast** (adding a job must cost almost nothing)
- **shared** (API and worker are different processes, maybe different machines)
- **atomic** (two workers must never grab the same job)

Redis is an in-memory key-value store with lists, sorted sets, and atomic operations (and Lua scripts that run atomically). That's a natural fit.

Could you use Postgres instead? Yes. `SELECT ... FOR UPDATE SKIP LOCKED` on a `jobs` table is a real pattern, and libraries like **pg-boss** and **Graphile Worker** do exactly that. The upside is no extra service. DocMind's roadmap uses Redis + BullMQ because it's the combination you'll meet most in Node job listings.

---

# 8. What is BullMQ?

Redis gives you lists. It doesn't give you retries, backoff, delays, concurrency limits, or job states. BullMQ is the Node library that builds a real job system on top of Redis:

- add jobs, with options
- run workers with a concurrency limit
- **retry failed jobs with backoff**
- delayed and repeating jobs
- rate limiting
- job state tracking and progress
- detection of "stalled" jobs (a worker died mid-job)

```bash
npm install bullmq ioredis
```

---

# 9. The Smallest Working Example

```ts
// queue.ts — shared by API and worker
import { Queue } from 'bullmq'
import IORedis from 'ioredis'

export const connection = new IORedis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null, // required for Workers (see §20)
})

export const ingestQueue = new Queue('ingest-pdf', { connection })
```

```ts
// producer — inside the API
await ingestQueue.add(
  'ingest',
  { documentId },
  {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  },
)
```

```ts
// worker.ts — a separate process: `npm run worker`
import { Worker } from 'bullmq'

new Worker(
  'ingest-pdf',
  async (job) => {
    console.log('processing', job.id, job.data)
    // do the work; throw to fail the job
  },
  { connection, concurrency: 2 },
)
```

Step 6.1 is literally this: get a trivial job to go from `add()` to a `console.log` in the worker **before** touching the real pipeline.

---

# 10. The Job Lifecycle

```text
            add()
              │
              ▼
          ┌────────┐   delay option   ┌─────────┐
          │ waiting│ ◄─────────────── │ delayed │
          └────────┘                  └─────────┘
              │ a worker picks it up        ▲
              ▼                             │ retry with backoff
          ┌────────┐      throws            │
          │ active │ ───────────────────────┘
          └────────┘
           │      │ throws, no attempts left
   returns │      ▼
           ▼   ┌────────┐
     ┌───────────┐ failed │
     │ completed │└────────┘
     └───────────┘
```

States: `waiting`, `delayed`, `active`, `completed`, `failed` (also `prioritized`, `waiting-children` for advanced features).

The rule is simple:

> **Processor function returns → completed. Processor function throws → failed (or retried).**

---

# 11. Job Options Worth Knowing

```ts
await queue.add('ingest', data, {
  attempts: 3, // total tries, not "retries"
  backoff: { type: 'exponential', delay: 2000 }, // 2s, 4s, 8s...
  delay: 5000, // don't start for 5s
  jobId: `ingest:${documentId}`, // dedupe: same id = not added twice
  priority: 1, // lower number = sooner
  removeOnComplete: { age: 3600, count: 100 }, // don't fill Redis with finished jobs
  removeOnFail: { age: 24 * 3600 }, // keep failures a day for debugging
})
```

Two of these matter a lot on a free Redis:

- `removeOnComplete` / `removeOnFail` — by default BullMQ **keeps** finished jobs forever. On a small free instance that's how you run out of memory.
- `jobId` — a free, built-in idempotency key (topic 16).

---

# 12. Retries and Backoff

```text
attempt 1 fails
   wait 2s
attempt 2 fails
   wait 4s
attempt 3 fails
   → job is "failed" for good
```

**Why wait?** If Gemini is overloaded (the 503 "high demand" you actually hit on 2026-09-27), retrying instantly just adds load and fails again. Waiting gives it time.

**Why exponential?** Short problems recover fast (2s is enough). Long problems need you to back off properly. Doubling handles both.

**Not every error should retry:**

```text
503 / 429 / network timeout    → retry (transient)
"this PDF has no text layer"   → don't retry (it will never work)
```

BullMQ has `UnrecoverableError` for the second kind:

```ts
import { UnrecoverableError } from 'bullmq'
throw new UnrecoverableError('PDF has no extractable text') // skips remaining attempts
```

More on this in [advanced/05](../advanced/05-rate-limiting-retries/More_on_Rate_Limiting_Retries.md).

---

# 13. At-Least-Once Delivery (the Big One)

A queue guarantees a job runs **at least once**. It does **not** guarantee exactly once.

How a job runs twice:

```text
worker starts job → inserts 20 of 40 chunks → Gemini 503 → throws
        ↓
retry → starts from the beginning → inserts all 40 chunks
        ↓
database now has 60 chunks for a 40-chunk document
```

Or: the worker finishes the work, then crashes before telling Redis "done". The job looks stalled and gets re-run.

So every job must be **idempotent**:

> Running it twice leaves the same result as running it once.

---

# 14. Making `ingestPdf` Idempotent

Options, simplest first:

**A. Clean first (recommended for DocMind).**

```ts
await deleteChunksByDocumentId(documentId) // already exists in chunks.repository.ts
// ...then parse → chunk → embed → insert
```

A retry wipes whatever the failed attempt left and starts clean.

**B. Transaction.** Wrap all inserts in one DB transaction so a failure rolls everything back. Clean, but it holds a transaction open across dozens of slow embedding calls, which is bad on a pooled serverless Postgres.

**C. Embed first, insert once.** Embed every chunk into memory, then do one bulk insert in a short transaction. Failures before the insert leave nothing behind. Good, costs RAM.

**D. Resume.** Track which chunk indexes are done and skip them. Most efficient, most code.

A + a final status flip is the right size for this project.

This is the same class of problem as the orphan chunks already in the DB: partial ingestion leaves data nobody can see.

---

# 15. The Schema Change

`documents` needs a status:

```sql
ALTER TABLE documents ADD COLUMN status text NOT NULL DEFAULT 'ready';
ALTER TABLE documents ADD COLUMN error text;
```

```text
processing → ready
          ↘ failed
```

Notes:

- `DEFAULT 'ready'` so the documents that already exist stay usable.
- Unlike Step 3.3 (which used the `'all'` sentinel to avoid touching the table), this one **does** alter the live Neon table. Plan it, and keep the equivalent SQL in the comment beside the table in [schema.ts](../../src/db/schema.ts) like the others.
- The row is now created **up front** by the route, not at the end by `ingestPdf()`. That's a real change to `ingestPdf`: today it generates the `documentId` and inserts the document row last. After this, it receives a `documentId` and finishes by updating the row.

A nice side effect: creating the row first means partial chunks always have a visible parent, so no more silent orphans.

---

# 16. What Goes in the Job? (Not the File)

Job data is serialized to JSON and stored in Redis. So:

```text
✗ { pdfBytes: <10 MB buffer> }      Redis is memory, and free tiers are tiny
✓ { documentId }                    a reference
```

Then where do the bytes live? Today multer uses **memory storage** (`file.buffer`), which only exists inside the API process. The worker is a different process and can't see it.

Options:

| Option                                                   | Works locally | Works deployed | Notes                                                    |
| -------------------------------------------------------- | ------------- | -------------- | -------------------------------------------------------- |
| Temp file on disk                                        | ✓             | ✗              | API and worker are separate services with separate disks |
| Object storage (S3-compatible, Supabase Storage, R2)     | ✓             | ✓              | the "proper" answer; one more service                    |
| Store bytes in Postgres (`bytea`)                        | ✓             | ✓              | simple, fine up to the 10 MB cap                         |
| **Parse in the request, put extracted text in Postgres** | ✓             | ✓              | parsing is the fast part; embedding is the slow part     |

The last one deserves attention. What's actually slow in `ingestPdf`?

```text
parse   → fast (a second or so)
chunk   → instant
embed   → SLOW (one API call per chunk, sequential)
```

So: parse in the request, save the raw text (or the chunks without embeddings) to Postgres, enqueue `{ documentId }`, and let the worker do only the embedding. No file ever has to cross between services. Tradeoff: CPU-heavy parsing still happens on the web process.

Decide this consciously. It's the question that matters at deployment.

---

# 17. How the Browser Finds Out

**Polling** (the roadmap's choice):

```text
GET /documents/:id/status → { status: "processing", progress: 40 }
GET /documents/:id/status → { status: "processing", progress: 80 }
GET /documents/:id/status → { status: "ready" }
```

Poll every 1–2 seconds, stop on `ready` or `failed`, and stop after a sensible maximum.

**Alternatives:**

- **SSE** — you already know how. `GET /documents/:id/events` streams progress. Needs the API to learn about worker progress (BullMQ `QueueEvents`, or just re-reading the DB row).
- **WebSocket** — overkill.
- **Webhook** — for server-to-server, not browsers.

Polling is fine here: it's simple, it survives refreshes, and the status lives in Postgres so any API instance can answer.

Progress is easy with BullMQ:

```ts
await job.updateProgress(Math.round(((i + 1) / chunks.length) * 100))
```

but for the status endpoint it's simpler to also write progress to the `documents` row, so the API doesn't need to ask Redis.

---

# 18. Concurrency and Rate Limiting

```ts
new Worker('ingest-pdf', processor, {
  connection,
  concurrency: 2, // 2 jobs at once in THIS worker
  limiter: { max: 10, duration: 1000 }, // at most 10 jobs per second across the queue
})
```

- `concurrency` works because the work is I/O (waiting on Gemini and Postgres). Node handles many waits at once. For CPU-heavy work, concurrency in one process doesn't help; you'd need more processes.
- `limiter` is per **job**, not per API call. One ingest job makes many embedding calls, so for Gemini's rate limits you still need pacing _inside_ the job (a small delay between chunks, or batch embedding).

This is the queue's hidden superpower: **it's a throttle.** Ten uploads become ten tickets processed two at a time, instead of ten simultaneous loops.

---

# 19. Stalled Jobs and Graceful Shutdown

A worker holds a **lock** on the job it's processing and renews it periodically. If the worker dies (crash, deploy, out of memory), the lock expires, the job is marked **stalled**, and it gets moved back to waiting.

That's another way a job runs twice. Idempotency again.

On shutdown, finish the current job instead of abandoning it:

```ts
process.on('SIGTERM', async () => {
  await worker.close() // stops taking new jobs, waits for active ones
  process.exit(0)
})
```

Hosts send `SIGTERM` on every deploy, so this matters in production.

Also: a long synchronous CPU task blocks the event loop, which blocks the lock renewal, which makes a healthy job look stalled. If that ever happens, the fix is a sandboxed processor (runs the job in a child process).

---

# 20. Connection Gotchas

- **`maxRetriesPerRequest: null`** on the ioredis connection used by a Worker. BullMQ uses blocking Redis commands and refuses to start a Worker without it.
- **TLS.** Hosted Redis (Upstash) uses `rediss://` (two s's).
- **Use the Redis protocol URL**, not Upstash's REST URL. BullMQ needs a real TCP Redis connection.
- **Free-tier command budget.** An idle worker still talks to Redis (it waits for jobs with blocking calls, and checks for stalled jobs). On a plan that bills or caps by command count, an always-on idle worker eats allowance. Watch the dashboard, and don't leave a dev worker running overnight.
- **Eviction policy.** BullMQ wants `noeviction`. If Redis silently evicts keys under memory pressure, jobs vanish.
- **Don't share one connection carelessly** between a Queue and a Worker if you set different options; create them from the same config.

---

# 21. Two Processes Now

```json
"scripts": {
  "dev": "ts-node-dev --respawn --transpile-only src/index.ts",
  "worker": "ts-node-dev --respawn --transpile-only src/worker.ts"
}
```

```text
terminal 1:  npm run dev      (API)
terminal 2:  npm run worker   (worker)
```

The classic bug: "my upload is stuck on Processing forever" = you forgot to start the worker. The job is sitting in `waiting`.

And remember `package.json` must stay strict JSON (no `//` comments).

---

# 22. Where the Code Goes

Following the repo's structure rule (new feature = its own files; nothing outside `repositories/` touches SQL; services never touch `req`/`res`):

```text
src/
  queues/ingest.queue.ts        Queue instance + the job data type + addIngestJob()
  worker.ts                     the entry point (like index.ts, tiny): new Worker(...)
  services/ingestion.service.ts ingestPdf() — reshaped to take a documentId, clean first, update status last
  repositories/documents.repository.ts   + updateDocumentStatus(), getDocumentStatus()
  routes/documents.routes.ts    POST /upload returns 202; + GET /documents/:id/status
```

The refactor on 2026-09-20 is what makes this cheap. `ingestPdf()` already never touches `req`/`res`, so a worker can call it. That was the point of pulling it out of the route.

Keep the `pipelineLogger` calls. In the worker terminal you should still see `[2/5] Extracting text...` etc. Logging is a feature here.

---

# 23. Failure Handling

```ts
worker.on('failed', async (job, err) => {
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    await updateDocumentStatus(job.data.documentId, 'failed', err.message)
  }
})
```

- Only mark `failed` when attempts are **exhausted**, not on every failed attempt.
- Store a short, safe error for the UI. Use `summarizeError()` for the log, since Drizzle errors embed all 3072 embedding numbers.
- The UI shows "Processing failed" with a retry or delete button.

**Dead letter queue (DLQ):** the general name for "where jobs go after they fail for good". In BullMQ the `failed` set plays that role: jobs sit there for inspection and can be retried manually (`job.retry()`).

---

# 24. Chat During Processing

A new edge case appears: the document exists but isn't ready.

```text
status: processing → chat disabled in the UI
                   → backend: prepareChat finds 0 chunks (or only some!)
```

"Only some" is the nasty one. Halfway through ingestion, a search returns real but incomplete results, and the answer is confidently wrong. So check `status === 'ready'` in the backend, not only in the UI. In all-documents mode, `searchSimilar` should skip documents that aren't ready (the same join that already skips orphans).

---

# 25. Monitoring a Queue

Things you want to see:

- how many jobs are waiting (queue depth)
- how long jobs take
- how many fail, and why

```ts
await ingestQueue.getJobCounts('waiting', 'active', 'completed', 'failed')
```

**Bull Board** is a small dashboard you can mount on an Express route in dev to watch and retry jobs. Nice to have, not required.

If queue depth keeps growing, workers can't keep up: add concurrency or workers, or the work is failing and retrying.

---

# 26. Other Things Queues Are Used For

So the idea generalises beyond PDFs:

- sending email
- image / video processing
- generating reports
- webhooks (retry until the other side answers)
- scheduled jobs (BullMQ repeatable jobs / job schedulers = cron)
- **LLM batch work**: summarise 500 documents overnight
- fan-out: one parent job, many children (BullMQ Flows), e.g. one job per chunk

For DocMind, one-job-per-chunk would give real parallelism and per-chunk retries. It's also a lot more moving parts. One job per document is the right first version.

---

# 27. When NOT to Use a Queue

- The work takes 200 ms. Just do it.
- The user needs the result in the response (chat, quiz).
- You have no way to run a second process (see deployment: Render's free tier doesn't obviously give you a free worker).

`/quiz` takes 10–30 seconds and a user is waiting. Is that online or offline? It's online: they're staring at a modal. It could become a job with polling, but a single request with a loading state is simpler and good enough.

---

# 28. Deployment Preview

```text
Render service 1: web       → npm start           (dist/index.js)
Render service 2: worker    → node dist/worker.js
Both read: DATABASE_URL, GEMINI_API_KEY, REDIS_URL
```

Three things to think about before then:

1. **Separate disks.** Hence §16: never rely on a temp file.
2. **Free tier.** Render's free instances are for web services; background workers are normally a paid instance type. Check the current pricing page. A free-tier workaround is to start the `Worker` inside the same Node process as the API. You lose process isolation and the worker sleeps when the web service spins down, but the queue semantics (retries, status, idempotency) are all still real.
3. **Spin-down.** A free web service sleeps after idle time. A job added just before sleep waits until something wakes the service.

More in [topic 13](../13-deployment/More_on_Deployment.md).

---

# 29. Interview-Level Summary

If asked **"Why use a queue?"**:

> To move slow work that nobody is actively waiting on out of the request path. The request records the work and returns immediately; a separate worker does it with retries. In my project that's PDF ingestion: chat is online work and streams, ingestion is offline work and belongs on a queue.

If asked **"Queue vs job vs worker?"**:

> The queue is an ordered list kept in Redis. A job is one item: a name plus a small JSON payload. A worker is a separate process that pulls jobs and runs them. The API is the producer, the worker is the consumer, and they only communicate through Redis.

If asked **"What does idempotent mean and why does it matter?"**:

> Queues deliver at least once, so a job can run twice: after a retry, or if a worker dies mid-job. An idempotent job gives the same result either way. For ingestion I delete the document's existing chunks at the start, so a retry can't create duplicates.

If asked **"Why exponential backoff?"**:

> If the failure is an overloaded or rate-limited service, retrying immediately makes it worse. Increasing delays give it time to recover while still retrying quickly for short blips.

If asked **"What do you put in the job?"**:

> A reference, like a document id, never the file. Job data lives in Redis memory, and the worker may run on a different machine with a different disk.

If asked **"How does the client know it's done?"**:

> The upload returns 202 with a status of processing, and the client polls a status endpoint until it's ready or failed. SSE would also work.

If asked **"What if the worker crashes mid-job?"**:

> The job's lock expires, BullMQ marks it stalled and requeues it. Which is another reason the job has to be idempotent.

---

# 30. Things That Will Bite You

- Forgetting to start the worker → stuck on "processing".
- `maxRetriesPerRequest: null` missing → the Worker refuses to start.
- `redis://` instead of `rediss://` for a TLS host.
- Putting the file in job data.
- Temp files that work locally and vanish when deployed.
- Non-idempotent retry → duplicate chunks.
- Marking `failed` on the first failed attempt instead of the last.
- Completed jobs piling up in a small Redis.
- An idle worker quietly burning the free command allowance.
- Chatting with a half-ingested document.

---

# 31. Final Mental Model

```text
                 USER UPLOADS PDF
                        │
                        ↓
                 POST /upload  (API)
                        │
        ┌───────────────┼────────────────┐
        ↓               ↓                ↓
  documents row     queue.add()     202 { documentId,
  status:           { documentId }      status: processing }
  processing            │                │
                        ↓                ↓
                   Redis queue      browser polls
                        │           GET /documents/:id/status
                        ↓                ↑
                 WORKER process          │
                        │                │
              delete old chunks          │
              parse → chunk              │
              embed × N → store          │
                        │                │
              ┌─────────┴────────┐       │
              ↓                  ↓       │
           success            throws     │
              │                  │       │
     status: ready        retry w/ backoff
              │           (attempts left?)
              │                  │ no
              │                  ↓
              │           status: failed
              └──────────────────┴───────┘
```

**Online work runs inline. Offline work goes on a queue.**

**Queue = list in Redis. Job = name + small JSON. Worker = separate process.**

**Returns → completed. Throws → retry, then failed.**

**At-least-once delivery → every job must be idempotent.**

**The job carries a reference, never the file.**

**A queue is also a throttle.**
