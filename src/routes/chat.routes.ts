import { Router } from 'express'
import { randomUUID } from 'crypto'
import { generateAnswer, streamAnswer } from '../services/llm.service'
import { prepareChat } from '../services/chat.service'
import { insertMessage } from '../repositories/chatMessages.repository'
import { withErrorHandling, summarizeError } from '../utils/errors'
import { pipelineStart, pipelineEnd, step, timing, preview } from '../utils/pipelineLogger'

// ignore all the logging in this file, like step, detail, timing, preview, rejected, notFound, pipelineEnd — those are just for the console output to help us see how long each step takes and what the intermediate results are. they don't affect the actual chat logic or the returned data.

// what this file does:
// chatRouter.post('/chat'): handles a POST request to /chat
// chatRouter.get('/chat-stream'): handles a GET request to /chat-stream for streaming responses


export const chatRouter = Router()

//* here, 'POST /chat' is the label used in the withErrorHandling function to identify this specific route in the logs. it helps to trace errors back to this route if any issues occur during the request handling.
//* it's not the actual route path, just a label

// chat route for handling chat requests. it uses the withErrorHandling function to wrap the request handler, which provides error handling and logging for the route. if an error occurs during the request handling, it will be logged and a proper error response will be sent back to the client.
chatRouter.post('/chat', withErrorHandling('POST /chat', async (req, res) => {
  const t0 = Date.now()
  const { documentId, message } = req.body
  const sessionId: string = req.body.sessionId || randomUUID()

  pipelineStart('chat', 'POST /chat')

  // preparing the chat involves validating the input, embedding the message, searching for relevant chunks, loading conversation history, saving the user message, and building the prompt for the LLM. the prepareChat function handles all these steps and returns a ChatPreparation object that indicates whether the preparation was successful or if there was an error.
  const prep = await prepareChat({ documentId, message, sessionId }, t0)
  if (!prep.ok) return res.status(prep.status).json({ error: prep.error })

  step('chat', 6, 7, 'Calling the LLM to generate an answer...')
  const genStart = Date.now()

  // getting the answer from the LLM using the generated prompt. the generateAnswer function sends the prompt to the LLM and returns the generated answer as a string.
  const answer = await generateAnswer(prep.prompt)
  timing(Date.now() - genStart)
  preview('answer', answer, 150)

  step('chat', 7, 7, 'Saving assistant reply to history')

  // the "user" message has already been saved in prepareChat(), so now we save the assistant's reply to the chat history
  await insertMessage(sessionId, prep.documentId, 'assistant', answer)

  pipelineEnd('chat', Date.now() - t0)

  // returning the sessionId, generated answer, and sources used for generating the answer in the response. this allows the client to display the answer and also have access to the sources that were used to generate it
  res.json({
    sessionId,
    answer,
    sources: prep.sources,
  })
}))
// workflow for POST /chat:
// User sends:
// "Explain this document"
//         ↓
// POST /chat
//         ↓
// withErrorHandling()
//         ↓
// Chat handler
//         ↓
// prepareChat()
//    ├── validate input
//    ├── get/retrieve relevant document context
//    ├── save user's question to history
//    └── build the prompt
//         ↓
// generateAnswer(prep.prompt)
//         ↓
// LLM generates answer
//         ↓
// insertMessage(..., "assistant", answer)
//         ↓
// save assistant answer to history
//         ↓
// res.json(...)

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
    // Phase 10 — once deployed, a reverse proxy sits between the browser and
    // this server. Some proxies (nginx-style) buffer responses and would
    // deliver the whole "stream" in one lump at the end; this header asks
    // them not to. Harmless when there's no proxy (local dev).
    'X-Accel-Buffering': 'no',
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

// workflow for GET /chat-stream:
// User sends:
// "Explain this document"   (as query params, not a body)
//         ↓
// GET /chat-stream
//         ↓
// withErrorHandling()   (sse: true, so errors go out as `event: error` frames)
//         ↓
// Chat handler
//         ↓
// prepareChat()
//    ├── validate input
//    ├── embed the question
//    ├── search the top 3 relevant chunks
//    ├── load the last 8 messages (history)
//    ├── save user's question to history
//    └── build the prompt
//         ↓   (if !prep.ok → 400/404 JSON, stop)
// res.writeHead(200, text/event-stream)   ← stream opens BEFORE the LLM is called
//         ↓
// res.write(event: meta { sessionId, sources })
//         ↓
// for await (piece of streamAnswer(prompt))   ← generating and sending happen together
//    ├── fullAnswer += piece
//    └── res.write(data: { text: piece })     ← browser shows text as it arrives
//         ↓   (if streaming fails → event: error, res.end(), stop)
// insertMessage(..., "assistant", fullAnswer)
//    (if this save fails → only logged, the stream still finishes normally)
//         ↓
// res.write(event: done)
//         ↓
// res.end()
