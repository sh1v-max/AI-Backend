import { Redis } from 'ioredis'
import { BULLMQ_PREFIX, REDIS_URL } from '../config'
import { summarizeError } from '../utils/errors'

// BG.2 — the Redis connections BullMQ runs on (Upstash, rediss:// = TLS).
//
// Nothing here connects when the file is imported. Connections open on first
// use, so a script or a test can import modules that import this one without
// suddenly talking to Redis (and spending Upstash's command budget).

// Fail fast with a clear message instead of a confusing ioredis error later.
// No defaults: a missing BULLMQ_PREFIX on Render must not quietly fall back to
// the laptop's queue (see the comment in config.ts).
export function getQueueSettings(): { url: string; prefix: string } {
  if (!REDIS_URL) throw new Error('REDIS_URL is missing (see .env.example)')
  if (!BULLMQ_PREFIX) throw new Error('BULLMQ_PREFIX is missing (docmind-dev locally, docmind on Render)')
  return { url: REDIS_URL, prefix: BULLMQ_PREFIX }
}

// Every connection opened, so shutdown can close them all.
const openConnections: Redis[] = []

// Two kinds of connection, because the two sides want opposite things when
// Redis is unreachable:
//
//   'queue'  (used by POST /upload to add jobs) — FAIL FAST. With
//            enableOfflineQueue: false, ioredis refuses a command while it's
//            disconnected instead of holding it in memory until Redis comes
//            back. The upload then answers 503 in a moment, not after hanging.
//
//   'worker' (BullMQ's long blocking "give me the next job" waits) — WAIT IT
//            OUT. maxRetriesPerRequest: null means a command survives
//            reconnects. BullMQ requires this for workers and warns without it.
function connect(role: 'queue' | 'worker'): Redis {
  const { url } = getQueueSettings()
  const connection = new Redis(
    url,
    role === 'queue' ? { maxRetriesPerRequest: 1, enableOfflineQueue: false } : { maxRetriesPerRequest: null },
  )

  // Without an 'error' listener, Node prints "[ioredis] Unhandled error event"
  // with a full stack on every reconnect attempt. ioredis keeps retrying on
  // its own (every ~2 s), so log each DIFFERENT error once, and say when the
  // connection is back.
  let lastError = ''
  connection.on('error', (err) => {
    const summary = summarizeError(err)
    if (summary !== lastError) console.error(`[redis:${role}] ${summary}`)
    lastError = summary
  })
  connection.on('ready', () => {
    if (lastError) console.log(`[redis:${role}] reconnected`)
    lastError = ''
  })

  openConnections.push(connection)
  return connection
}

// One shared queue-side connection for the whole process.
let queueConnection: Redis | null = null
export function getQueueConnection(): Redis {
  queueConnection ??= connect('queue')
  return queueConnection
}

// A worker gets its own (BullMQ also opens one more for the blocking waits).
export function createWorkerConnection(): Redis {
  return connect('worker')
}

// Shutdown: quit() sends QUIT and waits for the replies to commands already
// sent, unlike disconnect(), which just drops the socket.
export async function closeRedisConnections(): Promise<void> {
  const closing = openConnections.splice(0)
  queueConnection = null
  await Promise.allSettled(closing.map((connection) => connection.quit()))
}
