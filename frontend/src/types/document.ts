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
