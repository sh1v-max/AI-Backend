import { useEffect, useState } from 'react'
import { fetchDocuments, uploadDocument } from '../api/documents'
import { log } from '../utils/logger'
import type { UploadedDocument, UploadStatus } from '../types/document'

export function useDocuments() {
  const [documents, setDocuments] = useState<UploadedDocument[]>([])
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  // Load whatever documents already exist on the server — not just ones this
  // tab uploaded itself. Without this, a document uploaded via Postman/curl
  // (or from a different browser tab) would never show up here.
  useEffect(() => {
    log.info('useDocuments', 'mount — loading existing documents')
    fetchDocuments()
      .then((docs) => {
        log.info('useDocuments', `loaded ${docs.length} document(s) into state`)
        setDocuments(docs)
      })
      .catch((err) => {
        log.warn('useDocuments', 'initial document fetch failed (non-fatal)', err)
      })
  }, [])

  async function uploadFile(file: File): Promise<UploadedDocument | null> {
    log.info('useDocuments', `uploadFile() called — "${file.name}" (${file.type}, ${file.size} bytes)`)

    if (file.type !== 'application/pdf') {
      log.warn('useDocuments', 'rejected — not a PDF')
      setStatus('error')
      setError('Only PDF files are supported.')
      return null
    }

    setStatus('uploading')
    setError(null)

    try {
      const doc = await uploadDocument(file)
      log.info('useDocuments', 'upload succeeded, adding to state', doc)
      setDocuments((prev) => [doc, ...prev])
      setStatus('idle')
      return doc
    } catch (err) {
      log.error('useDocuments', 'upload failed', err)
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setStatus('error')
      return null
    }
  }

  return { documents, status, error, uploadFile }
}
