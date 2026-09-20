import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { randomUUID } from 'crypto'
import { PDFParse } from 'pdf-parse'
import { getEmbedding } from './services/embeddings.service'
import { generateAnswer, streamAnswer } from './services/llm.service'
import { insertChunk, searchSimilar, deleteChunksByDocumentId } from './repositories/chunks.repository'
import { insertDocument, listDocuments, deleteDocument } from './repositories/documents.repository'
import {
  insertMessage,
  getRecentMessages,
  getMessagesForSession,
  listSessions,
  deleteSession,
  deleteMessagesByDocumentId,
} from './repositories/chatMessages.repository'
import {
  pipelineStart,
  pipelineEnd,
  step,
  detail,
  timing,
  preview,
  rejected,
  notFound,
} from './utils/pipelineLogger'

// Step 2.1 — PDF in, plain text out.
// Step 2.2 — chunk that text, embed each chunk, store it — a document
// becomes a set of searchable chunks, tagged with a documentId.
// Step 2.3 — POST /chat: embed the question, search stored chunks for this
// document, hand the relevant ones to the LLM, return a grounded answer.
// Step 2.4 — give /chat memory: a sessionId groups messages into one
// conversation, recent history gets replayed into every prompt so follow-up
// questions ("what about the second one?") actually resolve correctly.

const HISTORY_LIMIT = 8

const app = express()
const upload = multer({ storage: multer.memoryStorage() })

// Only affects requests with Content-Type: application/json — /upload's
// multipart/form-data requests are handled separately by Multer, so the two
// don't conflict.
app.use(express.json())

// Split text into ~500-word chunks. Deliberately simple — chunking strategy
// tradeoffs (semantic boundaries, overlap) are a later, deeper topic.
function chunkText(text: string, wordsPerChunk = 500): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const chunks: string[] = []

  for (let i = 0; i < words.length; i += wordsPerChunk) {
    chunks.push(words.slice(i, i + wordsPerChunk).join(' '))
  }

  return chunks
}

// Shared by /chat and /chat-stream — same grounding + history instructions
// either way, only how the answer gets delivered differs between them.
function buildChatPrompt(
  context: string,
  history: { role: string; content: string }[],
  message: string,
): string {
  const historyBlock =
    history.length > 0
      ? `\n\nConversation so far:\n${history.map((m) => `${m.role}: ${m.content}`).join('\n')}`
      : ''

  return `You are answering questions about a specific document. Use only the context below to answer — don't rely on outside knowledge, and don't guess.

Answer directly and naturally, like you're explaining it to someone, not like you're quoting a source. Don't start every reply with phrases like "Based on the provided context" — just answer the question. Only mention the document explicitly if it's genuinely relevant to say so (for example, if the answer isn't in it).

If the context doesn't contain the answer, say so plainly and briefly — don't pad it with an apology or a long explanation.

If there's conversation history below, use it to understand what the new question is referring to (e.g. "the first one", "what about that").

Context:
${context}${historyBlock}

New question: ${message}`
}

// The frontend (Vite dev server, localhost:5173) and this API (localhost:3000)
// are different origins even both on localhost — browsers block cross-origin
// requests by default unless the server explicitly allows them.
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  }),
)

app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'DocMind API - POST a PDF to /upload',
  })
})

// Step 3.1 — throwaway. Just the SSE mechanics in isolation: headers,
// res.write() per event, res.end() when done. Delete once understood —
// this has nothing to do with DocMind itself.
app.get('/tick', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  let count = 0
  const interval = setInterval(() => {
    count++
    res.write(`data: tick ${count}\n\n`)

    if (count >= 5) {
      clearInterval(interval)
      res.end()
    }
  }, 1000)

  // If the client disconnects early (closes the tab), stop the interval —
  // otherwise it keeps running server-side forever, writing to a dead connection.
  req.on('close', () => clearInterval(interval))
})

app.get('/documents', async (_req, res) => {
  const docs = await listDocuments()
  res.json(docs)
})

app.get('/sessions', async (_req, res) => {
  const sessions = await listSessions()
  res.json(sessions)
})

app.get('/sessions/:sessionId/messages', async (req, res) => {
  const messages = await getMessagesForSession(req.params.sessionId)
  res.json(messages)
})

// Deleting a document removes its chunks and every session's chat history
// tied to it too — otherwise chat_messages would keep rows pointing at a
// document_id that no longer exists in the documents table.
app.delete('/documents/:documentId', async (req, res) => {
  const { documentId } = req.params
  await deleteChunksByDocumentId(documentId)
  await deleteMessagesByDocumentId(documentId)
  await deleteDocument(documentId)
  res.json({ deleted: documentId })
})

app.delete('/sessions/:sessionId', async (req, res) => {
  await deleteSession(req.params.sessionId)
  res.json({ deleted: req.params.sessionId })
})

// Every chat step talks to something over the network (Gemini, Neon), and any
// of them can fail on a weak/dropped connection. Without this, the rejection
// escapes as a bare "500 Internal Server Error" and the real cause is only
// visible as a stack trace. This logs the real error to the terminal and gives
// the client a clear message instead. If a stream already started (headers
// sent, so the status can no longer change), it closes the stream cleanly.
const CONNECTION_ERROR_MESSAGE =
  'Could not reach Gemini or the database — check your internet connection and try again.'

// Drizzle's failed-query errors carry the SQL *and every bound parameter* in
// their message — for a vector search that's all 3072 embedding numbers, which
// buries the real reason. Print just: the first line of the message, the chain
// of underlying causes (where the real reason lives, e.g. ECONNRESET), and the
// first stack frame inside our own code.
function summarizeError(err: unknown): string {
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

function withErrorHandling(
  label: string,
  handler: (req: express.Request, res: express.Response) => Promise<unknown>,
  { sse = false } = {},
) {
  return async (req: express.Request, res: express.Response) => {
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

app.post('/chat', withErrorHandling('POST /chat', async (req, res) => {
  const t0 = Date.now()
  const { documentId, message } = req.body
  const sessionId: string = req.body.sessionId || randomUUID()

  pipelineStart('chat', 'POST /chat')

  if (!documentId || typeof documentId !== 'string') {
    rejected('missing/invalid documentId')
    return res.status(400).json({ error: 'documentId (string) is required' })
  }

  if (!message || typeof message !== 'string') {
    rejected('missing/invalid message')
    return res.status(400).json({ error: 'message (string) is required' })
  }

  step('chat', 1, 7, 'Request received')
  detail(`sessionId:  ${sessionId}`)
  detail(`documentId: ${documentId}`)
  detail(`message:    "${message}"`)

  step('chat', 2, 7, 'Embedding the question...')
  const embedStart = Date.now()
  const questionEmbedding = await getEmbedding(message)
  timing(Date.now() - embedStart, `vector has ${questionEmbedding.length} dimensions`)

  step('chat', 3, 7, 'Searching stored chunks (scoped to this documentId, top 3 by cosine distance)...')
  const searchStart = Date.now()
  const relevantChunks = await searchSimilar(questionEmbedding, 3, documentId)
  timing(Date.now() - searchStart, `found ${relevantChunks.length} chunk(s)`)

  if (relevantChunks.length === 0) {
    notFound('No chunks found for this documentId — does it exist?')
    pipelineEnd('chat', Date.now() - t0)
    return res.status(404).json({ error: 'No document found with that documentId' })
  }

  relevantChunks.forEach((c, i) => {
    preview(`#${i + 1} distance=${c.distance.toFixed(4)}`, c.content)
  })

  step('chat', 4, 7, `Loading conversation history (last ${HISTORY_LIMIT} messages)...`)
  const history = await getRecentMessages(sessionId, HISTORY_LIMIT)
  detail(`${history.length} prior message(s) in this session`)

  // Saved *before* generating, so history for the *next* turn already
  // includes this one — but built into *this* turn's prompt from the
  // `history` pulled a moment ago, not including the message being answered.
  await insertMessage(sessionId, documentId, 'user', message)

  const context = relevantChunks.map((c) => c.content).join('\n\n')
  const prompt = buildChatPrompt(context, history, message)
  step('chat', 5, 7, `Built prompt — ${prompt.length} characters`)

  step('chat', 6, 7, 'Calling the LLM to generate an answer...')
  const genStart = Date.now()
  const answer = await generateAnswer(prompt)
  timing(Date.now() - genStart)
  preview('answer', answer, 150)

  step('chat', 7, 7, 'Saving assistant reply to history')
  await insertMessage(sessionId, documentId, 'assistant', answer)

  pipelineEnd('chat', Date.now() - t0)

  res.json({
    sessionId,
    answer,
    sources: relevantChunks.map((c) => ({ content: c.content, distance: c.distance })),
  })
}))

// Step 3.2 — same pipeline as /chat, but the reply arrives piece by piece.
// GET + query params, not POST + JSON body — EventSource (what the browser
// uses to consume SSE) can only send GET requests.
app.get('/chat-stream', withErrorHandling('GET /chat-stream', async (req, res) => {
  const t0 = Date.now()
  const documentId = req.query.documentId
  const message = req.query.message
  const sessionId = (req.query.sessionId as string) || randomUUID()

  pipelineStart('chat', 'GET /chat-stream')

  if (!documentId || typeof documentId !== 'string') {
    rejected('missing/invalid documentId')
    return res.status(400).json({ error: 'documentId (string) is required' })
  }

  if (!message || typeof message !== 'string') {
    rejected('missing/invalid message')
    return res.status(400).json({ error: 'message (string) is required' })
  }

  step('chat', 1, 7, 'Request received')
  detail(`sessionId:  ${sessionId}`)
  detail(`documentId: ${documentId}`)
  detail(`message:    "${message}"`)

  step('chat', 2, 7, 'Embedding the question...')
  const embedStart = Date.now()
  const questionEmbedding = await getEmbedding(message)
  timing(Date.now() - embedStart, `vector has ${questionEmbedding.length} dimensions`)

  step('chat', 3, 7, 'Searching stored chunks (scoped to this documentId, top 3 by cosine distance)...')
  const searchStart = Date.now()
  const relevantChunks = await searchSimilar(questionEmbedding, 3, documentId)
  timing(Date.now() - searchStart, `found ${relevantChunks.length} chunk(s)`)

  if (relevantChunks.length === 0) {
    notFound('No chunks found for this documentId — does it exist?')
    pipelineEnd('chat', Date.now() - t0)
    return res.status(404).json({ error: 'No document found with that documentId' })
  }

  relevantChunks.forEach((c, i) => {
    preview(`#${i + 1} distance=${c.distance.toFixed(4)}`, c.content)
  })

  step('chat', 4, 7, `Loading conversation history (last ${HISTORY_LIMIT} messages)...`)
  const history = await getRecentMessages(sessionId, HISTORY_LIMIT)
  detail(`${history.length} prior message(s) in this session`)

  await insertMessage(sessionId, documentId, 'user', message)

  const context = relevantChunks.map((c) => c.content).join('\n\n')
  const prompt = buildChatPrompt(context, history, message)
  step('chat', 5, 7, `Built prompt — ${prompt.length} characters`)

  // Send sessionId + sources as the very first event — the client needs
  // sessionId immediately (same "first message in a new thread" moment as
  // /chat's JSON response), and sources up front instead of tacked onto
  // the end once the whole stream project structure is known either way.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.write(
    `event: meta\ndata: ${JSON.stringify({
      sessionId,
      sources: relevantChunks.map((c) => ({ content: c.content, distance: c.distance })),
    })}\n\n`,
  )

  step('chat', 6, 7, 'Streaming the answer from the LLM...')
  const genStart = Date.now()
  let fullAnswer = ''

  try {
    for await (const piece of streamAnswer(prompt)) {
      fullAnswer += piece
      res.write(`data: ${JSON.stringify({ text: piece })}\n\n`)
    }
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Streaming failed' })}\n\n`)
    res.end()
    console.error(`[GET /chat-stream] streamAnswer failed: ${summarizeError(err)}`)
    return
  }

  timing(Date.now() - genStart, `${fullAnswer.length} characters total`)
  preview('answer', fullAnswer, 150)

  step('chat', 7, 7, 'Saving assistant reply to history')
  // The user already has the full answer by now, so a failed save must not
  // turn into an error event — log it and still finish the stream.
  try {
    await insertMessage(sessionId, documentId, 'assistant', fullAnswer)
  } catch (err) {
    console.error(`[GET /chat-stream] could not save assistant reply: ${summarizeError(err)}`)
  }

  res.write(`event: done\ndata: {}\n\n`)
  res.end()

  pipelineEnd('chat', Date.now() - t0)
}, { sse: true }))

app.post('/upload', upload.single('file'), async (req, res) => {
  const t0 = Date.now()
  pipelineStart('upload', 'POST /upload')

  if (!req.file) {
    rejected('no file in request (expected form field "file")')
    return res.status(400).json({
      error: 'No file uploaded (expected form field "file")',
    })
  }

  if (req.file.mimetype !== 'application/pdf') {
    rejected(`wrong mimetype (${req.file.mimetype})`)
    return res.status(400).json({ error: 'Only PDF files are supported' })
  }

  step('upload', 1, 5, `File received: "${req.file.originalname}" (${req.file.size} bytes)`)

  // passing the buffer directly to PDFParse, which will handle it in memory
  const parser = new PDFParse({ data: req.file.buffer })

  try {
    step('upload', 2, 5, 'Extracting text from PDF...')
    const extractStart = Date.now()
    const result = await parser.getText()
    timing(Date.now() - extractStart, `extracted ${result.text.length} characters`)

    const textChunks = chunkText(result.text)
    const documentId = randomUUID()

    step('upload', 3, 5, `Split into ${textChunks.length} chunk(s) — documentId: ${documentId}`)

    step('upload', 4, 5, 'Embedding + storing each chunk...')
    for (let i = 0; i < textChunks.length; i++) {
      const chunk = textChunks[i]
      const chunkStart = Date.now()
      const embedding = await getEmbedding(chunk)
      await insertChunk(chunk, embedding, documentId)
      detail(
        `chunk ${i + 1}/${textChunks.length}: ${chunk.length} chars → ${embedding.length}-dim vector, stored in ${Date.now() - chunkStart}ms`,
      )
      preview('preview', chunk)
    }

    const document = await insertDocument(
      documentId,
      req.file.originalname,
      req.file.size,
      result.text.length,
      textChunks.length,
    )

    step('upload', 5, 5, 'Document metadata saved')
    pipelineEnd('upload', Date.now() - t0)

    res.json({
      documentId,
      filename: req.file.originalname,
      fileSizeBytes: req.file.size,
      textLength: result.text.length,
      chunkCount: textChunks.length,
      createdAt: document.createdAt,
    })
  } finally {
    await parser.destroy()
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`)
})
