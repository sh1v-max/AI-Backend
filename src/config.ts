import 'dotenv/config'
import type { DefaultJobOptions, WorkerOptions } from 'bullmq'

// Constants shared across routes/services live here so there's one place to
// change them, instead of magic numbers scattered through the route files.

// How many previous messages get replayed into every chat prompt.
export const HISTORY_LIMIT = 8

// Step 3.3 — the documentId value that means "search every uploaded document".
// A sentinel string instead of NULL because chat_messages.document_id is NOT
// NULL — using 'all' avoids altering the live table. A session's scope is
// whatever documentId its messages were saved with.
export const ALL_DOCUMENTS = 'all'
export const ALL_DOCUMENTS_LABEL = 'All documents'

export const PORT = process.env.PORT || 3000

// The frontend (Vite dev server, localhost:5173) and this API (localhost:3000)
// are different origins even both on localhost — browsers block cross-origin
// requests by default unless the server explicitly allows them.
//
// Phase 10 — FRONTEND_URL can hold several origins, comma-separated (e.g.
// "https://docmind.vercel.app,http://localhost:5173"), so the deployed API
// can serve the live site and local dev at once. A trailing slash is stripped
// because the browser's Origin header never has one — "https://x.app/" would
// never match and every request would fail CORS.
export const FRONTEND_ORIGINS = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean)

// Phase 10 — the free Render instance has 512 MB of RAM and multer keeps the
// whole upload in memory, so a cap keeps one huge PDF from crashing the server.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

// Auth.1 — how long a login token stays valid (the format is the `ms`
// library's: '7d' = 7 days). A guest can't log back in — there's no email or
// password to log in WITH — so an expired guest token means that guest's
// files are gone for good. That's why guests get the longer one.
export const TOKEN_TTL_USER = '7d'
export const TOKEN_TTL_GUEST = '30d'

// Auth.7 — how many documents one user may have at once. Every upload costs
// Gemini embedding calls on the free-tier quota, and POST /auth/guest is
// public, so a cap per user limits how much one identity can use up. Lower
// for guests, which also gives them a reason to sign up.
export const GUEST_MAX_DOCUMENTS = 5
export const USER_MAX_DOCUMENTS = 10

// Auth.7 — the cap above limits ONE guest; it doesn't stop someone creating a
// thousand guests in a loop. This limits the public /auth routes per IP
// address: at most AUTH_RATE_LIMIT requests per AUTH_RATE_WINDOW_MS. A real
// visitor makes one guest per browser, so 20 per 15 minutes leaves plenty of
// room even for a shared office or college network.
export const AUTH_RATE_LIMIT = 20
export const AUTH_RATE_WINDOW_MS = 15 * 60 * 1000

// Auth.7 — how many proxies sit between the visitor and this server (see the
// `trust proxy` comment in app.ts). 3 on Render (measured 2026-10-04; also set
// as an env var there). An env var so another host, or a change on Render's
// side, can be fixed from the dashboard without a code change. Locally there
// is no proxy, so the value doesn't matter.
export const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS ?? 3)

// BG.0 — background jobs (Phase 6, see background-jobs-plan.md).
// Uploads answer right away; the slow part (embedding every chunk with
// Gemini) runs later in a BullMQ worker that takes jobs from a Redis queue.

// The queue's name. BullMQ stores everything about it in Redis under keys
// like "<prefix>:ingest-pdf:...".
export const INGEST_QUEUE = 'ingest-pdf'

// Redis connection (Upstash, a rediss:// URL = TLS) and the key prefix.
// Local dev and Render share ONE free Upstash database, so each environment
// gets its own prefix (docmind-dev locally, docmind on Render). Different
// prefix = a different queue, so the laptop's worker never takes production's
// jobs. No defaults on purpose: a forgotten prefix on Render must not quietly
// fall back to the dev queue. Both are checked when the queue starts (BG.2).
export const REDIS_URL = process.env.REDIS_URL
export const BULLMQ_PREFIX = process.env.BULLMQ_PREFIX

// Start the worker inside the API process unless RUN_WORKER=false. Render's
// free tier has no separate worker service, so in production it runs here.
// Locally, set it to false when not working on Phase 6: an idle worker still
// talks to Redis and spends the free plan's 500K commands a month.
export const RUN_WORKER = process.env.RUN_WORKER !== 'false'

// What every ingest job gets unless told otherwise.
export const INGEST_JOB_OPTIONS = {
  // Gemini's "high demand" 503s are real and usually pass on their own, so a
  // failed job is tried 3 times in total before it counts as failed.
  attempts: 3,
  // Wait 5 s before the 2nd try and 10 s before the 3rd (doubling each time).
  backoff: { type: 'exponential', delay: 5000 },
  // The documents row is the record of what happened; a finished job's chunk
  // text has no reason to sit in Redis (256 MB free limit).
  removeOnComplete: true,
  // Keep the last 50 failed jobs so they can be looked at in Upstash's data
  // browser.
  removeOnFail: 50,
} satisfies DefaultJobOptions

// How the worker behaves. The last three are tuned for Upstash's free plan:
// BullMQ talks to Redis even when there's nothing to do, and with the defaults
// that alone would use up more than the 500K commands a month.
export const INGEST_WORKER_OPTIONS = {
  // One document at a time: the Gemini free tier is rate limited anyway.
  concurrency: 1,
  // How long (seconds) one "any jobs?" wait lasts when the queue is empty.
  // Default 5 → about 6x more idle commands.
  drainDelay: 30,
  // How often (ms) to look for jobs whose worker died mid-job. Default 30 s.
  stalledInterval: 300_000,
  // How long (ms) a running job's lock lasts before it's considered stalled
  // (BullMQ renews it while the job runs). Default 30 s; a slow Gemini call
  // on Render's 0.1 CPU shouldn't make a job that's still running look dead.
  lockDuration: 60_000,
} satisfies Partial<WorkerOptions>

// What the client sees when a network step (Gemini, Neon) fails — the real
// cause goes to the terminal instead (see utils/errors.ts).
export const CONNECTION_ERROR_MESSAGE =
  'Could not reach Gemini or the database — check your internet connection and try again.'
