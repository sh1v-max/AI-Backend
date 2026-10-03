import { authFetch, parseJsonOrThrow } from './client'
import { log } from '../utils/logger'
import type { UploadedDocument } from '../types/document'

interface DocumentRecord {
  id: string
  filename: string
  fileSizeBytes: number
  textLength: number
  chunkCount: number
  createdAt: string
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

  const data = await parseJsonOrThrow(res)
  log.info('api:documents', 'upload complete', data)

  return {
    documentId: data.documentId,
    filename: data.filename,
    fileSizeBytes: data.fileSizeBytes,
    textLength: data.textLength,
    chunkCount: data.chunkCount,
    createdAt: data.createdAt,
  }
}

export async function deleteDocument(documentId: string): Promise<void> {
  log.info('api:documents', `DELETE /documents/${documentId}`)
  const res = await parseJsonOrThrow(await authFetch(`/documents/${documentId}`, { method: 'DELETE' }))
  log.info('api:documents', 'delete complete', res)
}
