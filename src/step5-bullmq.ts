import 'dotenv/config'
import { Queue, Worker, type Job, type WorkerOptions } from 'bullmq'
import { Redis } from 'ioredis'
import { INGEST_WORKER_OPTIONS, REDIS_URL } from './config'

// BG.1 — a learning script: what a queue, a job and a worker actually are,
// before any of it touches DocMind's real upload path.
//
// Run:
//   npm run step5                        part 1: 3 jobs, a retry, a give-up
//   npm run step5 idle default [secs]    part 2: what an IDLE worker costs with
//   npm run step5 idle tuned [secs]               BullMQ's defaults vs our tuning
//                                                 (secs defaults to 120)
//
// Safe to run any time: everything lives under its own prefix
// ("docmind-learn"), it never touches Postgres, and it deletes its Redis keys
// when it's done. Never point this at the "docmind" or "docmind-dev" prefixes:
// obliterate() below wipes a whole queue.

const PREFIX = 'docmind-learn'
const t0 = Date.now()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
// "[+3.2s]" in front of every line, so the backoff wait between a failure and
// its retry is visible.
const log = (text: string) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s] ${text}`)

// ── Counting Redis commands ────────────────────────────────────────────────
// Upstash's free plan is 500K commands a month, so "how many commands does
// this cost?" is the question that decides whether the free plan works.
// Every command ioredis sends — single ones, pipelined batches, and the ones
// on the extra connections BullMQ opens by itself — goes through
// Redis.prototype.sendCommand, so wrapping it once counts everything this
// process sends. (Checked before writing this: Upstash's own INFO counter
// didn't match what was sent, so we count on our side. The Upstash dashboard
// is still the number that matters for the bill — compare the two.)
let commandsSent = 0
const originalSendCommand = Redis.prototype.sendCommand
Redis.prototype.sendCommand = function (this: Redis, ...args: Parameters<Redis['sendCommand']>) {
  commandsSent++
  return originalSendCommand.apply(this, args)
}

if (!REDIS_URL) {
  console.error('REDIS_URL is missing from .env (see .env.example).')
  process.exit(1)
}
const redisUrl: string = REDIS_URL

// Two connections, same split as the real app will use (BG.2):
//   - the Queue's (adding jobs): normal commands.
//   - the Worker's: maxRetriesPerRequest: null is REQUIRED by BullMQ. The worker
//     sits in long blocking waits ("give me the next job, I'll wait up to N
//     seconds"), and through a reconnect those must keep waiting instead of
//     failing after ioredis's default 20 retries. BullMQ prints a warning
//     without it.
function connect(forWorker: boolean) {
  return new Redis(redisUrl, forWorker ? { maxRetriesPerRequest: null } : {})
}

// ── Part 1: a queue, 3 jobs, a worker ──────────────────────────────────────

interface HelloJob {
  name: string
}

async function demo() {
  const queueConnection = connect(false)
  const workerConnection = connect(true)
  const queue = new Queue<HelloJob>('hello', { connection: queueConnection, prefix: PREFIX })

  // A crashed earlier run could have left jobs behind; start from nothing.
  await queue.obliterate({ force: true })
  commandsSent = 0

  // The producer side: this is all /upload will do — describe the work and
  // hand it to Redis. add() returns as soon as Redis has stored the job;
  // nothing has RUN yet.
  //   attempts: 2  → a failing job is tried twice in total
  //   backoff      → wait 2 s before the retry (DocMind will use 5 s, doubling)
  const jobOptions = { attempts: 2, backoff: { type: 'fixed', delay: 2000 } }
  log('Adding 3 jobs to the "hello" queue...')
  await queue.add('greet', { name: 'Shiv' }, jobOptions) // works first time
  await queue.add('flaky', { name: 'Gemini' }, jobOptions) // fails once, then works
  await queue.add('broken', { name: 'scanned.pdf' }, jobOptions) // fails every time
  log(`Added. Waiting in Redis: ${JSON.stringify(await queue.getJobCounts('wait'))} — no worker exists yet, so nothing runs.`)

  await sleep(1500)

  // The consumer side. The processor is just an async function: return =
  // success, throw = failure. BullMQ does the rest: picks the next job,
  // locks it so no other worker takes it, schedules the retry, records the
  // result. Every job ends in exactly one place: completed, or failed after
  // its last attempt.
  let settled = 0
  let allSettled: () => void = () => {}
  const done = new Promise<void>((resolve) => (allSettled = resolve))

  log('Starting a worker...')
  const worker = new Worker<HelloJob, string>(
    'hello',
    async (job: Job<HelloJob, string>) => {
      // attemptsMade = how many attempts have FAILED so far, so +1 = this one.
      const attempt = job.attemptsMade + 1
      log(`  ▶ ${job.name} (job ${job.id}) attempt ${attempt}/${job.opts.attempts} — working...`)
      await sleep(500) // pretend to call Gemini
      if (job.name === 'flaky' && attempt === 1) throw new Error('Gemini said 503: high demand (pretend)')
      if (job.name === 'broken') throw new Error('No text layer in this PDF (pretend)')
      return `Hello, ${job.data.name}!`
    },
    { connection: workerConnection, prefix: PREFIX },
  )

  // Careful: by the time 'completed' fires, attemptsMade already includes the
  // attempt that just succeeded (checked on bullmq 6), so no +1 here — unlike
  // inside the processor, where the current attempt hasn't been counted yet.
  worker.on('completed', (job, result) => {
    log(`  ✅ ${job.name} completed after ${job.attemptsMade} attempt(s) → returned "${result}"`)
    if (++settled === 3) allSettled()
  })

  // 'failed' fires for EVERY failed attempt, including ones that will be
  // retried. The only way to know "this was the last one" is to compare —
  // the exact check the real worker uses to set status = 'failed' (BG.2).
  worker.on('failed', (job, err) => {
    if (!job) return
    const final = job.attemptsMade >= (job.opts.attempts ?? 1)
    if (final) {
      log(`  ❌ ${job.name} FAILED for good after ${job.attemptsMade} attempts: ${err.message}`)
      if (++settled === 3) allSettled()
    } else {
      const wait = typeof job.opts.backoff === 'object' ? job.opts.backoff.delay : job.opts.backoff
      log(`  ↻ ${job.name} attempt ${job.attemptsMade} failed (${err.message}) — BullMQ will retry in ${wait} ms`)
    }
  })

  await done

  // What Redis remembers afterwards. These jobs weren't told to remove
  // themselves, so both outcomes stay (DocMind's real jobs: completed ones are
  // removed, the last 50 failed ones are kept for debugging).
  log(`All 3 settled. Counts in Redis: ${JSON.stringify(await queue.getJobCounts('completed', 'failed', 'wait', 'active', 'delayed'))}`)
  const [failedJob] = await queue.getFailed()
  if (failedJob) {
    log(`What a failed job keeps: name="${failedJob.name}", attemptsMade=${failedJob.attemptsMade}, failedReason="${failedJob.failedReason}", data=${JSON.stringify(failedJob.data)}`)
  }

  await worker.close()
  log(`Redis commands sent during the demo: ${commandsSent} (3 jobs, 5 attempts — Upstash's free plan allows 500,000 a month)`)

  // Clean up: delete every key of this queue, then the connections.
  await queue.obliterate({ force: true })
  await queue.close()
  await Promise.all([queueConnection.quit(), workerConnection.quit()])
  log('Cleaned up (queue obliterated, connections closed).')
}

// ── Part 2: what does a worker cost when there's NOTHING to do? ────────────
// A worker can't be told "a job arrived" — it keeps asking Redis. Two timers
// drive the cost:
//   drainDelay       how long one blocking "any job?" wait lasts (default 5 s)
//   stalledInterval  how often it checks for jobs whose worker died (default 30 s)
// "tuned" uses the real DocMind values from config.ts (30 s and 5 min).

async function idle(mode: string, seconds: number) {
  if (mode !== 'default' && mode !== 'tuned') {
    console.error('Usage: npm run step5 idle <default|tuned> [seconds]')
    process.exit(1)
  }
  const tuning: Partial<WorkerOptions> = mode === 'tuned' ? INGEST_WORKER_OPTIONS : {}
  const queueConnection = connect(false)
  const workerConnection = connect(true)
  // One queue per mode, so a default and a tuned run can go side by side
  // without the second one's obliterate() hitting the first one's live queue.
  const queueName = `idle-${mode}`
  const queue = new Queue(queueName, { connection: queueConnection, prefix: PREFIX })
  await queue.obliterate({ force: true })

  log(`Idle worker, ${mode} options ${JSON.stringify(tuning)}, for ${seconds} s. The queue is empty the whole time.`)
  log('→ Note the command count on the Upstash dashboard now, and again after this ends.')
  const worker = new Worker(queueName, async () => {}, { connection: workerConnection, prefix: PREFIX, ...tuning })
  await worker.waitUntilReady()
  await sleep(2000) // let startup traffic (connection handshakes, script loading) finish

  // Count only the idle window, not the startup.
  const startupCommands = commandsSent
  commandsSent = 0
  const windowStart = Date.now()
  for (let elapsed = 0; elapsed < seconds; elapsed += 15) {
    await sleep(Math.min(15, seconds - elapsed) * 1000)
    log(`  ${Math.round((Date.now() - windowStart) / 1000)} s idle → ${commandsSent} commands`)
  }

  const idleCommands = commandsSent
  const perSecond = idleCommands / ((Date.now() - windowStart) / 1000)
  const perDay = Math.round(perSecond * 86_400)
  const perMonth = perDay * 30
  await worker.close()
  await queue.obliterate({ force: true })
  await queue.close()
  await Promise.all([queueConnection.quit(), workerConnection.quit()])

  console.log()
  log(`Result (${mode}):`)
  console.log(`  startup:                ${startupCommands} commands (paid once per process start)`)
  console.log(`  idle, ${seconds} s:           ${idleCommands} commands`)
  console.log(`  ≈ per day, awake 24/7:  ${perDay.toLocaleString()}`)
  console.log(`  ≈ per 30 days, 24/7:    ${perMonth.toLocaleString()}  (${Math.round((perMonth / 500_000) * 100)}% of the 500K free plan)`)
  console.log('  (Render sleeps after ~15 min without requests, and the worker sleeps with it,')
  console.log('   so the real month is much lower. The 24/7 number is the worst case.)')
  console.log(`  Total sent by this run incl. startup + shutdown: ${startupCommands + commandsSent}`)
}

const [mode = 'demo', arg1, arg2] = process.argv.slice(2)
const run = mode === 'idle' ? idle(arg1 ?? '', Number(arg2) || 120) : demo()
run
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
