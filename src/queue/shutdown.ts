import type { Worker } from 'bullmq'
import { SHUTDOWN_TIMEOUT_MS } from '../config'
import { closeIngestQueue } from './ingest.queue'
import { closeRedisConnections } from './connection'
import { summarizeError } from '../utils/errors'

// BG.2 — close the queue side cleanly when the process is told to stop.
//
// Render sends SIGTERM on every deploy and restart; Ctrl+C sends SIGINT.
// Without a handler Node exits on the spot, possibly mid-job. With it:
//   1. worker.close() stops taking new jobs and WAITS for the one in progress
//   2. the queue and the Redis connections are closed
//   3. the process exits
// If that takes longer than SHUTDOWN_TIMEOUT_MS, exit anyway. The cut-off job
// isn't lost: BullMQ sees its lock expire and runs it again (stalled job), and
// the job is idempotent.
export function closeQueueOnShutdown(worker: Worker | null): void {
  let closing = false

  async function shutdown(signal: string) {
    if (closing) return // a second Ctrl+C while closing changes nothing
    closing = true
    console.log(`\n${signal} received — closing the queue${worker ? ' (waiting for the job in progress)' : ''}...`)

    // unref(): this timer alone shouldn't keep the process alive.
    setTimeout(() => {
      console.error(`Shutdown took longer than ${SHUTDOWN_TIMEOUT_MS / 1000} s — exiting anyway`)
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS).unref()

    try {
      await worker?.close()
      await closeIngestQueue()
      await closeRedisConnections()
      console.log('Queue closed cleanly.')
      process.exit(0)
    } catch (err) {
      console.error(`Error while closing the queue: ${summarizeError(err)}`)
      process.exit(1)
    }
  }

  process.once('SIGTERM', () => void shutdown('SIGTERM'))
  process.once('SIGINT', () => void shutdown('SIGINT'))
}
