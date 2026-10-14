import { useEffect, useRef, useState } from 'react'
import { deleteDocument as deleteDocumentRequest, fetchDocuments, uploadDocument } from '../api/documents'
import { log } from '../utils/logger'
import {
  DOCUMENT_POLL_MS,
  DOCUMENT_POLL_SLOW_AFTER_MS,
  DOCUMENT_POLL_SLOW_MS,
  READY_WAIT_MS,
} from '../types/document'
import type { UploadedDocument, UploadStatus } from '../types/document'

export function useDocuments() {
  const [documents, setDocuments] = useState<UploadedDocument[]>([])
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  // UI.1 — the name of the file being uploaded, for the progress chip in the
  // home screen's chat box (status alone doesn't say WHICH file)
  const [uploadingName, setUploadingName] = useState<string | null>(null)

  // BG.4 — bumped on every local change to the list (an upload added a
  // document, a delete removed one). A poll that STARTED before such a change
  // brings back an older list: without this, a poll sent just before an
  // upload finished could wipe the new document from state for 2 s.
  const listVersion = useRef(0)

  // BG.4 — uploads waiting for their document to leave 'processing',
  // documentId → resolve. See waitUntilProcessed().
  const waiters = useRef(new Map<string, (doc: UploadedDocument | null) => void>())

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

  // BG.4 — the server answers an upload before the PDF is searchable, so ask
  // again until nothing is 'processing'. The effect depends on the BOOLEAN,
  // not on `documents`: each poll replaces the array, and depending on it
  // would tear down and restart the timer on every poll. This way it starts
  // when the first document starts processing and stops (cleanup) when none
  // is. setTimeout after each answer, not setInterval: a slow response can
  // never pile up requests.
  const anyProcessing = documents.some((d) => d.status === 'processing')

  useEffect(() => {
    if (!anyProcessing) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const started = Date.now()
    log.info('useDocuments', `a document is processing — polling GET /documents every ${DOCUMENT_POLL_MS / 1000} s`)

    async function poll() {
      const versionAtStart = listVersion.current
      try {
        const docs = await fetchDocuments()
        if (cancelled) return
        if (versionAtStart !== listVersion.current) {
          log.info('useDocuments', 'poll answer is older than a local change — ignored, next poll will catch up')
        } else {
          setDocuments(docs)
        }
      } catch (err) {
        // a dropped request isn't fatal: keep asking
        log.warn('useDocuments', 'poll failed (will retry)', err)
      }
      if (cancelled) return
      const slow = Date.now() - started > DOCUMENT_POLL_SLOW_AFTER_MS
      timer = setTimeout(poll, slow ? DOCUMENT_POLL_SLOW_MS : DOCUMENT_POLL_MS)
    }

    timer = setTimeout(poll, DOCUMENT_POLL_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
      log.info('useDocuments', 'nothing processing — polling stopped')
    }
  }, [anyProcessing])

  // BG.4 — after every change to the list, settle any upload that's waiting:
  // its document is ready or failed (resolve with it), or gone (deleted while
  // processing: resolve with null).
  useEffect(() => {
    for (const [documentId, resolve] of waiters.current) {
      const doc = documents.find((d) => d.documentId === documentId)
      if (!doc || doc.status !== 'processing') {
        waiters.current.delete(documentId)
        resolve(doc ?? null)
      }
    }
  }, [documents])

  // BG.4 — resolves once the polling above sees the document leave
  // 'processing' (or disappear), or with 'timeout' after READY_WAIT_MS.
  function waitUntilProcessed(documentId: string): Promise<UploadedDocument | null | 'timeout'> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiters.current.delete(documentId)
        resolve('timeout')
      }, READY_WAIT_MS)
      waiters.current.set(documentId, (doc) => {
        clearTimeout(timer)
        resolve(doc)
      })
    })
  }

  // BG.4 — resolves with the document only once it's READY, not when the
  // upload request returns. Everything that waits on an upload (the progress
  // chip, the queued "Will ask" question, opening a chat about the new file)
  // therefore keeps working exactly as when the whole upload happened inside
  // one long request: it just isn't one long request anymore.
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
    setUploadingName(file.name)

    try {
      const doc = await uploadDocument(file)
      log.info('useDocuments', 'upload accepted, adding to state', doc)
      listVersion.current++
      setDocuments((prev) => [doc, ...prev])

      if (doc.status === 'ready') {
        setStatus('idle')
        return doc
      }

      log.info('useDocuments', `"${doc.filename}" is processing — waiting for it to be ready`)
      const outcome = await waitUntilProcessed(doc.documentId)

      if (outcome === 'timeout') {
        log.warn('useDocuments', `"${doc.filename}" still processing after ${READY_WAIT_MS / 1000} s — not waiting any longer`)
        setError(`"${doc.filename}" is taking longer than usual. It keeps processing: once it's ready in the sidebar, you can ask about it.`)
        setStatus('error')
        return null
      }
      if (outcome === null) {
        log.info('useDocuments', `"${doc.filename}" was deleted while processing`)
        setStatus('idle')
        return null
      }
      if (outcome.status === 'failed') {
        log.error('useDocuments', `"${doc.filename}" failed to process`, outcome.error)
        setError(outcome.error ?? 'Could not process this PDF.')
        setStatus('error')
        return null
      }
      log.info('useDocuments', `"${doc.filename}" is ready`)
      setStatus('idle')
      return outcome
    } catch (err) {
      log.error('useDocuments', 'upload failed', err)
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setStatus('error')
      return null
    } finally {
      setUploadingName(null)
    }
  }

  // UI.3 — for a failure that happens before uploadFile() is even called
  // (fetching the sample PDF), shown in the same error banner as an upload error
  function showUploadError(message: string) {
    setError(message)
    setStatus('error')
  }

  async function deleteDocument(documentId: string): Promise<boolean> {
    log.info('useDocuments', `deleteDocument() called — ${documentId}`)
    try {
      await deleteDocumentRequest(documentId)
      listVersion.current++
      setDocuments((prev) => prev.filter((d) => d.documentId !== documentId))
      log.info('useDocuments', `document ${documentId} removed from state`)
      return true
    } catch (err) {
      log.error('useDocuments', `delete failed for ${documentId}`, err)
      return false
    }
  }

  return { documents, status, error, uploadingName, uploadFile, showUploadError, deleteDocument }
}
