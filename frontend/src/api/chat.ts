import { API_URL, parseJsonOrThrow } from './client'
import type { ChatSource } from '../types/chat'

interface ChatResponse {
  answer: string
  sources: ChatSource[]
}

export async function sendChatMessage(
  documentId: string,
  message: string,
  sessionId: string,
): Promise<ChatResponse> {
  const res = await fetch(`${API_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId, message, sessionId }),
  })

  return parseJsonOrThrow(res)
}
