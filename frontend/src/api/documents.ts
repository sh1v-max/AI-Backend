import { API_URL, parseJsonOrThrow } from './client'
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
  const res = await fetch(`${API_URL}/documents`)
  const docs: DocumentRecord[] = await res.json()

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
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch(`${API_URL}/upload`, {
    method: 'POST',
    body: formData,
  })

  const data = await parseJsonOrThrow(res)

  return {
    documentId: data.documentId,
    filename: data.filename,
    fileSizeBytes: data.fileSizeBytes,
    textLength: data.textLength,
    chunkCount: data.chunkCount,
    createdAt: data.createdAt,
  }
}
