import { Router } from 'express'
import { randomUUID } from 'crypto'
import { generateAnswer, streamAnswer } from '../services/llm.service'
import { prepareChat } from '../services/chat.service'
import { runAgent, streamAgent, type AgentResult, type AgentToolCall } from '../services/agent.service'
import { AGENT_MAX_STEPS } from '../config'
import type { SimilarChunk } from '../repositories/chunks.repository'
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
// chatRouter.post('/chat-stream'): handles a POST request to /chat-stream for streaming responses

export const chatRouter = Router()

// The agent's summary line in the log, the same for both routes
function agentSummary(r: AgentResult): string {
  return (
    `${r.steps} model call(s), ${r.toolCalls.length} tool call(s), ` +
    `${r.embedCalls} extra embedding call(s), ${r.totalTokens} tokens${r.gaveUp ? ', GAVE UP' : ''}`
  )
}

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
    // AG.3 — mode 'agent': document questions come back as kind 'agent' and
    // are answered by the tool loop; smalltalk still comes back as a prompt.
    const prep = await prepareChat({ documentId, message, sessionId, userId, mode: 'agent' }, t0)
    if (!prep.ok) return res.status(prep.status).json({ error: prep.error })

    let answer: string
    // same shape either way: { content, distance, documentId, filename }[]
    let sources: SimilarChunk[]
    let agent: { steps: number; toolCalls: AgentToolCall[] } | undefined
    const genStart = Date.now()

    if (prep.kind === 'agent') {
      step('chat', 7, 8, `Running the agent (up to ${AGENT_MAX_STEPS} model calls, tools: searchDocuments, listDocuments)...`)
      const result = await runAgent(prep.agentInput)
      answer = result.answer
      sources = result.sources
      agent = { steps: result.steps, toolCalls: result.toolCalls }
      timing(Date.now() - genStart, agentSummary(result))
    } else {
      step('chat', 7, 8, 'Calling the LLM to generate an answer...')
      // getting the answer from the LLM using the generated prompt. the generateAnswer function sends the prompt to the LLM and returns the generated answer as a string.
      answer = await generateAnswer(prep.prompt)
      sources = prep.sources
      timing(Date.now() - genStart)
    }
    preview('answer', answer, 150)

    step('chat', 8, 8, 'Saving assistant reply to history')

    // the "user" message has already been saved in prepareChat(), so now we save the assistant's reply to the chat history
    await insertMessage(sessionId, userId, prep.documentId, 'assistant', answer)

    pipelineEnd('chat', Date.now() - t0)

    // returning the sessionId, generated answer, and sources used for generating the answer in the response. this allows the client to display the answer and also have access to the sources that were used to generate it
    res.json({
      sessionId,
      answer,
      sources,
      // AG.2 — what the router decided (additive: old clients ignore it)
      route: prep.route,
      // AG.3 — what the agent did, for devtools/tests (additive too; absent
      // for smalltalk, which doesn't run the agent)
      ...(agent && { agent }),
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
// AG.4 — and since then the same AGENT as /chat too, with every step streamed.
//
// This used to be GET + query params, because the browser's EventSource (the
// first client) can only send GET. Since Auth.5 the frontend reads the stream
// with fetch(), which can send any method, so it's now POST + a JSON body,
// same as /chat. Why that's better:
//  - the question no longer sits in the URL, and URLs end up in server/proxy
//    request logs and browser history. A body doesn't.
//  - no URL length limit (proxies reject very long URLs; a body has no such
//    problem with a long pasted question).
//  - GET means "read only, safe to repeat". This route saves two messages
//    every time it runs, which is POST's job.
// Only the REQUEST changed. The response is the same SSE stream as before —
// the method of a request has nothing to do with how its response is sent.
chatRouter.post(
  '/chat-stream',
  withErrorHandling(
    'POST /chat-stream',
    async (req, res) => {
      const t0 = Date.now()
      // from the JSON body now, exactly like POST /chat above
      const { documentId, message } = req.body
      const sessionId: string = req.body.sessionId || randomUUID()
      // Auth.3 — from the verified token, never from the query string
      const userId = req.user!.id

      pipelineStart('chat', 'POST /chat-stream')

      // preparing chat
      // AG.4 — mode 'agent', same as /chat: a document question comes back as
      // kind 'agent' (no fixed search, the agent decides), smalltalk still as
      // a finished prompt. All the 400/404/409 checks run before this returns,
      // so they're still plain JSON errors, before the stream opens.
      const prep = await prepareChat({ documentId, message, sessionId, userId, mode: 'agent' }, t0)
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

      // One SSE frame. `event` null = the default (unnamed) event, which is
      // what text pieces use. The blank line (\n\n) ends the frame.
      const send = (event: string | null, data: unknown) =>
        res.write(`${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`)

      // sending the first sse event with the sessionId and sources used for generating the answer. this allows the client to know the sessionId and sources before the actual answer starts streaming in
      send('meta', {
        sessionId,
        // AG.4 — always [] on the agent path: nothing has been searched yet.
        // The real list follows in `sources` events, once the agent searched.
        // (Kept in meta, empty, so an old frontend still finds the field.)
        sources: prep.kind === 'agent' ? [] : prep.sources,
        // AG.2 — what the router decided. Additive: the frontend's onMeta
        // reads sessionId + sources and ignores the rest
        route: prep.route,
      })

      const genStart = Date.now()
      let fullAnswer = ''
      let agentResult: AgentResult | null = null

      try {
        if (prep.kind === 'agent') {
          // AG.4 — the agent, streamed. streamAgent yields three kinds of
          // events; each becomes one SSE frame:
          //   text    → default `data: { text }` (exactly like before, so the
          //             frontend's answer bubble doesn't know the difference)
          //   status  → `event: status`  { text }     ("Searching for …")
          //   sources → `event: sources` { sources }  (cumulative list)
          // Old frontends have no case for status/sources and ignore them.
          step('chat', 7, 8, `Running the agent, streaming every step (up to ${AGENT_MAX_STEPS} model calls)...`)
          const run = streamAgent(prep.agentInput)
          // .next() by hand: `for await` would throw the generator's RETURN
          // value (the AgentResult) away
          let next = await run.next()
          while (!next.done) {
            const event = next.value
            if (event.type === 'text') send(null, { text: event.text })
            else if (event.type === 'status') send('status', { text: event.text })
            else send('sources', { sources: event.sources })
            next = await run.next()
          }
          agentResult = next.value
          // the agent's answer = every piece it streamed (+ the give-up line
          // if it had to), so it's exactly what the user saw
          fullAnswer = agentResult.answer
        } else {
          step('chat', 7, 8, 'Streaming the answer from the LLM...')
          // quick note: the streamAnswer() function is an async generator that yields pieces of the answer as they are generated by the LLM. this allows the server to send each piece to the client as soon as it is available, instead of waiting for the entire answer to be generated before sending it.
          // for await (const piece of streamAnswer(prep.prompt)) iterates over each piece of the answer generated by the LLM. for each piece, it appends it to fullAnswer and sends it to the client as an SSE event with the data field containing the piece of text. this allows the client to display the answer in real-time as it is being generated
          for await (const piece of streamAnswer(prep.prompt)) {
            fullAnswer += piece
            send(null, { text: piece })
          }
        }
      } catch (err) {
        send('error', { error: 'Streaming failed' })
        res.end()
        console.error(
          `[POST /chat-stream] ${prep.kind === 'agent' ? 'streamAgent' : 'streamAnswer'} failed: ${summarizeError(err)}`,
        )
        return
      }

      timing(
        Date.now() - genStart,
        agentResult
          ? `${agentSummary(agentResult)}, ${fullAnswer.length} characters`
          : `${fullAnswer.length} characters total`,
      )
      preview('answer', fullAnswer, 150)

      step('chat', 8, 8, 'Saving assistant reply to history')
      // The user already has the full answer by now, so a failed save must not
      // turn into an error event — log it and still finish the stream.
      try {
        await insertMessage(sessionId, userId, prep.documentId, 'assistant', fullAnswer)
      } catch (err) {
        console.error(
          `[POST /chat-stream] could not save assistant reply: ${summarizeError(err)}`,
        )
      }

      send('done', {})
      res.end()

      pipelineEnd('chat', Date.now() - t0)
    },
    { sse: true },
  ),
)

// workflow for POST /chat-stream:
// User sends:
// "Explain this document"   (JSON body, same as /chat)
//         ↓
// POST /chat-stream
//         ↓
// withErrorHandling()   (sse: true, so errors go out as `event: error` frames)
//         ↓
// Chat handler
//         ↓
// prepareChat({ mode: 'agent' })
//    ├── validate input (+ 404/409 for one document)
//    ├── embed the question
//    ├── load the last 8 messages (history)
//    ├── ROUTE it (AG.2): smalltalk or a document question?
//    ├── save user's question to history
//    └── smalltalk → a finished prompt · document question → the agent's input
//         ↓   (if !prep.ok → 400/404/409 JSON, stop)
// res.writeHead(200, text/event-stream)   ← stream opens BEFORE the LLM is called
//         ↓
// send(meta { sessionId, sources: [] for the agent, route })
//         ↓
// smalltalk: for await (piece of streamAnswer(prompt)) → data: { text }
// document question (AG.4): streamAgent(), up to 3 streamed model calls
//    ├── the model asks for a tool → event: status { text: "Searching for …" }
//    ├── code runs it              → event: sources { sources }  (after a search)
//    └── the model answers         → data: { text } per piece    ← types out live
//         ↓   (if streaming fails → event: error, res.end(), stop)
// insertMessage(..., "assistant", fullAnswer)
//    (if this save fails → only logged, the stream still finishes normally)
//         ↓
// res.write(event: done)
//         ↓
// res.end()
