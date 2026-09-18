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

interface StreamHandlers {
  onMeta: (meta: { sessionId: string; sources: ChatSource[] }) => void
  onChunk: (text: string) => void
  onDone: () => void
  onError: (message: string) => void
}

// Step 3.2F — EventSource only supports GET, so the params go in the URL,
// not a JSON body like sendChatMessage above. Returns a cleanup function
// that closes the connection (call it if the component unmounts mid-stream).
export function streamChatMessage(
  documentId: string,
  message: string,
  sessionId: string,
  handlers: StreamHandlers,
): () => void {
  const url = new URL(`${API_URL}/chat-stream`)
  url.searchParams.set('documentId', documentId)
  url.searchParams.set('message', message)
  url.searchParams.set('sessionId', sessionId)

  log.info('api:chat', `GET /chat-stream — session=${sessionId} document=${documentId}`, { message })

  const source = new EventSource(url.toString())

  source.addEventListener('meta', (e) => {
    const data = JSON.parse((e as MessageEvent).data)
    log.info('api:chat', 'stream meta received', data)
    handlers.onMeta(data)
  })

  source.onmessage = (e) => {
    const data = JSON.parse(e.data)
    handlers.onChunk(data.text)
  }

  source.addEventListener('done', () => {
    log.info('api:chat', 'stream finished')
    handlers.onDone()
    source.close()
  })

  // EventSource fires this native 'error' event both for our own named
  // `event: error` SSE frames (has e.data, a real MessageEvent) and for
  // plain connection failures (no e.data) — handle both, since they need
  // different messages.
  source.addEventListener('error', (e) => {
    const messageEvent = e as MessageEvent
    if (messageEvent.data) {
      const data = JSON.parse(messageEvent.data)
      log.error('api:chat', 'stream error event', data)
      handlers.onError(data.error || 'Streaming failed')
    } else {
      log.error('api:chat', 'stream connection error', e)
      handlers.onError('Connection lost')
    }
    source.close()
  })

  return () => source.close()
}
