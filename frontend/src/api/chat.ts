import { API_URL, parseJsonOrThrow } from './client'
import { log } from '../utils/logger'
import type { ChatSource } from '../types/chat'

interface ChatResponse {
  sessionId: string
  answer: string
  sources: ChatSource[]
}

export async function sendChatMessage(
  documentId: string,
  message: string,
  sessionId: string,
): Promise<ChatResponse> {
  log.info('api:chat', `POST /chat — session=${sessionId} document=${documentId}`, { message })

  const res = await fetch(`${API_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId, message, sessionId }),
  })

  const data: ChatResponse = await parseJsonOrThrow(res)
  log.info('api:chat', `answer received (${data.sources.length} source(s))`, data)

  return data
}
