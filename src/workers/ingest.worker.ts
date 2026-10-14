import { Worker, type Job } from 'bullmq'
import { INGEST_FAILED_MESSAGE, INGEST_QUEUE, INGEST_WORKER_OPTIONS } from '../config'
import { createWorkerConnection, getQueueSettings } from '../queue/connection'
import type { IngestJobData } from '../queue/ingest.queue'
import { deleteChunksByDocumentId } from '../repositories/chunks.repository'
import { getDocumentForUser, setDocumentStatus } from '../repositories/documents.repository'
import { embedAndStoreChunks } from '../services/ingestion.service'
import { summarizeError } from '../utils/errors'
import { detail, failed, notFound, pipelineEnd, pipelineStart, step } from '../utils/pipelineLogger'

// BG.2 — the consumer side: takes ingest jobs off the queue and does the slow
// part of an upload (embed + store every chunk), then marks the document
// 'ready'. No Express here, no req/res: the same code can run inside the API
// process (Render free, BG.3) or on its own (`npm run worker`).

// One job. Return = success, throw = failure (BullMQ then retries it, up to
// `attempts`, with backoff — no retry loop in our code).
//
// Safe to run more than once for the same document (idempotent). A retry, or
// a job picked up again after a crash, finds whatever the last run left:
// maybe chunks 1-17 of 30. So it starts by deleting the document's chunks and
// then inserts all of them. One run or three, the result is the same.
export async function processIngestJob(job: Job<IngestJobData>): Promise<void> {
  const { documentId, userId, chunks } = job.data
  const t0 = Date.now()
  // attemptsMade counts FAILED attempts so far, so +1 is this one.
  pipelineStart('queue', `ingest job ${documentId.slice(0, 8)} — attempt ${job.attemptsMade + 1}/${job.opts.attempts ?? 1}`)

  step('queue', 1, 3, 'Checking the document still exists...')
  // Ownership check, with the userId the job carries (rule from auth: every
  // read of user data is scoped to its owner, the worker included).
  const document = await getDocumentForUser(documentId, userId)
  if (!document) {
    // Deleted before this attempt started. A previous attempt may still have
    // stored chunks after the delete, so clear them; then there's nothing to
    // do. Returning (not throwing) ends the job as "completed": retrying
    // can't bring the document back.
    notFound(`document ${documentId.slice(0, 8)} no longer exists — nothing to do`)
    await deleteChunksByDocumentId(documentId)
    return
  }
  detail(`"${document.filename}", ${chunks.length} chunk(s), user ${userId.slice(0, 8)}`)
  await deleteChunksByDocumentId(documentId) // the idempotent part: start from a clean slate

  step('queue', 2, 3, `Embedding + storing ${chunks.length} chunk(s)...`)
  await embedAndStoreChunks(documentId, chunks)

  step('queue', 3, 3, 'Marking the document ready...')
  // false = no row to update: the user deleted the document while we were
  // embedding, so the chunks just stored belong to nothing. Remove them.
  const stillExists = await setDocumentStatus(documentId, userId, 'ready')
  if (!stillExists) {
    notFound(`document ${documentId.slice(0, 8)} was deleted while processing — removing its chunks`)
    await deleteChunksByDocumentId(documentId)
  }

  pipelineEnd('queue', Date.now() - t0, 'Total job time')
}

// 'failed' fires after EVERY failed attempt, including ones BullMQ will retry.
// Only the last one should mark the document failed.
//
// Why ask for the job's state instead of comparing attemptsMade with
// attempts: a job whose worker keeps dying mid-job ("stalled" too often) is
// failed by BullMQ before its attempts run out. The arithmetic would say
// "will retry" and the document would sit at 'processing' forever. The state
// is the truth: 'failed' = done for good, 'delayed'/'waiting' = a retry is
// scheduled.
async function onJobFailed(job: Job<IngestJobData> | undefined, err: Error): Promise<void> {
  if (!job) {
    console.error(`[ingest worker] a job failed and BullMQ couldn't load it: ${summarizeError(err)}`)
    return
  }
  const { documentId, userId } = job.data
  const attempts = job.opts.attempts ?? 1
  failed(`ingest job ${documentId.slice(0, 8)} attempt ${job.attemptsMade}/${attempts}`)
  console.error(summarizeError(err))

  // Inside an event handler nothing awaits us: an exception here would be an
  // unhandled rejection (which crashes Node), so everything is caught.
  try {
    const state = await job.getState()
    if (state !== 'failed') {
      detail(`will be retried (job state: ${state})`)
      return
    }
    // Done for good: drop the partial chunks (they'd never be searched, since
    // only 'ready' documents are, but they'd take space), then tell the user.
    await deleteChunksByDocumentId(documentId)
    await setDocumentStatus(documentId, userId, 'failed', INGEST_FAILED_MESSAGE)
    detail(`no attempts left — document ${documentId.slice(0, 8)} marked failed`)
  } catch (cleanupErr) {
    console.error(`[ingest worker] could not mark document ${documentId} failed: ${summarizeError(cleanupErr)}`)
  }
}

// Starts taking jobs right away (BullMQ's autorun). Returns the Worker so the
// caller can close() it on shutdown.
export function startIngestWorker(): Worker<IngestJobData> {
  const { prefix } = getQueueSettings()
  const worker = new Worker<IngestJobData>(INGEST_QUEUE, processIngestJob, {
    connection: createWorkerConnection(),
    prefix,
    // concurrency 1, drainDelay 30 s, stalledInterval 5 min, lockDuration 60 s
    // — tuned for Upstash's free command budget (measured in BG.1).
    ...INGEST_WORKER_OPTIONS,
  })

  worker.on('failed', (job, err) => void onJobFailed(job, err))
  // Connection-level problems (not a job's failure). BullMQ's docs: always
  // listen for 'error', or an error can go unreported.
  worker.on('error', (err) => console.error(`[ingest worker] ${summarizeError(err)}`))

  console.log(`[ingest worker] started — queue "${prefix}:${INGEST_QUEUE}"`)
  return worker
}
