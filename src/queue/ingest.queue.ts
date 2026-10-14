import { Queue } from 'bullmq'
import { INGEST_JOB_OPTIONS, INGEST_QUEUE } from '../config'
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
export async function enqueueIngest(data: IngestJobData) {
  return getIngestQueue().add('ingest', data, { jobId: data.documentId })
}

// Shutdown. close() doesn't close a connection it was handed, so the Redis
// connections are closed separately (closeRedisConnections()).
export async function closeIngestQueue(): Promise<void> {
  const queue = ingestQueue
  ingestQueue = null
  await queue?.close()
}
