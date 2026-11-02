import { getEmbedding } from './embeddings.service'
import { searchSimilar } from '../repositories/chunks.repository'
import {
  insertMessage,
  getRecentMessages,
} from '../repositories/chatMessages.repository'
import { HISTORY_LIMIT, ALL_DOCUMENTS } from '../config'
import { checkDocumentReady } from './documents.service'
import { routeMessage } from './router.service'
import type { Intent } from '../schemas/intent.schema'
import type { AgentInput } from './agent.service'
import { listDocuments } from '../repositories/documents.repository'
import { buildQuizOffer, type ChatAction } from './quizOffer.service'
import {
  pipelineEnd,
  step,
  detail,
  timing,
  preview,
  rejected,
  notFound,
  agentDetail,
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

// AG.2 — the prompt for messages the router labelled smalltalk ("hi",
// "thanks!", "what can you do?"). No document context at all: nothing was
// searched. What DocMind can do is spelled out so "what can you do?" gets a
// true answer instead of an invented feature list. The history goes in so a
// "thanks!" after an answer gets a natural reply.
export function buildSmalltalkPrompt(
  history: { role: string; content: string }[],
  message: string,
): string {
  const historyBlock =
    history.length > 0
      ? `\n\nConversation so far:\n${history.map((m) => `${m.role}: ${m.content}`).join('\n')}`
      : ''

  return `You are DocMind, a friendly assistant inside an app where people upload PDF documents and chat with them.

  The user's new message is small talk: a greeting, thanks, a goodbye, or a question about you. Reply briefly and naturally, in one or two sentences. Don't invent anything about their documents.

  If the message is actually a general-knowledge or factual question (geography, history, science, trivia…), don't answer it: say briefly that you only answer from the user's documents, and invite them to ask about one.

  What DocMind can do, if it's relevant to mention: answer questions about the user's uploaded PDFs (one document or all of them at once) and show the passages it used, and make a 5-question multiple-choice quiz from a document.

  If the user is saying yes to a quiz offer in the conversation, you can't start the quiz yourself: tell them to click the "Create quiz" button under that offer, or to ask "quiz me" again.${historyBlock}

  New message: ${message}`
}

// AG.2 — what the router decided, sent to the client too (`route` in /chat's
// JSON and in /chat-stream's meta event) so it's visible in devtools. The
// scores stay in the server log; the client doesn't need 3072-dim reasons.
export type ChatRoute = {
  intent: Intent
  by: 'vector' | 'llm' | 'fallback'
  margin: number | null
}

// chatPreparation is the return type of prepareChat, which is the function that handles the first 5 steps of the chat pipeline (validate → embed → search → load history → save user message → build prompt). it can either be a success (ok: true) with the documentId, sessionId, sources, and prompt, or a failure (ok: false) with a status code and error message. this type is used to ensure that the caller of prepareChat knows what to expect and can handle both success and failure cases appropriately.
type ChatFailure = { ok: false; status: number; error: string }

// AG.3 — a document question on the agent path: no prompt yet (the agent
// builds turns + a system instruction itself), just what the loop needs.
export type AgentPreparation = {
  ok: true
  kind: 'agent'
  documentId: string
  sessionId: string
  route: ChatRoute
  agentInput: AgentInput
}

// AG.5 — a quiz request: the reply is already written (a template, no LLM),
// the route only has to send it, plus the button's action if there is one
export type QuizOfferPreparation = {
  ok: true
  kind: 'offer'
  documentId: string
  sessionId: string
  route: ChatRoute
  text: string
  action: ChatAction | null
}

export type ChatPreparation =
  | ChatFailure
  | QuizOfferPreparation
  | {
      ok: true
      // AG.3 — 'prompt' = the classic path: a finished prompt string to
      // generate from. Since AG.4 both routes use mode 'agent', so in the app
      // this is only ever smalltalk; a document question comes back as a
      // prompt only when mode is 'prompt' (the old fixed top-3 pipeline,
      // still here as the baseline the agent was measured against)
      kind: 'prompt'
      documentId: string
      sessionId: string
      sources: {
        content: string
        distance: number
        documentId: string
        filename: string | null
      }[]
      prompt: string
      route: ChatRoute
    }

// Steps 1-6 of the chat pipeline (validate → embed → load history → ROUTE →
// search → save user message → build prompt), identical for /chat and
// /chat-stream. AG.2 added the routing step: smalltalk skips the search and
// gets its own small prompt. Only steps 7-8 (generate + save the reply)
// differ between the two routes,
// so those stay in the routes. Returns `ok: false` for the 400/404 cases so
// the route can send the response — this function never touches `res`.
//
// `documentId` and `message` come in as `unknown` because they're raw request
// input (the JSON body of both routes) — validating them is step 1.
//
// Step 3.3 — scope: a real documentId searches just that PDF; a missing/empty
// documentId or the sentinel 'all' (ALL_DOCUMENTS) searches every document.
// The scope string is also what gets saved on the chat messages, so a session
// remembers which mode it was started in.
//
// Auth.3 — `userId` comes from the verified token (the route passes
// req.user.id). It's a plain string, not `unknown` like the other inputs,
// because it isn't client input: requireAuth already proved it. It scopes the
// search, the history and the saved message to this one user.
//
// AG.3 — `mode`: 'prompt' (default) is the path above for every message.
// 'agent' keeps steps 1-4 and smalltalk the same, but a document question
// skips the fixed search and comes back as kind: 'agent' for the agent loop.
// Both routes pass 'agent' (POST /chat since AG.3, /chat-stream since AG.4);
// 'prompt' is kept as the old fixed-search pipeline to compare against.
// These two signatures are TypeScript OVERLOADS: a caller that doesn't pass
// mode: 'agent' gets a type that can never be 'agent', so it never has to
// handle the agent's input. (AG.5 — either mode can come back as kind
// 'offer': the quiz offer is decided by the router, not by the mode.)
type ChatInput = { documentId: unknown; message: unknown; sessionId: string; userId: string }
export async function prepareChat(input: ChatInput & { mode?: 'prompt' }, t0: number): Promise<ChatPreparation>
export async function prepareChat(
  input: ChatInput & { mode: 'agent' },
  t0: number,
): Promise<ChatPreparation | AgentPreparation>
export async function prepareChat(
  input: ChatInput & { mode?: 'prompt' | 'agent' },
  t0: number,
): Promise<ChatPreparation | AgentPreparation> {
  const { message, sessionId, userId } = input
  const agentMode = input.mode === 'agent'

  // validating documentId
  // Absent/empty = "all documents". Anything present that isn't a string
  // (a number, an array, an object in the JSON body) is a client bug.
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

  step('chat', 1, 8, 'Request received')
  detail(`user:       ${userId.slice(0, 8)}`)
  detail(`sessionId:  ${sessionId}`)
  detail(
    `documentId: ${documentId}${searchAll ? ' (searching every document)' : ''}`,
  )
  detail(`message:    "${message}"`)

  // BG.3 — one document: is it the caller's AND ready? 404 / 409 here, before
  // the question is embedded (no Gemini call for a request that can't
  // succeed). "All documents" needs no check: searchSimilar only searches
  // ready documents, so a processing one is just left out.
  // AG.3 — the agent's system instruction names the document
  let filename: string | null = null
  if (!searchAll) {
    const readiness = await checkDocumentReady(documentId, userId)
    if (!readiness.ok) {
      pipelineEnd('chat', Date.now() - t0)
      return readiness
    }
    filename = readiness.filename
  }

  step('chat', 2, 8, 'Embedding the question...')
  const embedStart = Date.now()

  // getEmbedding returns an array of numbers representing the vector embedding of the input message. this embedding is used to search for similar chunks in the database based on cosine similarity. the timing function logs how long it took to generate the embedding and how many dimensions the resulting vector has.
  const questionEmbedding = await getEmbedding(message)
  timing(
    Date.now() - embedStart,
    `vector has ${questionEmbedding.length} dimensions`,
  )

  // AG.2 — history is loaded BEFORE routing now (it used to come after the
  // search): the router's LLM classifier needs the last question + answer to
  // read a follow-up like "why?". Still read before this turn's user message
  // is saved, so it never includes the message being answered.
  step('chat', 3, 8, `Loading conversation history (last ${HISTORY_LIMIT} messages)...`)
  const history = await getRecentMessages(sessionId, userId, HISTORY_LIMIT)
  detail(`${history.length} prior message(s) in this session`)

  // AG.2 — decide what KIND of message this is before doing anything
  // expensive. The router reuses the embedding from step 2, so the vector
  // half costs nothing; only a close call (or a vector "quiz") costs one
  // Flash-Lite call. It never throws: anything broken → document_question,
  // today's path, with the reason in decision.errors.
  step('chat', 4, 8, 'Routing the message (vector first, LLM on close calls)...')
  const routeStart = Date.now()
  const decision = await routeMessage(message, questionEmbedding, history)
  const [first, second] = decision.scores
  agentDetail(
    `intent: ${decision.intent} · decided by ${decision.by}` +
      (decision.margin !== null ? ` · margin ${decision.margin.toFixed(3)}` : '') +
      (first ? ` · best "${first.bestExample}" ${first.score.toFixed(3)}` : '') +
      (second ? ` · 2nd ${second.intent} ${second.score.toFixed(3)}` : ''),
  )
  timing(Date.now() - routeStart, decision.by === 'vector' ? '0 API calls' : '1 classifier call')
  // a routing problem must never break the chat, but it mustn't be silent
  decision.errors.forEach((e) => console.error(`[router] ${e}`))
  const route: ChatRoute = { intent: decision.intent, by: decision.by, margin: decision.margin }

  // Smalltalk: no search, no chunks, no 404 for a user with no documents
  // ("hi" from a brand-new guest used to hit "No documents are ready yet").
  if (decision.intent === 'smalltalk') {
    step('chat', 5, 8, 'Skipping the search (smalltalk needs no documents)')
    await insertMessage(sessionId, userId, documentId, 'user', message)
    const prompt = buildSmalltalkPrompt(history, message)
    step('chat', 6, 8, `Built smalltalk prompt — ${prompt.length} characters`)
    return { ok: true, kind: 'prompt', documentId, sessionId, sources: [], prompt, route }
  }

  // AG.5 — a quiz request gets an OFFER, written by code: no search, no LLM
  // call, no quiz yet. The quiz itself only happens when the user clicks the
  // "Create quiz" button (the action), through POST /quiz. Before the agent's
  // "nothing ready" 404 below on purpose: "quiz me" with no ready documents
  // gets a sentence explaining why, not an error.
  if (decision.intent === 'quiz_request') {
    step('chat', 5, 8, 'Skipping the search: a quiz request gets an offer, written by code (0 model calls)')
    const offer = await buildQuizOffer(
      userId,
      searchAll ? undefined : { documentId, filename: filename ?? 'this document' },
    )
    await insertMessage(sessionId, userId, documentId, 'user', message)
    step('chat', 6, 8, `Quiz offer ready — ${offer.action ? `button: ${offer.action.type}` : 'no button'}`)
    return { ok: true, kind: 'offer', documentId, sessionId, route, text: offer.text, action: offer.action }
  }

  // AG.3 — the agent path: no fixed search here. The agent decides what to
  // search (and how often), so steps 5-6 only save the message and hand over.
  if (agentMode) {
    // "All documents" with nothing ready: today's 404, before any Gemini call
    // (the agent would only spend calls finding nothing). One document was
    // already checked above by checkDocumentReady.
    if (searchAll) {
      const docs = await listDocuments(userId)
      if (!docs.some((d) => d.status === 'ready')) {
        notFound('No ready documents for this user')
        pipelineEnd('chat', Date.now() - t0)
        return {
          ok: false,
          status: 404,
          error: 'No documents are ready yet. Upload a PDF, or wait for one to finish processing.',
        }
      }
    }
    step('chat', 5, 8, 'Skipping the fixed top-3 search: the agent decides what to search')
    await insertMessage(sessionId, userId, documentId, 'user', message)
    step('chat', 6, 8, `Handing over to the agent (${history.length} history message(s) become real turns)`)
    return {
      ok: true,
      kind: 'agent',
      documentId,
      sessionId,
      route,
      agentInput: {
        message,
        history,
        userId,
        documentId: searchAll ? undefined : documentId,
        filename,
        messageEmbedding: questionEmbedding,
      },
    }
  }

  step(
    'chat',
    5,
    8,
    searchAll
      ? "Searching stored chunks (across ALL of this user's documents, top 3 by cosine distance)..."
      : 'Searching stored chunks (scoped to this documentId, top 3 by cosine distance)...',
  )
  const searchStart = Date.now()

  // searchSimilar returns an array of relevant chunks — only ever from this
  // user's documents (Auth.3), so another user's documentId finds nothing and
  // falls into the 404 just below.
  const relevantChunks = await searchSimilar(
    questionEmbedding,
    3,
    userId,
    searchAll ? undefined : documentId,
  )
  timing(Date.now() - searchStart, `found ${relevantChunks.length} chunk(s)`)

  if (relevantChunks.length === 0) {
    notFound(
      searchAll
        ? 'No chunks found — no ready documents yet'
        : 'No chunks found for this documentId — does it exist?',
    )
    pipelineEnd('chat', Date.now() - t0)
    return {
      ok: false,
      status: 404,
      error: searchAll
        ? 'No documents are ready yet. Upload a PDF, or wait for one to finish processing.'
        : 'No document found with that documentId',
    }
  }

  // preview the top 3 chunks
  relevantChunks.forEach((c, i) => {
    const from = searchAll ? ` [${c.filename ?? c.documentId}]` : ''
    preview(`#${i + 1} distance=${c.distance.toFixed(4)}${from}`, c.content)
  })

  // Saved *before* generating, so history for the *next* turn already
  // includes this one — but built into *this* turn's prompt from the
  // `history` pulled a moment ago, not including the message being answered.
  await insertMessage(sessionId, userId, documentId, 'user', message)

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
  step('chat', 6, 8, `Built prompt — ${prompt.length} characters`)

  return {
    ok: true,
    kind: 'prompt',
    documentId,
    sessionId,
    sources: relevantChunks.map((c) => ({
      content: c.content,
      distance: c.distance,
      documentId: c.documentId,
      filename: c.filename,
    })),
    prompt,
    route,
  }
}
