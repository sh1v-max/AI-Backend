import { Router } from 'express'
import { randomUUID } from 'crypto'
import { generateAnswer, streamAnswer } from '../services/llm.service'
import { prepareChat } from '../services/chat.service'
import { insertMessage } from '../repositories/chatMessages.repository'
import { withErrorHandling, summarizeError } from '../utils/errors'
import { pipelineStart, pipelineEnd, step, timing, preview } from '../utils/pipelineLogger'

export const chatRouter = Router()

chatRouter.post('/chat', withErrorHandling('POST /chat', async (req, res) => {
  const t0 = Date.now()
  const { documentId, message } = req.body
  const sessionId: string = req.body.sessionId || randomUUID()

  pipelineStart('chat', 'POST /chat')

  const prep = await prepareChat({ documentId, message, sessionId }, t0)
  if (!prep.ok) return res.status(prep.status).json({ error: prep.error })

  step('chat', 6, 7, 'Calling the LLM to generate an answer...')
  const genStart = Date.now()
  const answer = await generateAnswer(prep.prompt)
  timing(Date.now() - genStart)
  preview('answer', answer, 150)

  step('chat', 7, 7, 'Saving assistant reply to history')
  await insertMessage(sessionId, prep.documentId, 'assistant', answer)

  pipelineEnd('chat', Date.now() - t0)

  res.json({
    sessionId,
    answer,
    sources: prep.sources,
  })
}))

// Step 3.2 — same pipeline as /chat, but the reply arrives piece by piece.
// GET + query params, not POST + JSON body — EventSource (what the browser
// uses to consume SSE) can only send GET requests.
chatRouter.get('/chat-stream', withErrorHandling('GET /chat-stream', async (req, res) => {
  const t0 = Date.now()
  const documentId = req.query.documentId
  const message = req.query.message
  const sessionId = (req.query.sessionId as string) || randomUUID()

  pipelineStart('chat', 'GET /chat-stream')

  const prep = await prepareChat({ documentId, message, sessionId }, t0)
  if (!prep.ok) return res.status(prep.status).json({ error: prep.error })

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
      sources: prep.sources,
    })}\n\n`,
  )

  step('chat', 6, 7, 'Streaming the answer from the LLM...')
  const genStart = Date.now()
  let fullAnswer = ''

  try {
    for await (const piece of streamAnswer(prep.prompt)) {
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
    await insertMessage(sessionId, prep.documentId, 'assistant', fullAnswer)
  } catch (err) {
    console.error(`[GET /chat-stream] could not save assistant reply: ${summarizeError(err)}`)
  }

  res.write(`event: done\ndata: {}\n\n`)
  res.end()

  pipelineEnd('chat', Date.now() - t0)
}, { sse: true }))
