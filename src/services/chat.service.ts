import { getEmbedding } from './embeddings.service'
import { searchSimilar } from '../repositories/chunks.repository'
import {
  insertMessage,
  getRecentMessages,
} from '../repositories/chatMessages.repository'
import { HISTORY_LIMIT, ALL_DOCUMENTS } from '../config'
import {
  pipelineEnd,
  step,
  detail,
  timing,
  preview,
  rejected,
  notFound,
} from '../utils/pipelineLogger'

// ignore all the logging in this file, like step, detail, timing, preview, rejected, notFound, pipelineEnd — those are just for the console output to help us see how long each step takes and what the intermediate results are. they don't affect the actual chat logic or the returned data.

// everything this file does:
// buildChatPrompt(): builds the prompt string (instructions + context + history + question).
// ChatPreparation: the return type, either ok: false with an error or ok: true with everything needed to generate.
// prepareChat(): the shared pipeline steps 1–5 (validate → embed → search → load history → save the user message → build the prompt). It calls buildChatPrompt() at the end.

// Step 2.3 — POST /chat: embed the question, search stored chunks for this
// document, hand the relevant ones to the LLM, return a grounded answer.
// Step 2.4 — give /chat memory: a sessionId groups messages into one
// conversation, recent history gets replayed into every prompt so follow-up
// questions ("what about the second one?") actually resolve correctly.

// Shared by /chat and /chat-stream — same grounding + history instructions
// either way, only how the answer gets delivered differs between them.

// what does buildChatPrompt do: it takes the context (relevant chunks), the conversation history, and the new user message, and constructs a prompt string that will be sent to the LLM. it includes instructions for the LLM on how to answer, how to use the context, and how to handle conversation history. it also handles multi-document scenarios by labelling each chunk with its source document (documentId and filename) and instructing the LLM to cite sources when relevant. it returns the constructed prompt string.
export function buildChatPrompt(
  context: string,
  history: { role: string; content: string }[],
  message: string,
  multiDocument = false,
): string {
  // historyBlock is a string that represents the conversation history. if there is any history, it formats each message with its role and content, and joins them with newlines. if there is no history, it is an empty string. this block will be included in the prompt to provide context for the LLM about the previous conversation.
  const historyBlock =
    history.length > 0
      ? `\n\nConversation so far:\n${history.map((m) => `${m.role}: ${m.content}`).join('\n')}`
      : ''

  // Step 3.3 — when the context may come from several PDFs, each chunk is
  // labelled with its filename (see prepareChat) and the model is told to
  // name the document it used. Single-document prompts are unchanged.
  // if multiDocument is true, it means the context may come from several PDFs, so the prompt includes instructions to name the document each piece of context came from. if multiDocument is false, it means the context is from a single document, so the prompt does not include those instruction
  const intro = multiDocument
    ? `You are answering questions about the user's uploaded documents. Use only the context below to answer — don't rely on outside knowledge, and don't guess. Each piece of context is labelled with the document it came from.`
    : `You are answering questions about a specific document. Use only the context below to answer — don't rely on outside knowledge, and don't guess.`

  const citation = multiDocument
    ? `\n\nWhen you use information from a labelled source, name the document it came from (for example "According to rag_guide.pdf, …"), especially when different documents cover different parts of the answer or disagree.`
    : ''

  // the final prompt string is constructed by combining the intro, the context, the citation instructions (if any), the conversation history (if any), and the new user message. this string will be sent to the LLM to generate a response based on the provided information.'
  // rule first, then the material, and the actual question last, so it's the finest thing the model reads before it answers
  return `${intro}

  Answer directly and naturally, like you're explaining it to someone, not like you're quoting a source. Don't start every reply with phrases like "Based on the provided context" — just answer the question. Only mention the document explicitly if it's genuinely relevant to say so (for example, if the answer isn't in it).

  If the context doesn't contain the answer, say so plainly and briefly — don't pad it with an apology or a long explanation.

  If there's conversation history below, use it to understand what the new question is referring to (e.g. "the first one", "what about that").${citation}

  Context:
  ${context}${historyBlock}

  New question: ${message}`
}

// chatPreparation is the return type of prepareChat, which is the function that handles the first 5 steps of the chat pipeline (validate → embed → search → load history → save user message → build prompt). it can either be a success (ok: true) with the documentId, sessionId, sources, and prompt, or a failure (ok: false) with a status code and error message. this type is used to ensure that the caller of prepareChat knows what to expect and can handle both success and failure cases appropriately.
export type ChatPreparation =
  | { ok: false; status: number; error: string }
  | {
      ok: true
      documentId: string
      sessionId: string
      sources: {
        content: string
        distance: number
        documentId: string
        filename: string | null
      }[]
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

  // validating documentId
  // Absent/empty = "all documents". Anything present that isn't a string
  // (e.g. ?documentId=a&documentId=b arrives as an array) is a client bug.
  if (
    input.documentId != null &&
    input.documentId !== '' &&
    typeof input.documentId !== 'string'
  ) {
    rejected('invalid documentId (must be a string)')
    return { ok: false, status: 400, error: 'documentId must be a string' }
  }

  const documentId = input.documentId || ALL_DOCUMENTS
  // searchAll is a boolean that indicates whether the chat should search across all documents or just a specific document. if documentId is equal to ALL_DOCUMENTS, then searchAll is true, meaning the chat will search across all documents. otherwise, it will search within the specified documentId.
  const searchAll = documentId === ALL_DOCUMENTS

  if (!message || typeof message !== 'string') {
    rejected('missing/invalid message')
    return { ok: false, status: 400, error: 'message (string) is required' }
  }

  step('chat', 1, 7, 'Request received')
  detail(`sessionId:  ${sessionId}`)
  detail(
    `documentId: ${documentId}${searchAll ? ' (searching every document)' : ''}`,
  )
  detail(`message:    "${message}"`)

  step('chat', 2, 7, 'Embedding the question...')
  const embedStart = Date.now()

  // getEmbedding returns an array of numbers representing the vector embedding of the input message. this embedding is used to search for similar chunks in the database based on cosine similarity. the timing function logs how long it took to generate the embedding and how many dimensions the resulting vector has.
  const questionEmbedding = await getEmbedding(message)
  timing(
    Date.now() - embedStart,
    `vector has ${questionEmbedding.length} dimensions`,
  )

  step(
    'chat',
    3,
    7,
    searchAll
      ? 'Searching stored chunks (across ALL documents, top 3 by cosine distance)...'
      : 'Searching stored chunks (scoped to this documentId, top 3 by cosine distance)...',
  )
  const searchStart = Date.now()

  // searchSimilar returns an array of relevant chunks
  const relevantChunks = await searchSimilar(
    questionEmbedding,
    3,
    searchAll ? undefined : documentId,
  )
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
      error: searchAll
        ? 'No documents have been uploaded yet'
        : 'No document found with that documentId',
    }
  }

  // preview the top 3 chunks
  relevantChunks.forEach((c, i) => {
    const from = searchAll ? ` [${c.filename ?? c.documentId}]` : ''
    preview(`#${i + 1} distance=${c.distance.toFixed(4)}${from}`, c.content)
  })

  step(
    'chat',
    4,
    7,
    `Loading conversation history (last ${HISTORY_LIMIT} messages)...`,
  )

  // Get the most recent messages from this session
  const history = await getRecentMessages(sessionId, HISTORY_LIMIT)
  detail(`${history.length} prior message(s) in this session`)

  // Saved *before* generating, so history for the *next* turn already
  // includes this one — but built into *this* turn's prompt from the
  // `history` pulled a moment ago, not including the message being answered.
  await insertMessage(sessionId, documentId, 'user', message)

  // In all-documents mode each chunk is labelled with its file, so the model
  // (and the citation instruction in the prompt) can tell the sources apart.
  const context = relevantChunks
    .map((c) =>
      searchAll
        ? `[Source: ${c.filename ?? 'unknown document'}]\n${c.content}`
        : c.content,
    )
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
