import { generateAnswer } from './llm.service'
import { sampleChunks } from '../repositories/chunks.repository'
import { Quiz, QuizQuestion, quizResponseSchema, QUIZ_LENGTH, OPTIONS_PER_QUESTION } from '../schemas/quiz.schema'
import { ALL_DOCUMENTS } from '../config'
import { pipelineEnd, step, detail, timing, preview, rejected, notFound, failed } from '../utils/pipelineLogger'

// Step 4.2 — POST /quiz: turn the Step 4.1 experiment into a real endpoint.
// Sample chunks spread across one document, ask Gemini for a quiz in
// structured-output mode, validate the reply with Zod, retry once if it's
// wrong, then shuffle the options in code (Step 4.1 found the model's own
// placement of the correct answer wasn't uniform — 22/36/32/10% across
// positions 0-3 — so that gets corrected here instead of trusted).

// How many chunks a quiz is built from. Kept at 5 (same as the Step 4.1
// experiment) for now — revisit if quizzes feel too narrow once real usage
// shows it.
export const CHUNKS_FOR_QUIZ = 5

// One real attempt + one retry. Never loop forever — if the model can't
// produce a valid quiz twice in a row, fail cleanly instead of burning
// Gemini calls on a request nobody is still waiting on.
const MAX_ATTEMPTS = 2

// Shared with npm run step4 (the Step 4.1 experiment script), so the prompt
// wording lives in exactly one place — same reasoning as buildChatPrompt().
export function buildQuizPrompt(context: string): string {
  return `Generate exactly ${QUIZ_LENGTH} multiple-choice questions based ONLY on the content below. Cover different parts of the content, and don't ask about anything the content doesn't say.

Respond with ONLY a JSON array — no markdown, no explanation, no text before or after — where each item is:
{ "question": string, "options": [exactly ${OPTIONS_PER_QUESTION} different strings], "correctIndex": number from 0 to ${OPTIONS_PER_QUESTION - 1} (the position of the correct option) }

Content:
${context}`
}

export type QuizCheckOutcome = { ok: true; quiz: Quiz } | { ok: false; reason: string }

// The two-stage check every LLM response should go through: is it even
// JSON, then is it the RIGHT JSON. Moved here from the Step 4.1 script so
// /quiz and `npm run step4` share one implementation instead of two copies.
export function checkQuizReply(raw: string): QuizCheckOutcome {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    // The classic: valid JSON wrapped in a ```json fence. JSON.parse chokes
    // on the backticks, so note whether stripping them would have saved it.
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    try {
      JSON.parse(stripped)
      return { ok: false, reason: 'valid JSON, but wrapped in ``` fences (JSON.parse rejects it as-is)' }
    } catch {
      return { ok: false, reason: `not JSON at all — starts with: ${JSON.stringify(raw.slice(0, 70))}` }
    }
  }

  // safeParse never throws — it returns a result we can branch on.
  const result = Quiz.safeParse(json)
  if (result.success) return { ok: true, quiz: result.data }

  // Zod reports every problem with the exact path to it, e.g. "3.options: ..."
  const problems = result.error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join('.') || '(whole quiz)'}: ${issue.message}`)
  const more = result.error.issues.length > 3 ? ` (+${result.error.issues.length - 3} more)` : ''
  return { ok: false, reason: `wrong shape — ${problems.join(' | ')}${more}` }
}

// Fisher-Yates shuffle of one question's options, remapping correctIndex to
// wherever the originally-correct option landed after shuffling.
function shuffleQuestion(q: QuizQuestion): QuizQuestion {
  const order = q.options.map((_, i) => i) // order[newPosition] = originalIndex
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }

  return {
    ...q,
    options: order.map((originalIndex) => q.options[originalIndex]),
    correctIndex: order.indexOf(q.correctIndex),
  }
}

export function shuffleQuiz(quiz: Quiz): Quiz {
  return quiz.map(shuffleQuestion)
}

export type GenerateQuizResult =
  | { ok: false; status: number; error: string }
  | { ok: true; documentId: string; quiz: Quiz }

// `documentId` comes in as `unknown` — same reasoning as prepareChat: it's
// raw request input, and validating it is step 1. Never touches req/res, so
// the route stays thin and this stays reusable (e.g. from a future worker).
export async function generateQuiz(input: { documentId: unknown }, t0: number): Promise<GenerateQuizResult> {
  const { documentId } = input

  if (!documentId || typeof documentId !== 'string') {
    rejected('missing/invalid documentId')
    return { ok: false, status: 400, error: 'documentId (string) is required' }
  }

  // A quiz needs one document's worth of chunks sampled in reading order —
  // "all documents" has no single reading order to sample across, so it's
  // rejected here rather than producing a quiz that jumps between PDFs.
  if (documentId === ALL_DOCUMENTS) {
    rejected('quiz requested for "all documents" — needs a single document')
    return { ok: false, status: 400, error: 'Quiz generation needs one specific document, not "All documents"' }
  }

  step('quiz', 1, 4, 'Request received')
  detail(`documentId: ${documentId}`)

  step('quiz', 2, 4, 'Sampling chunks spread across the document...')
  const sampleStart = Date.now()
  const chunks = await sampleChunks(documentId, CHUNKS_FOR_QUIZ)
  timing(Date.now() - sampleStart, `sampled ${chunks.length} chunk(s)`)

  if (chunks.length === 0) {
    notFound('No chunks found for this documentId — does it exist?')
    pipelineEnd('quiz', Date.now() - t0)
    return { ok: false, status: 404, error: 'No document found with that documentId' }
  }

  const prompt = buildQuizPrompt(chunks.join('\n\n---\n\n'))
  step('quiz', 3, 4, `Built prompt — ${prompt.length} characters`)

  step('quiz', 4, 4, 'Asking Gemini for a quiz (structured-output mode)...')
  // Structured-output mode constrains the shape Gemini replies with — see
  // Step 4.1's notes: it isn't a substitute for the Zod check below, but it
  // does make a valid reply more likely.
  const generationConfig = { responseMimeType: 'application/json', responseSchema: quizResponseSchema }

  let lastReason = 'no attempts made'
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const genStart = Date.now()
    const raw = await generateAnswer(prompt, generationConfig)
    timing(Date.now() - genStart, `attempt ${attempt}/${MAX_ATTEMPTS}`)

    const outcome = checkQuizReply(raw)
    if (outcome.ok) {
      const quiz = shuffleQuiz(outcome.quiz)
      preview('question 1', quiz[0].question, 120)
      pipelineEnd('quiz', Date.now() - t0)
      return { ok: true, documentId, quiz }
    }

    lastReason = outcome.reason
    detail(`attempt ${attempt}/${MAX_ATTEMPTS} invalid — ${outcome.reason}`)
  }

  // Both attempts failed — a case Step 4.1's testing never actually hit
  // (17/17 valid in real runs), but the code still has to handle it: fail
  // cleanly with a message a UI can show, instead of crashing on garbage.
  failed(`gave up after ${MAX_ATTEMPTS} attempts — ${lastReason}`)
  pipelineEnd('quiz', Date.now() - t0)
  return { ok: false, status: 502, error: `Could not generate a valid quiz right now — please try again` }
}
