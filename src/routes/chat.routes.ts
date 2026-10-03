import { Router } from 'express'
import { randomUUID } from 'crypto'
import { generateAnswer, streamAnswer } from '../services/llm.service'
import { prepareChat } from '../services/chat.service'
import { insertMessage } from '../repositories/chatMessages.repository'
import { withErrorHandling, summarizeError } from '../utils/errors'
import {
  pipelineStart,
  pipelineEnd,
  step,
  timing,
  preview,
} from '../utils/pipelineLogger'

// ignore all the logging in this file, like step, detail, timing, preview, rejected, notFound, pipelineEnd — those are just for the console output to help us see how long each step takes and what the intermediate results are. they don't affect the actual chat logic or the returned data.

// what this file does:
// chatRouter.post('/chat'): handles a POST request to /chat
// chatRouter.get('/chat-stream'): handles a GET request to /chat-stream for streaming responses

export const chatRouter = Router()

//* here, 'POST /chat' is the label used in the withErrorHandling function to identify this specific route in the logs. it helps to trace errors back to this route if any issues occur during the request handling.
//* it's not the actual route path, just a label

// chat route for handling chat requests. it uses the withErrorHandling function to wrap the request handler, which provides error handling and logging for the route. if an error occurs during the request handling, it will be logged and a proper error response will be sent back to the client.
chatRouter.post(
  '/chat',
  withErrorHandling('POST /chat', async (req, res) => {
    const t0 = Date.now()
    const { documentId, message } = req.body
    const sessionId: string = req.body.sessionId || randomUUID()
    // Auth.3 — who's asking, from the verified token (requireAuth set it)
    const userId = req.user!.id

    pipelineStart('chat', 'POST /chat')

    // preparing the chat involves validating the input, embedding the message, searching for relevant chunks, loading conversation history, saving the user message, and building the prompt for the LLM. the prepareChat function handles all these steps and returns a ChatPreparation object that indicates whether the preparation was successful or if there was an error.
    const prep = await prepareChat({ documentId, message, sessionId, userId }, t0)
    if (!prep.ok) return res.status(prep.status).json({ error: prep.error })

    step('chat', 6, 7, 'Calling the LLM to generate an answer...')
    const genStart = Date.now()

    // getting the answer from the LLM using the generated prompt. the generateAnswer function sends the prompt to the LLM and returns the generated answer as a string.
    const answer = await generateAnswer(prep.prompt)
    timing(Date.now() - genStart)
    preview('answer', answer, 150)

    step('chat', 7, 7, 'Saving assistant reply to history')

    // the "user" message has already been saved in prepareChat(), so now we save the assistant's reply to the chat history
    await insertMessage(sessionId, userId, prep.documentId, 'assistant', answer)

    pipelineEnd('chat', Date.now() - t0)

    // returning the sessionId, generated answer, and sources used for generating the answer in the response. this allows the client to display the answer and also have access to the sources that were used to generate it
    res.json({
      sessionId,
      answer,
      sources: prep.sources,
    })
  }),
)
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
chatRouter.get(
  '/chat-stream',
  withErrorHandling(
    'GET /chat-stream',
    async (req, res) => {
      const t0 = Date.now()
      // query because eventsource can only send GET requests, not POST with a JSON body. so the documentId, message, and sessionId are sent as query parameters in the URL instead of in the request body.
      const documentId = req.query.documentId
      const message = req.query.message
      const sessionId = (req.query.sessionId as string) || randomUUID()
      // Auth.3 — from the verified token, never from the query string
      const userId = req.user!.id

      pipelineStart('chat', 'GET /chat-stream')

      // preparing chat
      const prep = await prepareChat({ documentId, message, sessionId, userId }, t0)
      if (!prep.ok) return res.status(prep.status).json({ error: prep.error })

      // writeHead() is called before any data is sent to the client, setting the HTTP status code and headers for the response. in this case, it sets the status code to 200 (OK) and specifies that the content type is "text/event-stream" for server-sent events (SSE). it also includes headers to prevent caching and keep the connection alive, as well as a header to disable buffering by reverse proxies.
      // so it basically starts the stream
      res.writeHead(200, {
        // it tells interpret this response as a sse stream, not a normal json response. the browser will treat this as a stream of events instead of a single response.
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        // once deployed, this header will be needed to prevent nginx from buffering the stream and delaying the events from reaching the client. without this header, nginx would buffer the response and only send it to the client once the entire response is complete, which would defeat the purpose of streaming.
        // ineffective in local build
        'X-Accel-Buffering': 'no',
      })

      // sending the first sse event with the sessionId and sources used for generating the answer. this allows the client to know the sessionId and sources before the actual answer starts streaming in
      res.write(
        `event: meta\ndata: ${JSON.stringify({
          sessionId,
          sources: prep.sources,
          // \n\n says this event is done
        })}\n\n`,
      )

      step('chat', 6, 7, 'Streaming the answer from the LLM...')
      const genStart = Date.now()

      // quick note: the streamAnswer() function is an async generator that yields pieces of the answer as they are generated by the LLM. this allows the server to send each piece to the client as soon as it is available, instead of waiting for the entire answer to be generated before sending it.
      // streaming the answer from the LLM
      let fullAnswer = ''

      try {
        // for await (const piece of streamAnswer(prep.prompt)) iterates over each piece of the answer generated by the LLM. for each piece, it appends it to fullAnswer and sends it to the client as an SSE event with the data field containing the piece of text. this allows the client to display the answer in real-time as it is being generated
        for await (const piece of streamAnswer(prep.prompt)) {
          fullAnswer += piece
          res.write(`data: ${JSON.stringify({ text: piece })}\n\n`)
        }
      } catch (err) {
        res.write(
          `event: error\ndata: ${JSON.stringify({ error: 'Streaming failed' })}\n\n`,
        )
        res.end()
        console.error(
          `[GET /chat-stream] streamAnswer failed: ${summarizeError(err)}`,
        )
        return
      }

      timing(Date.now() - genStart, `${fullAnswer.length} characters total`)
      preview('answer', fullAnswer, 150)

      step('chat', 7, 7, 'Saving assistant reply to history')
      // The user already has the full answer by now, so a failed save must not
      // turn into an error event — log it and still finish the stream.
      try {
        await insertMessage(sessionId, userId, prep.documentId, 'assistant', fullAnswer)
      } catch (err) {
        console.error(
          `[GET /chat-stream] could not save assistant reply: ${summarizeError(err)}`,
        )
      }

      res.write(`event: done\ndata: {}\n\n`)
      res.end()

      pipelineEnd('chat', Date.now() - t0)
    },
    { sse: true },
  ),
)

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
