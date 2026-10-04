import { authFetch, parseJsonOrThrow } from './client'
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

  const res = await authFetch('/chat', {
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

// Auth.5 — reads one SSE frame (the text between two blank lines) into its
// event name and data. A frame looks like:
//
//   event: meta              ← optional; no `event:` line = the default event
//   data: {"sessionId":...}
//
// The SSE spec allows several `data:` lines in one frame (they're joined with
// a newline); our server only ever sends one, but it costs nothing to follow
// the spec. Lines starting with ':' are comments (servers use them as
// keep-alive pings) and are skipped, as are fields we don't use (id, retry).
function parseFrame(frame: string): { event: string; data: string } | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
  }
  return dataLines.length > 0 ? { event, data: dataLines.join('\n') } : null
}

// Step 3.2F — the params go in the URL (GET), not a JSON body like
// sendChatMessage above. Returns a cleanup function that stops the stream
// (call it if the component unmounts mid-stream).
//
// Auth.5 — this used the browser's EventSource, which CANNOT send an
// Authorization header (its constructor takes a URL and nothing else), so
// after Auth.2 every stream got a 401. It now uses fetch() and reads the
// response body as a stream, which allows headers. The server didn't change
// at all: same GET /chat-stream, same four frame types. The cost is that we
// parse the SSE frames ourselves, which is the same job streamAnswer() does
// on the backend for Gemini's stream.
//
// The signature and the handlers are unchanged, so useChat.ts doesn't know
// anything changed.
export function streamChatMessage(
  documentId: string,
  message: string,
  sessionId: string,
  handlers: StreamHandlers,
): () => void {
  const params = new URLSearchParams({ documentId, message, sessionId })

  log.info('api:chat', `GET /chat-stream — session=${sessionId} document=${documentId}`, { message })

  // AbortController is fetch's "cancel" button: controller.abort() stops the
  // request and makes the pending reader.read() throw an AbortError.
  const controller = new AbortController()

  // useChat waits for exactly one onDone OR onError — a second call would
  // resolve its promise twice and could leave an error bubble under a
  // finished answer. `finished` makes sure only the first one goes through.
  let finished = false
  function finish(outcome: { error: string } | 'done') {
    if (finished) return
    finished = true
    if (outcome === 'done') handlers.onDone()
    else handlers.onError(outcome.error)
  }

  function dispatch(frame: string) {
    const parsed = parseFrame(frame)
    if (!parsed) return
    const data = JSON.parse(parsed.data)

    switch (parsed.event) {
      case 'meta':
        log.info('api:chat', 'stream meta received', data)
        handlers.onMeta(data)
        break
      case 'message': // no `event:` line — one piece of the answer
        handlers.onChunk(data.text)
        break
      case 'done':
        log.info('api:chat', 'stream finished')
        finish('done')
        break
      case 'error': // our own `event: error` frame (see withErrorHandling)
        log.error('api:chat', 'stream error event', data)
        finish({ error: data.error || 'Streaming failed' })
        break
    }
  }

  async function run() {
    const res = await authFetch(`/chat-stream?${params}`, { signal: controller.signal })

    // A real bonus over EventSource: it could never read the body of a
    // non-200 response, so a 400/404 showed up as "Connection lost". fetch
    // can, so the server's actual message reaches the user.
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({}))
      log.error('api:chat', `stream rejected — ${res.status}`, body)
      finish({ error: body.error || `Request failed with status ${res.status}` })
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break

      // { stream: true } — a multi-byte character (an emoji, an accented
      // letter) can be split across two network chunks; this tells the
      // decoder to hold the half until the rest arrives.
      // \r\n → \n on the WHOLE buffer, not each chunk, in case a \r\n pair
      // is itself split across two reads (same fix as streamAnswer()).
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n')

      // A blank line ends a frame. The last piece after the final '\n\n' may
      // be half a frame, so it stays in the buffer for the next read.
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''
      for (const frame of frames) dispatch(frame)
    }

    // The server always ends with `done` or `error`. Reaching the end of the
    // body without either means the connection dropped mid-answer — without
    // this the UI would sit on "Thinking…" forever. (EventSource used to
    // report this as its native error event.)
    finish({ error: 'Connection lost' })
  }

  run().catch((err) => {
    // abort() from the cleanup function: not a failure, nobody is listening.
    if (err instanceof DOMException && err.name === 'AbortError') return
    log.error('api:chat', 'stream connection error', err)
    finish({ error: 'Connection lost' })
  })

  return () => controller.abort()
}
