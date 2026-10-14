import 'dotenv/config'
import { app } from './app'
import { PORT, RUN_WORKER } from './config'
import { getJwtSecret } from './services/auth.service'
import { getQueueSettings } from './queue/connection'
import { getIngestQueue } from './queue/ingest.queue'
import { startIngestWorker } from './workers/ingest.worker'
import { closeQueueOnShutdown } from './queue/shutdown'

// Auth.1 — fail at startup if JWT_SECRET is missing, not on the first login.
getJwtSecret()

// BG.3 — same idea for the queue: no REDIS_URL / BULLMQ_PREFIX = refuse to
// start. Then open the queue now rather than on the first upload, so that
// upload doesn't pay for the Redis handshake, and a broken Redis shows up in
// the log at startup.
getQueueSettings()
getIngestQueue()

// BG.3 — Render's free tier has no separate worker service, so the worker
// runs in this process. RUN_WORKER=false turns it off (an idle worker spends
// Upstash's command budget; uploads then wait in the queue until a worker
// runs, e.g. `npm run worker`).
const worker = RUN_WORKER ? startIngestWorker() : null
if (!worker) console.log('[ingest worker] not started (RUN_WORKER=false): uploads will wait in the queue')
closeQueueOnShutdown(worker)

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`)
})
