import { authFetch, parseJsonOrThrow } from './client'
import { log } from '../utils/logger'
import type { DocumentStatus, UploadedDocument } from '../types/document'

interface DocumentRecord {
  id: string
  filename: string
  fileSizeBytes: number
  textLength: number
  chunkCount: number
  createdAt: string
  // BG.4 — optional in the type on purpose: a backend from before Phase 6
  // doesn't send them, and those documents are always ready
  status?: DocumentStatus
  error?: string | null
}

export async function fetchDocuments(): Promise<UploadedDocument[]> {
  log.info('api:documents', 'GET /documents')
  const res = await authFetch('/documents')
  // Auth.4 — was a bare res.json(). On a 401 that returns { error: '...' },
  // and the .map() below would crash on it. parseJsonOrThrow checks res.ok
  // first and throws a readable error instead.
  const docs: DocumentRecord[] = await parseJsonOrThrow(res)
  log.info('api:documents', `received ${docs.length} document(s)`, docs)

  return docs.map((d) => ({
    documentId: d.id,
    filename: d.filename,
    fileSizeBytes: d.fileSizeBytes,
    textLength: d.textLength,
    chunkCount: d.chunkCount,
    createdAt: d.createdAt,
    status: d.status ?? 'ready',
    error: d.error ?? null,
  }))
}

export async function uploadDocument(file: File): Promise<UploadedDocument> {
  log.info('api:documents', `POST /upload — "${file.name}" (${file.size} bytes)`)

  const formData = new FormData()
  formData.append('file', file)

  // No Content-Type header on purpose: for FormData the browser sets it itself,
  // including the multipart "boundary" string that separates the parts.
  // authFetch only adds Authorization, so that still works.
  const res = await authFetch('/upload', {
    method: 'POST',
    body: formData,
  })

  // BG.4 — 202 Accepted now (status 'processing'): the server has the file and
  // has queued the slow part. res.ok is true for any 2xx, so this needs no
  // change; it's the status field that says whether it's usable yet.
  const data = await parseJsonOrThrow(res)
  log.info('api:documents', `upload accepted (${res.status}), status: ${data.status ?? 'ready'}`, data)

  return {
    documentId: data.documentId,
    filename: data.filename,
    fileSizeBytes: data.fileSizeBytes,
    textLength: data.textLength,
    chunkCount: data.chunkCount,
    createdAt: data.createdAt,
    // a pre-Phase-6 backend answers 200 with no status: the document is ready
    status: data.status ?? 'ready',
    error: null,
  }
}

export async function deleteDocument(documentId: string): Promise<void> {
  log.info('api:documents', `DELETE /documents/${documentId}`)
  const res = await parseJsonOrThrow(await authFetch(`/documents/${documentId}`, { method: 'DELETE' }))
  log.info('api:documents', 'delete complete', res)
}
