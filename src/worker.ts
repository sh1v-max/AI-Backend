import 'dotenv/config'
import { startIngestWorker } from './workers/ingest.worker'
import { closeQueueOnShutdown } from './queue/shutdown'

// BG.2 — the worker on its own, without the API: `npm run worker`.
//
// On Render's free tier there's no separate worker service, so in production
// the worker runs inside the API process instead (index.ts, BG.3). This entry
// point is what makes moving it out later a config change, not a rewrite: a
// paid background-worker service would just run this file.
//
// Don't run it alongside an API that also starts a worker on the same
// BULLMQ_PREFIX unless you mean to — two workers share the jobs between them.

closeQueueOnShutdown(startIngestWorker())
