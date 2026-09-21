import { getEmbedding } from './embeddings.service'
import { searchSimilar } from '../repositories/chunks.repository'
import { insertMessage, getRecentMessages } from '../repositories/chatMessages.repository'
import { HISTORY_LIMIT, ALL_DOCUMENTS } from '../config'
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
  multiDocument = false,
): string {
  const historyBlock =
    history.length > 0
      ? `\n\nConversation so far:\n${history.map((m) => `${m.role}: ${m.content}`).join('\n')}`
      : ''

  // Step 3.3 — when the context may come from several PDFs, each chunk is
  // labelled with its filename (see prepareChat) and the model is told to
  // name the document it used. Single-document prompts are unchanged.
  const intro = multiDocument
    ? `You are answering questions about the user's uploaded documents. Use only the context below to answer — don't rely on outside knowledge, and don't guess. Each piece of context is labelled with the document it came from.`
    : `You are answering questions about a specific document. Use only the context below to answer — don't rely on outside knowledge, and don't guess.`

  const citation = multiDocument
    ? `\n\nWhen you use information from a labelled source, name the document it came from (for example "According to rag_guide.pdf, …"), especially when different documents cover different parts of the answer or disagree.`
    : ''

  return `${intro}

Answer directly and naturally, like you're explaining it to someone, not like you're quoting a source. Don't start every reply with phrases like "Based on the provided context" — just answer the question. Only mention the document explicitly if it's genuinely relevant to say so (for example, if the answer isn't in it).

If the context doesn't contain the answer, say so plainly and briefly — don't pad it with an apology or a long explanation.

If there's conversation history below, use it to understand what the new question is referring to (e.g. "the first one", "what about that").${citation}

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
      sources: { content: string; distance: number; documentId: string; filename: string | null }[]
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
//
// Step 3.3 — scope: a real documentId searches just that PDF; a missing/empty
// documentId or the sentinel 'all' (ALL_DOCUMENTS) searches every document.
// The scope string is also what gets saved on the chat messages, so a session
// remembers which mode it was started in.
export async function prepareChat(
  input: { documentId: unknown; message: unknown; sessionId: string },
  t0: number,
): Promise<ChatPreparation> {
  const { message, sessionId } = input

  // Absent/empty = "all documents". Anything present that isn't a string
  // (e.g. ?documentId=a&documentId=b arrives as an array) is a client bug.
  if (input.documentId != null && input.documentId !== '' && typeof input.documentId !== 'string') {
    rejected('invalid documentId (must be a string)')
    return { ok: false, status: 400, error: 'documentId must be a string' }
  }

  const documentId = input.documentId || ALL_DOCUMENTS
  const searchAll = documentId === ALL_DOCUMENTS

  if (!message || typeof message !== 'string') {
    rejected('missing/invalid message')
    return { ok: false, status: 400, error: 'message (string) is required' }
  }

  step('chat', 1, 7, 'Request received')
  detail(`sessionId:  ${sessionId}`)
  detail(`documentId: ${documentId}${searchAll ? ' (searching every document)' : ''}`)
  detail(`message:    "${message}"`)

  step('chat', 2, 7, 'Embedding the question...')
  const embedStart = Date.now()
  const questionEmbedding = await getEmbedding(message)
  timing(Date.now() - embedStart, `vector has ${questionEmbedding.length} dimensions`)

  step(
    'chat',
    3,
    7,
    searchAll
      ? 'Searching stored chunks (across ALL documents, top 3 by cosine distance)...'
      : 'Searching stored chunks (scoped to this documentId, top 3 by cosine distance)...',
  )
  const searchStart = Date.now()
  const relevantChunks = await searchSimilar(questionEmbedding, 3, searchAll ? undefined : documentId)
  timing(Date.now() - searchStart, `found ${relevantChunks.length} chunk(s)`)

  if (relevantChunks.length === 0) {
    notFound(
      searchAll
        ? 'No chunks found — no documents have been uploaded yet'
        : 'No chunks found for this documentId — does it exist?',
    )
    pipelineEnd('chat', Date.now() - t0)
    return {
      ok: false,
      status: 404,
      error: searchAll ? 'No documents have been uploaded yet' : 'No document found with that documentId',
    }
  }

  relevantChunks.forEach((c, i) => {
    const from = searchAll ? ` [${c.filename ?? c.documentId}]` : ''
    preview(`#${i + 1} distance=${c.distance.toFixed(4)}${from}`, c.content)
  })

  step('chat', 4, 7, `Loading conversation history (last ${HISTORY_LIMIT} messages)...`)
  const history = await getRecentMessages(sessionId, HISTORY_LIMIT)
  detail(`${history.length} prior message(s) in this session`)

  // Saved *before* generating, so history for the *next* turn already
  // includes this one — but built into *this* turn's prompt from the
  // `history` pulled a moment ago, not including the message being answered.
  await insertMessage(sessionId, documentId, 'user', message)

  // In all-documents mode each chunk is labelled with its file, so the model
  // (and the citation instruction in the prompt) can tell the sources apart.
  const context = relevantChunks
    .map((c) => (searchAll ? `[Source: ${c.filename ?? 'unknown document'}]\n${c.content}` : c.content))
    .join('\n\n')
  const prompt = buildChatPrompt(context, history, message, searchAll)
  step('chat', 5, 7, `Built prompt — ${prompt.length} characters`)

  return {
    ok: true,
    documentId,
    sessionId,
    sources: relevantChunks.map((c) => ({
      content: c.content,
      distance: c.distance,
      documentId: c.documentId,
      filename: c.filename,
    })),
    prompt,
  }
}
