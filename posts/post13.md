# AI Backend Learning Journey — Post 13 Context (for LinkedIn + Twitter)

## Instructions for Claude

Use the `post-writer-sms` skill to write one LinkedIn post and one Twitter/X post based on everything below. I'm a frontend/full-stack engineer learning AI backend development from scratch and documenting it publicly. See `post1.md` through `post12.md` for continuity; post 12 was deploy + auth (every visitor could see every file, fixed with guests + per-user data).

**Format (my standing preference, this overrides older posts):**
- A **progress update**, not a story. What got done since the last post as plain `-` bullets, one or two things I learned, what's still missing, what's next.
- **No "Day N"** label anywhere. No story arc ("then I opened the site and..."), no "biggest takeaway" line, no "excited to announce".
- **X = one single post**, no thread.
- My voice: casual, a bit run-on, lowercase-ish bullets of uneven length, **no em-dashes**, no "not just X but Y" lines.
- The link goes in the first comment / reply, not in the post.
- Only use facts from this file, and respect "Don't overclaim".
- **Images:** three, in this order, in `posts/post13-images/`: `post13-1-before.png` (the request that stayed open), `post13-2-after.png` (the queue: 202 in ~1 s, worker in the background), `post13-3-measured.png` (idle worker 118 vs 19, the crash test at 624 s). Post all three as a set; the text shouldn't repeat what they already show. `source.html` re-renders them.

Strongest angle for the one or two "learned" lines: **an idle queue worker isn't free**: with BullMQ's default settings it would have used double my free Redis plan doing nothing, I measured it and tuned it to a third. Second option: **the job has to be safe to run twice** (I killed the server mid-job to prove it).

---

## What I built

Continuing **DocMind** (upload a PDF, chat with it, get quizzed on it, built from scratch to actually understand AI backends). This stretch covers Oct 6 → Oct 15: Phase 6, background jobs.

### The problem

Uploading a PDF kept one HTTP request open while my server read it, cut it into chunks, and called Gemini once **per chunk** for the embeddings. A big PDF meant a request open for a minute or more. If the connection dropped or Gemini failed halfway, the whole upload was lost.

### What changed

- `POST /upload` now only does what someone is waiting for: read the PDF, cut it into chunks, save the document as `processing`, put a job on a queue, answer **202** in about a second.
- A **BullMQ** worker (Redis on Upstash's free plan) picks the job up, does the slow embedding part, and marks the document `ready`, or `failed` after 3 attempts (5 s, then 10 s apart).
- The job carries the chunk **texts**, never the PDF file. Redis is memory and the free plan is small.
- A scanned PDF with no text gets a `400` straight away, instead of becoming a job that fails later.
- Chat or quiz on a document that's still processing answers `409` ("still processing"), and "search all documents" just skips it.
- The frontend shows "Processing…" in the sidebar and polls until it's ready. A question typed during the upload waits and goes out on its own once the PDF is ready.
- Render's free plan has no background-worker service, so the worker runs inside the API process. `npm run worker` exists for when it moves out.

### Things I learned / measured

- **An idle worker costs money (or free-plan quota).** A BullMQ worker keeps asking Redis "any jobs?" even when nothing happens. I measured 5 idle minutes: **118 Redis commands with the defaults** (about 1M a month if it never sleeps, **double** Upstash's free 500K) vs **19 after tuning** two settings (about 164K a month, a third of the limit). Real usage after going live: **3.5K for the whole month**, including all my testing, because Render sleeps when nobody uses it and the worker sleeps with it.
- **The job has to be safe to run twice.** Failed jobs get retried, and if the server dies mid-job, the job runs again. If chunks 1 to 17 were already stored, a re-run stores them twice. So every job first deletes the document's chunks, then stores all of them. I tested it two ways: forced a failure on chunk 2 (retried, every chunk stored once), and hard-killed the server in the middle of a job (it resumed after the restart, every chunk stored once).
- **Crash recovery took ~10 minutes, not 5.** I expected a crashed job back within one 5-minute check. Measured: **624 seconds**. BullMQ's dead-job check works in two rounds, and the dead server's last check was still blocking the new one for a while. Normal deploys don't hit this: on `SIGTERM` the worker finishes its current job first.

### Gotchas (real ones)

- `pdf-parse` adds a `-- 1 of 1 --` marker for every page, so a PDF with **no** text still came back with 12 characters and my "is it empty?" check passed it. Now it checks each page's own text.
- If Redis is down from the moment the server starts, BullMQ's `add()` waits forever, so the upload would hang. Added a 5 second timeout, then a clean `503`.
- **Found live:** my laptop and the live server use the same Upstash database, kept apart by a key prefix. Render had my laptop's prefix (copied from my `.env`), so both were sharing one queue and my laptop could have picked up real users' uploads. Caught it because Redis had 0 keys under the production prefix. Fixed, re-checked.
- I couldn't ship the backend alone: the old frontend asked its first question right after the upload, which would now always get "still processing". Backend and frontend had to go out together.

---

## The bigger takeaway

The queue itself is a few lines. The real work was everything around it: making the job safe to run twice, deciding when it has really failed, and measuring the things the docs only hint at, like what an idle worker costs and how long a crash actually takes to recover.

## What's still missing

- Embedding is still one Gemini call per chunk, one after another (batching would be much faster).
- No progress bar, just "Processing…".
- The worker shares the API's process on the free plan, so a big upload can slow chat a little.
- 10 minutes to recover from a crash is long; it's a tradeoff against Redis usage I left as is.

## What's next

Phase 7: agents and tool calling. The chat decides what to do with a message (document question, small talk, quiz request) instead of always running the same search, and gets a real search tool it calls itself. That's also where "Searching the document…" progress messages come in instead of just loading dots.

## Numbers you can quote

- upload answers **202 in ~1–2 s**; live, the document was ready in **~5 s** (5 chunks)
- idle worker, 5 minutes: **118** Redis commands (defaults) vs **19** (tuned)
- defaults ≈ **1M/month** = **204%** of Upstash's free 500K; tuned ≈ **164K** = **33%**
- real usage: **3.5K** commands for the month, tests included
- crash recovery measured at **624 s**
- **3** attempts, **5 s → 10 s** backoff
- tests: 9/9 (worker), 16/16 (API over HTTP), 11/11 (browser), 10/10 (live)

## Don't overclaim

- The worker is **not** a separate service; it runs inside the API process on Render's free plan.
- No progress bar, no batching, no per-chunk parallelism.
- One worker, `concurrency: 1`, one document at a time. This is a learning project with tiny traffic, not a scaled system.
- The 1M/month and 164K/month numbers are extrapolated from 5-minute measurements, assuming the worker never sleeps. The 3.5K is the real dashboard number.
- I built it step by step with Claude Code as a pair programmer; every step was tested against the real stack before moving on.

## Hook ideas

- "my upload endpoint used to keep a request open for a minute. now it answers in a second"
- "an idle worker isn't free: BullMQ's defaults would've used double my free Redis plan doing nothing"
- "killed my server in the middle of a job on purpose. it came back 10 minutes later, not 5"
