import type { Request, Response } from 'express'
import { CONNECTION_ERROR_MESSAGE } from '../config'

// Every chat step talks to something over the network (Gemini, Neon), and any
// of them can fail on a weak/dropped connection. Without this, the rejection
// escapes as a bare "500 Internal Server Error" and the real cause is only
// visible as a stack trace. This logs the real error to the terminal and gives
// the client a clear message instead. If a stream already started (headers
// sent, so the status can no longer change), it closes the stream cleanly.

// Drizzle's failed-query errors carry the SQL *and every bound parameter* in
// their message — for a vector search that's all 3072 embedding numbers, which
// buries the real reason. Print just: the first line of the message, the chain
// of underlying causes (where the real reason lives, e.g. ECONNRESET), and the
// first stack frame inside our own code.
export function summarizeError(err: unknown): string {
  const clip = (s: string, max = 200) => (s.length > max ? `${s.slice(0, max)}…` : s)
  const lines: string[] = []

  let current: unknown = err
  for (let depth = 0; current && depth < 5; depth++) {
    const e = current as { message?: string; code?: string; cause?: unknown }
    const message = clip(String(e.message ?? current).split('\n')[0])
    lines.push(`${depth === 0 ? '' : '  ← caused by: '}${message}${e.code ? ` (code: ${e.code})` : ''}`)
    current = e.cause
  }

  const frame = String((err as { stack?: string })?.stack ?? '')
    .split('\n')
    .find((l) => l.includes('    at ') && !l.includes('node_modules') && !l.includes('node:internal'))
  if (frame) lines.push(`  where: ${frame.trim().replace(/^at /, '')}`)

  return lines.length > 0 ? lines.join('\n') : String(err)
}

export function withErrorHandling(
  label: string,
  handler: (req: Request, res: Response) => Promise<unknown>,
  { sse = false } = {},
) {
  return async (req: Request, res: Response) => {
    try {
      await handler(req, res)
    } catch (err) {
      console.error(`[${label}] failed: ${summarizeError(err)}`)
      // EventSource can't read the body of a non-200 response (it only sees
      // "connection error"), so for the stream route the error goes out as a
      // real SSE `event: error` frame, which the frontend already displays.
      if (sse) {
        if (!res.headersSent) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
        }
        if (!res.writableEnded) {
          res.write(`event: error\ndata: ${JSON.stringify({ error: CONNECTION_ERROR_MESSAGE })}\n\n`)
          res.end()
        }
      } else if (!res.headersSent) {
        res.status(503).json({ error: CONNECTION_ERROR_MESSAGE })
      } else if (!res.writableEnded) {
        res.end()
      }
    }
  }
}
