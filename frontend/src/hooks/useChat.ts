import { useEffect, useState } from 'react'
import { sendChatMessage } from '../api/chat'
import { fetchSessionMessages, fetchSessions } from '../api/sessions'
import { log } from '../utils/logger'
import type { ChatMessage, SessionSummary } from '../types/chat'

const ACTIVE_SESSION_KEY = 'docmind:activeSessionId'

export interface ActiveDocument {
  documentId: string
  filename: string
}

export function useChat(onMessageSent: () => void) {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [activeDocument, setActiveDocument] = useState<ActiveDocument | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [restoring, setRestoring] = useState(true)

  // On first load, resume whatever conversation was open last time — a
  // sessionId alone isn't enough to render anything, so it's cross-checked
  // against /sessions to recover which document it belongs to.
  useEffect(() => {
    const savedId = localStorage.getItem(ACTIVE_SESSION_KEY)
    log.info('useChat', `restore on mount — localStorage sessionId: ${savedId ?? '(none)'}`)

    if (!savedId) {
      setRestoring(false)
      return
    }

    Promise.all([fetchSessions(), fetchSessionMessages(savedId)])
      .then(([sessions, savedMessages]) => {
        const summary = sessions.find((s) => s.sessionId === savedId)

        if (!summary) {
          log.warn('useChat', `saved sessionId ${savedId} not found in /sessions — dropping it`)
          localStorage.removeItem(ACTIVE_SESSION_KEY)
          return
        }

        log.info('useChat', `restored session ${savedId}`, {
          document: summary.filename,
          messageCount: savedMessages.length,
        })

        setActiveSessionId(savedId)
        setActiveDocument({
          documentId: summary.documentId,
          filename: summary.filename ?? 'Untitled document',
        })
        setMessages(savedMessages)
      })
      .catch((err) => {
        log.error('useChat', 'session restore failed — falling back to new-chat screen', err)
      })
      .finally(() => setRestoring(false))
  }, [])

  function startNewChat(documentId: string, filename: string) {
    log.info('useChat', `startNewChat() — document="${filename}" (${documentId})`)
    setActiveSessionId(null)
    setActiveDocument({ documentId, filename })
    setMessages([])
    setChatInput('')
    localStorage.removeItem(ACTIVE_SESSION_KEY)
  }

  function resetToWelcome() {
    log.info('useChat', 'resetToWelcome() — clearing active session/document')
    setActiveSessionId(null)
    setActiveDocument(null)
    setMessages([])
    localStorage.removeItem(ACTIVE_SESSION_KEY)
  }

  async function openSession(summary: SessionSummary) {
    log.info('useChat', `openSession() — ${summary.sessionId} ("${summary.title}")`)
    setActiveSessionId(summary.sessionId)
    setActiveDocument({
      documentId: summary.documentId,
      filename: summary.filename ?? 'Untitled document',
    })
    setMessages([])
    localStorage.setItem(ACTIVE_SESSION_KEY, summary.sessionId)

    try {
      const loaded = await fetchSessionMessages(summary.sessionId)
      log.info('useChat', `loaded ${loaded.length} message(s) for session ${summary.sessionId}`)
      setMessages(loaded)
    } catch (err) {
      log.error('useChat', `failed to load messages for session ${summary.sessionId}`, err)
    }
  }

  async function sendMessage(message: string) {
    if (!message || !activeDocument || chatLoading) {
      log.warn('useChat', 'sendMessage() ignored', {
        hasMessage: !!message,
        hasActiveDocument: !!activeDocument,
        chatLoading,
      })
      return
    }

    const documentId = activeDocument.documentId
    const isNewSession = !activeSessionId
    const sessionId = activeSessionId ?? crypto.randomUUID()

    log.info('useChat', `sendMessage() — session=${sessionId} (${isNewSession ? 'new' : 'existing'})`, {
      documentId,
      message,
    })

    setMessages((prev) => [...prev, { role: 'user', content: message }])
    setChatInput('')
    setChatLoading(true)

    try {
      const res = await sendChatMessage(documentId, message, sessionId)
      log.info('useChat', 'reply received, appending to thread', {
        sources: res.sources.length,
      })
      setMessages((prev) => [...prev, { role: 'assistant', content: res.answer, sources: res.sources }])

      if (isNewSession) {
        log.info('useChat', `first message in this thread — session ${res.sessionId} is now active`)
        setActiveSessionId(res.sessionId)
        localStorage.setItem(ACTIVE_SESSION_KEY, res.sessionId)
      }

      onMessageSent()
    } catch (err) {
      log.error('useChat', 'sendMessage() failed', err)
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: err instanceof Error ? err.message : 'Something went wrong',
          isError: true,
        },
      ])
    } finally {
      setChatLoading(false)
    }
  }

  return {
    activeSessionId,
    activeDocument,
    messages,
    chatInput,
    setChatInput,
    chatLoading,
    restoring,
    startNewChat,
    resetToWelcome,
    openSession,
    sendMessage,
  }
}
