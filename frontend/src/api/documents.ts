import { API_URL, parseJsonOrThrow } from './client'
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
  const res = await fetch(`${API_URL}/documents`)
  const docs: DocumentRecord[] = await res.json()
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

  const res = await fetch(`${API_URL}/upload`, {
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
