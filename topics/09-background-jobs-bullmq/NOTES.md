# 09 — Background Jobs (BullMQ)

Roadmap: Phase 6 (Phase A in the roadmap's Part 2)

## What is it?

Before this, uploading a PDF meant the browser just sat there waiting while my server did everything: read the PDF, cut it into chunks, and then called Gemini once for every single chunk to get the embeddings. A big PDF could keep that one request open for a minute or more. If the connection dropped, or Gemini failed on chunk 17, the whole upload was gone and you had to start again.

A background job fixes that by splitting the work in two. The part someone is actually waiting for happens right away, and the slow part happens later, somewhere else.

So now the upload only reads the PDF and cuts it into chunks (that's fast), saves the document as "processing", drops a job into a queue and answers straight away with `202`. A worker picks the job up and does the slow embedding part, then marks the document "ready". The browser checks every 2 seconds until it's ready.

The queue lives in Redis (I used Upstash, free). BullMQ is the library that does the hard parts on top of it: giving each job to only one worker, retrying failed jobs, and noticing when a worker died halfway through a job.

Basically: chat is "online" work, someone is waiting, so it runs right away and streams. Uploading is "offline" work, nobody needs it this second, so it goes on a queue.

## Key facts

- Three words: the **queue** is a list in Redis, a **job** is one piece of work plus its data, the **worker** is the code that takes jobs and runs them.
- `queue.add()` doesn't run anything. It just saves the job in Redis. I saw this in my learning script: the jobs sat there doing nothing until I started a worker.
- I don't put the PDF in the job. Redis is memory and the free plan is small. I read the PDF in the request and put only the chunk texts in the job (`{ documentId, userId, chunks }`).
- A scanned PDF with no text gets a `400` right away now, instead of becoming a job that fails later.
- Retries are free: `attempts: 3` and a backoff of 5 seconds then 10 seconds. My code just throws an error, BullMQ does the retry. No retry loop written by me.
- **The job has to be safe to run twice.** Jobs get retried, and if the server dies in the middle, the job runs again. If it already stored chunks 1 to 17 and runs again, I'd get them twice. So every job first deletes all chunks of that document, then stores them all. Run it once or three times, same result.
- `jobId = documentId`, so the same document can't end up in the queue twice.
- While a document is processing, chat and quiz on it answer `409` ("still processing"), not `404`. It exists and it's yours, it's just not ready. "All documents" search simply skips it.
- Render's free plan has no background worker service, so my worker runs inside the same process as the API. `npm run worker` also exists, so moving it out later is just a config change.
- On every deploy Render sends `SIGTERM`. I catch it and let the worker finish the job it's on (max 20 seconds) before the server stops.
- Local and live use the **same** Upstash database. The prefix keeps them apart: `docmind-dev` on my laptop, `docmind` on Render. BullMQ puts the prefix in front of every key, like `docmind:ingest-pdf:wait`, so different prefix means completely separate queues.

## The free plan and the idle worker (this surprised me)

Upstash free gives 500K commands a month. What I didn't know: a worker keeps asking Redis "any jobs?" even when there's nothing to do. So I measured it, 5 minutes of a worker doing nothing:

- BullMQ's default settings: **118 commands**. That's about 1 million a month if it never sleeps, double the free limit, with zero uploads.
- After tuning (`drainDelay: 30` and `stalledInterval: 300000`): **19 commands**. About 164K a month, 33% of the limit.

The real usage after going live was way lower: 3.5K for the whole month so far, and that includes all my testing. Render puts the server to sleep when nobody uses it, and the worker sleeps with it.

## Things that bit me

- Copied the wrong thing from Upstash. I took the `redis-cli --tls -u ...` command instead of just the URL. Then the URL had `redis://` with one s, so no encryption, and Upstash just hung up. The error said "max retries per request", which told me nothing.
- `pdf-parse` adds a little `-- 1 of 1 --` marker for every page. So a PDF with no text at all still came back with 12 characters, and my "is it empty?" check said it had text. Now I check the text of each page separately.
- I thought a crashed job would come back within 5 minutes. I tested it by killing the server in the middle of a job, and it took **624 seconds**, about 10 minutes. BullMQ's check for dead jobs works in two rounds (first round marks it as suspicious, next round moves it back), and the dead server's last check was still blocking the new one for a while. The result was still correct though, every chunk stored once.
- If Redis is down from the moment the server starts, BullMQ's `add()` just waits forever. So the upload would hang instead of failing. I added a 5 second timeout, after that it's a clean `503`.
- After going live I found Render had `BULLMQ_PREFIX=docmind-dev`, the same as my laptop (I copied it from my `.env`). So live and local were sharing one queue, and my laptop could have picked up real users' uploads. Found it because there were 0 keys under `docmind:` in Redis. Changed it to `docmind`, checked again, fixed.
- I couldn't push the backend part alone. The old frontend asked its first question right after the upload finished, which would now get "still processing" every time. Backend and frontend had to go out together.
- "Is this the last attempt?" I check the job's actual state in BullMQ (`'failed'` means done for good) instead of counting attempts myself. Counting misses the case where BullMQ gives up on a job early, and that document would stay "processing" forever.

## Questions / things that felt unclear

- 10 minutes to recover after a crash is long. Lowering `stalledInterval` would make it faster but cost more Redis commands. I left it, because normal deploys don't hit this at all, only real crashes. Not sure yet what's the right number.
- The worker shares the API's process on the free plan. A big upload could slow chat down a bit. I haven't measured how much.
- Embedding is still one Gemini call per chunk, one after another. Gemini can embed many texts in one call (batch), which would be way faster. That's not a queue thing, it's a separate improvement.
- No progress bar yet, just "Processing…". BullMQ has `job.updateProgress()` for this, didn't use it.
