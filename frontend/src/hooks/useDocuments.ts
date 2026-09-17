import { useEffect, useState } from 'react'
import { fetchDocuments, uploadDocument } from '../api/documents'
import type { UploadedDocument, UploadStatus } from '../types/document'

export function useDocuments() {
  const [documents, setDocuments] = useState<UploadedDocument[]>([])
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  // Load whatever documents already exist on the server — not just ones this
  // tab uploaded itself. Without this, a document uploaded via Postman/curl
  // (or from a different browser tab) would never show up here.
  useEffect(() => {
    fetchDocuments()
      .then(setDocuments)
      .catch(() => {
        // Non-fatal — the upload flow still works even if this initial fetch fails
      })
  }, [])

  async function uploadFile(file: File): Promise<UploadedDocument | null> {
    if (file.type !== 'application/pdf') {
      setStatus('error')
      setError('Only PDF files are supported.')
      return null
    }

    setStatus('uploading')
    setError(null)

    try {
      const doc = await uploadDocument(file)
      setDocuments((prev) => [doc, ...prev])
      setStatus('idle')
      return doc
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setStatus('error')
      return null
    }
  }

  return { documents, status, error, uploadFile }
}
