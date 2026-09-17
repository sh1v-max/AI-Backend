import { useState } from 'react'
import { sendChatMessage } from '../api/chat'
import type { ChatMessage } from '../types/chat'

export function useChat(selectedId: string | null) {
  // Keyed by documentId so switching between documents keeps each chat
  // history separate instead of one shared thread across every document.
  const [chatsByDocument, setChatsByDocument] = useState<Record<string, ChatMessage[]>>({})

  // One sessionId per document's conversation — generated once, reused for
  // every message in that thread, so the backend can replay history into
  // the prompt. Without this, every message would look like a brand new
  // conversation with no memory of what came before.
  const [sessionsByDocument, setSessionsByDocument] = useState<Record<string, string>>({})
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)

  const messages = selectedId ? chatsByDocument[selectedId] ?? [] : []

  function appendMessage(documentId: string, message: ChatMessage) {
    setChatsByDocument((prev) => ({
      ...prev,
      [documentId]: [...(prev[documentId] ?? []), message],
    }))
  }

  async function sendMessage(message: string) {
    if (!message || !selectedId || chatLoading) return

    const documentId = selectedId
    const sessionId = sessionsByDocument[documentId] ?? crypto.randomUUID()
    if (!sessionsByDocument[documentId]) {
      setSessionsByDocument((prev) => ({ ...prev, [documentId]: sessionId }))
    }

    appendMessage(documentId, { role: 'user', content: message })
    setChatInput('')
    setChatLoading(true)

    try {
      const { answer, sources } = await sendChatMessage(documentId, message, sessionId)
      appendMessage(documentId, { role: 'assistant', content: answer, sources })
    } catch (err) {
      appendMessage(documentId, {
        role: 'assistant',
        content: err instanceof Error ? err.message : 'Something went wrong',
        isError: true,
      })
    } finally {
      setChatLoading(false)
    }
  }

  return { messages, chatInput, setChatInput, chatLoading, sendMessage }
}
