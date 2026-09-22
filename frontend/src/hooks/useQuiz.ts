import { useState } from 'react'
import { generateQuiz as generateQuizRequest } from '../api/quiz'
import { log } from '../utils/logger'
import type { Quiz } from '../types/quiz'

// Step 4.2F — the "Generate quiz" button's state. Deliberately its own hook,
// not folded into useChat — a quiz isn't part of the conversation, it's a
// one-off request the button triggers, shown in its own overlay on top of
// whatever chat is currently open.
export function useQuiz() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [documentId, setDocumentId] = useState<string | null>(null)
  const [filename, setFilename] = useState<string | null>(null)

  async function generate(docId: string, docFilename: string) {
    log.info('useQuiz', `generate() — document=${docId}`)
    setOpen(true)
    setLoading(true)
    setError(null)
    setQuiz(null)
    setDocumentId(docId)
    setFilename(docFilename)

    try {
      const res = await generateQuizRequest(docId)
      setQuiz(res.quiz)
    } catch (err) {
      log.error('useQuiz', 'generate() failed', err)
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  // Re-runs generate() for the same document — used by the modal's
  // "Try again" (after an error) and "Regenerate" (a fresh set of questions).
  function regenerate() {
    if (documentId && filename) generate(documentId, filename)
  }

  function close() {
    setOpen(false)
  }

  return { open, loading, error, quiz, filename, generate, regenerate, close }
}
