import { getEmbeddings } from './embeddings.service'
import { generateAnswer } from './llm.service'
import { INTENTS, IntentReply, intentResponseSchema, type Intent } from '../schemas/intent.schema'
import { ROUTER_MIN_MARGIN, ROUTER_HISTORY_MESSAGES } from '../config'
import { summarizeError } from '../utils/errors'

// AG.1 — the intent router: before a message is answered, decide WHAT KIND of
// message it is (document_question / smalltalk / quiz_request), so code can
// pick the right path. Two ways to decide, and the live path uses both
// (decision D1 = hybrid, agents-plan.md §2.2):
//
//   routeByVector()   roadmap 7.2 — cosine similarity between the message's
//                     embedding and example phrases per intent. The message is
//                     embedded anyway for search, so this costs 0 API calls.
//   classifyIntent()  roadmap 7.1 — ask the LLM, structured output + Zod (the
//                     quiz's technique with a tiny schema). Understands
//                     negation and history, but costs one generate call.
//   routeMessage()    the hybrid: vector first; only when the top two intents
//                     are too close to call, ask the LLM; if anything is
//                     broken or unsure, document_question (today's behaviour).
//
// Nothing here touches req/res or the database, and nothing logs: it returns
// the decision with its scores (and any errors), and the caller logs it (the chat route in
// AG.2, the eval script `npm run step7` now). Not wired into /chat yet.

// ── The vector router ───────────────────────────────────────────────────────

// Example phrases per intent. Several short, DIFFERENT phrasings work much
// better than one abstract description ("greetings and chit-chat"): the
// router scores each intent by its single best-matching phrase, so variety is
// what covers the ways people actually type.
//
// Kept deliberately different from the eval messages in step7-router.ts: if
// the examples were copies of the test, the test would only measure memory.
export const INTENT_EXAMPLES: Record<Intent, string[]> = {
  smalltalk: [
    'hello',
    'hey, how are you?',
    'thank you so much',
    'great, that helps',
    'good night',
    'nice to meet you',
    "what's your name?",
    'what are you able to help with?',
    'haha okay',
    'see you later',
  ],
  document_question: [
    'what is the main idea of this document?',
    'summarize chapter 3',
    'what does the report say about revenue?',
    'explain the conclusion in simple words',
    'list the key points from the introduction',
    'what requirements are mentioned?',
    'how does the author define this term?',
    'which files have I uploaded?',
    'find where it talks about deadlines',
    'tell me more about that section',
  ],
  quiz_request: [
    'give me a quiz',
    'quiz me about the pdf',
    'test my knowledge of this',
    'can you make some practice questions?',
    'I want to take a quiz on chapter 2',
    'ask me multiple choice questions about it',
    'create a test from this file',
    "let's do a quick quiz",
  ],
}

type ExampleVector = { intent: Intent; text: string; vector: number[] }

// The example vectors are embedded ONCE per process, lazily (on the first
// message, not at startup: Render restarts the process on every wake from
// sleep, and a boot shouldn't spend quota before anyone chats), in ONE batch
// call, and kept in memory (~28 vectors; a table would cost a Neon round trip
// for something that fits in a few hundred KB).
//
// The PROMISE is cached, not the result: if two messages arrive at once on a
// cold process, both await the same in-flight call instead of embedding the
// phrases twice (same trick as useAuth's module-level bootstrap promise). On
// failure it's cleared, so the next message tries again.
let exampleVectors: Promise<ExampleVector[]> | null = null

export function getExampleVectors(): Promise<ExampleVector[]> {
  if (!exampleVectors) {
    const entries = INTENTS.flatMap((intent) =>
      INTENT_EXAMPLES[intent].map((text) => ({ intent, text })),
    )
    exampleVectors = getEmbeddings(entries.map((e) => e.text))
      .then((vectors) => entries.map((e, i) => ({ ...e, vector: vectors[i] })))
      .catch((err) => {
        exampleVectors = null
        throw err
      })
  }
  return exampleVectors
}

// Topic 01's math. Bigger = more similar (max 1). pgvector's `<=>` is the
// opposite: cosine DISTANCE = 1 - this, smaller = closer. Google says the
// 3072-dim output is already normalised (so the dot product alone would do),
// but the full formula doesn't depend on that and costs nothing at this size.
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export type IntentScore = { intent: Intent; score: number; bestExample: string }

// One score per intent = its BEST matching example (a nearest-neighbour
// lookup), not the average: "hi" and "what can you do?" are both smalltalk but
// nothing alike, and averaging them would blur both. Sorted best first.
export async function scoreIntents(messageVector: number[]): Promise<IntentScore[]> {
  const examples = await getExampleVectors()
  const best = new Map<Intent, IntentScore>()
  for (const example of examples) {
    const score = cosineSimilarity(messageVector, example.vector)
    const current = best.get(example.intent)
    if (!current || score > current.score) {
      best.set(example.intent, { intent: example.intent, score, bestExample: example.text })
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score)
}

export type VectorRoute = { intent: Intent; margin: number; scores: IntentScore[] }

// The margin = how far the winner is ahead of the runner-up. Similarities of
// short texts sit in a narrow band, so "is the best score above 0.8?" is
// fragile; "is the winner clearly ahead?" says much more about how sure the
// router is (More_on §28).
export async function routeByVector(messageVector: number[]): Promise<VectorRoute> {
  const scores = await scoreIntents(messageVector)
  return { intent: scores[0].intent, margin: scores[0].score - scores[1].score, scores }
}

// ── The LLM classifier ──────────────────────────────────────────────────────

export type HistoryMessage = { role: string; content: string }

// The prompt says what each intent means, including the two cases the vector
// router can't see: follow-ups that only make sense with history, and
// negations ("don't quiz me"). Rule first, material after, the message last
// (same order as buildChatPrompt).
export function buildClassifierPrompt(message: string, history: HistoryMessage[]): string {
  const recent = history
    .slice(-ROUTER_HISTORY_MESSAGES)
    // a long answer only needs its gist to give a follow-up context
    .map((m) => `${m.role}: ${m.content.length > 300 ? `${m.content.slice(0, 300)}…` : m.content}`)
    .join('\n')

  return `You route messages for DocMind, an app where users chat with PDF documents they uploaded.
Classify the user's NEW message into exactly one intent:

- document_question: anything about the content of their documents, including follow-ups such as "why?", "give an example" or "and the second one?" that refer to an earlier answer, and questions about which documents they have.
- smalltalk: greetings, thanks, goodbyes, chit-chat, questions about you the assistant. Nothing that needs the documents.
- quiz_request: the user asks to be quizzed or tested on the material (practice or multiple-choice questions). NOT when they say they don't want a quiz.

If a message mixes small talk with a document question ("thanks! now what does page 3 say?"), it is a document_question.
${recent ? `\nRecent conversation (context only, do not classify it):\n${recent}\n` : ''}
New message: ${JSON.stringify(message)}`
}

// Structured-output mode + temperature 0 (the same message should always get
// the same label) → Zod. Returns null when the reply isn't a valid intent;
// THROWS when Gemini itself fails (network, 429, 503) — routeMessage() turns
// both into the safe default, the eval script counts them separately.
export async function classifyIntent(
  message: string,
  history: HistoryMessage[] = [],
): Promise<Intent | null> {
  const raw = await generateAnswer(buildClassifierPrompt(message, history), {
    responseMimeType: 'application/json',
    responseSchema: intentResponseSchema,
    temperature: 0,
  })
  try {
    const parsed = IntentReply.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data.intent : null
  } catch {
    return null // not even JSON
  }
}

// ── The hybrid ──────────────────────────────────────────────────────────────

export type RouteDecision = {
  intent: Intent
  // who decided: the vectors alone, the LLM (close call), or nobody (fallback)
  by: 'vector' | 'llm' | 'fallback'
  margin: number | null
  scores: IntentScore[]
  // what went wrong on the way, if anything (already summarizeError()'d).
  // The router never crashes a chat over a routing problem, but a swallowed
  // error would be invisible, so the caller logs these.
  errors: string[]
}

// AG.1 — when may the vector router decide ALONE? Measured with
// `npm run step7` (agents-plan.md §9 AG.1): vectors match shared WORDS, not
// intent, and every mistake they made above a 0.03 margin was a quiz offer
// ("compare the two pdfs" ≈ "quiz me about the pdf", "what is a quiz?" ≈
// "give me a quiz", even at a 0.141 margin). So the rule is:
//   - clearly ahead (margin ≥ ROUTER_MIN_MARGIN) AND not a quiz → vectors decide
//   - a quiz offer from vectors ALWAYS gets the LLM's second opinion: it's the
//     route that replaces an answer with something else, and real quiz
//     requests are rare, so checking them is cheap
// On the 41-message set this gave 0 wrong, with the LLM asked for 18/41 (the
// plain margin rule needed 0.15 and the LLM on 35/41). Shared with the eval,
// so the eval always measures exactly the rule that runs live.
//
// AG.2 follow-up (2026-10-28) — a vector document_question is accepted at ANY
// margin. Many real questions ("who wrote it?", "why?", "thanks, now what does
// page 3 say?") are vector-doc by a hair (0.002–0.022), and each of those used
// to cost an LLM call (out of 500/day, shared with the agent loop; median 9 s
// in the 52-message eval) for a question that was about the document anyway.
// On the eval: LLM calls 24/52 → 17/52, still 0 wrong. "Document" is the safe
// answer anyway:
// smalltalk sent down the document path just gets a document-flavoured reply,
// while a question sent to smalltalk gets NO search (the costly mistake).
// So the margin now only guards the one route that skips the search:
//   - vector says quiz_request      → always ask the LLM
//   - vector says document_question → decide, whatever the margin
//   - vector says smalltalk         → decide only when clearly ahead
export function vectorMayDecide(route: VectorRoute, minMargin: number = ROUTER_MIN_MARGIN): boolean {
  if (route.intent === 'quiz_request') return false
  if (route.intent === 'document_question') return true
  return route.margin >= minMargin
}

// Every path that isn't sure ends at document_question, never at smalltalk:
// a real question answered as smalltalk gets no search behind it (wrong AND
// confident), while smalltalk sent down the document path is just today's
// behaviour (More_on §29).
export async function routeMessage(
  message: string,
  messageVector: number[],
  history: HistoryMessage[] = [],
  minMargin: number = ROUTER_MIN_MARGIN,
): Promise<RouteDecision> {
  const errors: string[] = []
  let vector: VectorRoute | null = null
  try {
    vector = await routeByVector(messageVector)
    if (vectorMayDecide(vector, minMargin)) {
      return { intent: vector.intent, by: 'vector', margin: vector.margin, scores: vector.scores, errors }
    }
  } catch (err) {
    // the example phrases couldn't be embedded: let the LLM decide instead
    errors.push(`vector router: ${summarizeError(err)}`)
  }

  const margin = vector?.margin ?? null
  const scores = vector?.scores ?? []
  try {
    const intent = await classifyIntent(message, history)
    if (intent) return { intent, by: 'llm', margin, scores, errors }
    errors.push('classifier: reply was not a valid intent')
  } catch (err) {
    // Gemini failed: fall through to the safe default
    errors.push(`classifier: ${summarizeError(err)}`)
  }
  return { intent: 'document_question', by: 'fallback', margin, scores, errors }
}
