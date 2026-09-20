import { getEmbedding } from './embeddings.service'
import { searchSimilar } from '../repositories/chunks.repository'
import { insertMessage, getRecentMessages } from '../repositories/chatMessages.repository'
import { HISTORY_LIMIT } from '../config'
import { pipelineEnd, step, detail, timing, preview, rejected, notFound } from '../utils/pipelineLogger'

// Step 2.3 — POST /chat: embed the question, search stored chunks for this
// document, hand the relevant ones to the LLM, return a grounded answer.
// Step 2.4 — give /chat memory: a sessionId groups messages into one
// conversation, recent history gets replayed into every prompt so follow-up
// questions ("what about the second one?") actually resolve correctly.

// Shared by /chat and /chat-stream — same grounding + history instructions
// either way, only how the answer gets delivered differs between them.
export function buildChatPrompt(
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

export type ChatPreparation =
  | { ok: false; status: number; error: string }
  | {
      ok: true
      documentId: string
      sessionId: string
      sources: { content: string; distance: number }[]
      prompt: string
    }

// Steps 1-5 of the chat pipeline (validate → embed → search → load history →
// save user message → build prompt), identical for /chat and /chat-stream.
// Only step 6-7 (generate + save the reply) differ between the two routes,
// so those stay in the routes. Returns `ok: false` for the 400/404 cases so
// the route can send the response — this function never touches `res`.
//
// `documentId` and `message` come in as `unknown` because they're raw request
// input (body for POST, query string for GET) — validating them is step 1.
export async function prepareChat(
  input: { documentId: unknown; message: unknown; sessionId: string },
  t0: number,
): Promise<ChatPreparation> {
  const { documentId, message, sessionId } = input

  if (!documentId || typeof documentId !== 'string') {
    rejected('missing/invalid documentId')
    return { ok: false, status: 400, error: 'documentId (string) is required' }
  }

  if (!message || typeof message !== 'string') {
    rejected('missing/invalid message')
    return { ok: false, status: 400, error: 'message (string) is required' }
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
    return { ok: false, status: 404, error: 'No document found with that documentId' }
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

  return {
    ok: true,
    documentId,
    sessionId,
    sources: relevantChunks.map((c) => ({ content: c.content, distance: c.distance })),
    prompt,
  }
}
