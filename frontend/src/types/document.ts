export interface UploadedDocument {
  documentId: string
  filename: string
  fileSizeBytes: number
  textLength: number
  chunkCount: number
  createdAt: string
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
