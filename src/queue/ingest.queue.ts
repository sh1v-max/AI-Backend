import { Queue } from 'bullmq'
import { ENQUEUE_TIMEOUT_MS, INGEST_JOB_OPTIONS, INGEST_QUEUE } from '../config'
import { getQueueConnection, getQueueSettings } from './connection'

// BG.2 — the producer side of PDF ingestion: what POST /upload uses (BG.3) to
// hand the slow part of an upload to the worker.

// Everything the worker needs, and nothing it shouldn't have:
//   - userId comes from req.user.id (the token), never from the client's body,
//     and the worker still passes it to every repository call.
//   - chunks are plain text (~100–300 KB for a 50-page PDF). Never the PDF
//     bytes, never a token.
export interface IngestJobData {
  documentId: string
  userId: string
  chunks: string[]
}

let ingestQueue: Queue<IngestJobData> | null = null

// Created on first use, like the connections (see connection.ts).
export function getIngestQueue(): Queue<IngestJobData> {
  if (!ingestQueue) {
    ingestQueue = new Queue<IngestJobData>(INGEST_QUEUE, {
      connection: getQueueConnection(),
      prefix: getQueueSettings().prefix,
      // 3 attempts, 5 s → 10 s backoff, remove completed jobs, keep the last
      // 50 failed ones (config.ts explains each).
      defaultJobOptions: INGEST_JOB_OPTIONS,
    })
  }
  return ingestQueue
}

// add() resolves once Redis has stored the job; nothing has run yet.
// jobId = documentId: BullMQ ignores an add() whose jobId already exists, so
// the same document can't end up queued twice.
//
// BG.3 — with a time limit. If Redis dropped AFTER connecting, add() already
// fails at once (enableOfflineQueue: false). But if Redis has been
// unreachable since startup, BullMQ waits for the first connection forever,
// so without this race an upload would hang instead of getting its 503.
export async function enqueueIngest(data: IngestJobData) {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Redis didn't accept the job within ${ENQUEUE_TIMEOUT_MS / 1000} s`)),
      ENQUEUE_TIMEOUT_MS,
    )
  })
  try {
    return await Promise.race([getIngestQueue().add('ingest', data, { jobId: data.documentId }), timeout])
  } finally {
    clearTimeout(timer)
  }
}

// Shutdown. close() doesn't close a connection it was handed, so the Redis
// connections are closed separately (closeRedisConnections()).
export async function closeIngestQueue(): Promise<void> {
  const queue = ingestQueue
  ingestQueue = null
  await queue?.close()
}
