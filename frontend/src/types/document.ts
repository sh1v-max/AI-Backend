// BG.4 — where a document is in its life on the server (Phase 6): POST
// /upload answers right away with 'processing', a background worker embeds
// the chunks, then it's 'ready' (searchable) or 'failed' (every retry used up).
// Must match DocumentStatus in the backend's documents.repository.ts.
export type DocumentStatus = 'processing' | 'ready' | 'failed'

export interface UploadedDocument {
  documentId: string
  filename: string
  fileSizeBytes: number
  textLength: number
  chunkCount: number
  createdAt: string
  status: DocumentStatus
  // a short, user-safe reason when status is 'failed', otherwise null
  error: string | null
}

export type UploadStatus = 'idle' | 'uploading' | 'error'

// Step 3.3 — the documentId that means "search every uploaded document".
// Must match ALL_DOCUMENTS in the backend's config.ts; the server also
// treats a missing documentId the same way.
export const ALL_DOCUMENTS = 'all'
export const ALL_DOCUMENTS_LABEL = 'All documents'

// UI.5 — the per-user document caps, for the sidebar's "3 / 5" counter. Must
// match GUEST_MAX_DOCUMENTS / USER_MAX_DOCUMENTS in the backend's config.ts;
// the backend is what actually enforces them (403 on /upload).
export const GUEST_MAX_DOCUMENTS = 5
export const USER_MAX_DOCUMENTS = 10

// BG.4 — while any document is 'processing', GET /documents is asked again
// every DOCUMENT_POLL_MS. A normal PDF is ready in seconds; if one takes
// longer than DOCUMENT_POLL_SLOW_AFTER_MS (stuck, or waiting for a crashed
// worker to come back, which can take ~10 min), the polling slows down so a
// forgotten tab doesn't keep hitting the API (and the database) every 2 s.
export const DOCUMENT_POLL_MS = 2_000
export const DOCUMENT_POLL_SLOW_MS = 10_000
export const DOCUMENT_POLL_SLOW_AFTER_MS = 60_000

// BG.4 — how long an upload waits for its document to turn 'ready' before it
// stops holding the home screen's progress chip. The document keeps
// processing on the server either way; the sidebar shows when it's ready.
export const READY_WAIT_MS = 120_000
