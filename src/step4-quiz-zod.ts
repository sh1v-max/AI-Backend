import 'dotenv/config'
import { listDocuments } from './repositories/documents.repository'
import { sampleChunks } from './repositories/chunks.repository'
import { generateAnswer } from './services/llm.service'
import { Quiz, quizResponseSchema, QUIZ_LENGTH, OPTIONS_PER_QUESTION } from './schemas/quiz.schema'

// Step 4.1 — force an LLM to return reliable structured data.
//
// Run:  npm run step4 [documentId] [runs-per-mode]
//   documentId defaults to your newest uploaded document; runs default to 4.
//
// The experiment: ask for the same quiz two ways, several times each —
//   "plain"      just ask nicely in the prompt ("respond with ONLY JSON")
//   "structured" prompt + Gemini's structured-output mode (responseSchema)
// — and run every reply through Zod. The point isn't that one always wins;
// it's to SEE the ways a reply can be wrong, and that Zod catches all of them
// instead of letting garbage flow into a UI.

const CHUNKS_FOR_QUIZ = 5
const RUNS = Number(process.argv[3]) || 4

function buildQuizPrompt(context: string): string {
  return `Generate exactly ${QUIZ_LENGTH} multiple-choice questions based ONLY on the content below. Cover different parts of the content, and don't ask about anything the content doesn't say.

Respond with ONLY a JSON array — no markdown, no explanation, no text before or after — where each item is:
{ "question": string, "options": [exactly ${OPTIONS_PER_QUESTION} different strings], "correctIndex": number from 0 to ${OPTIONS_PER_QUESTION - 1} (the position of the correct option) }

Content:
${context}`
}

type Outcome = { ok: true; quiz: Quiz } | { ok: false; reason: string }

// The two-stage check every LLM response should go through:
//   1. is it even JSON?   (JSON.parse)
//   2. is it the RIGHT JSON?   (Zod)
function checkQuiz(raw: string): Outcome {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    // The classic: valid JSON wrapped in a ```json fence. JSON.parse chokes on
    // the backticks, so note whether stripping them would have saved it.
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

// A modern model is usually right, so waiting for it to slip up teaches slowly.
// Instead, feed the checker replies that are deliberately wrong in the ways
// real models go wrong — no API calls, so it's instant and repeatable.
function showBadReplyGallery() {
  const good = () => ({
    question: 'What does RAG stand for?',
    options: ['Retrieval-Augmented Generation', 'Random Answer Generator', 'Ranked Array Graph', 'Recursive Auto-Grader'],
    correctIndex: 0,
  })
  const quizOf = (...overrides: object[]) =>
    Array.from({ length: QUIZ_LENGTH }, (_, i) => ({ ...good(), ...(overrides[i] ?? {}) }))

  const samples: { label: string; raw: string }[] = [
    { label: 'a perfectly good quiz', raw: JSON.stringify(quizOf()) },
    { label: 'wrapped in ```json fences', raw: '```json\n' + JSON.stringify(quizOf()) + '\n```' },
    { label: 'friendly sentence before the JSON', raw: 'Sure! Here is your quiz:\n' + JSON.stringify(quizOf()) },
    { label: 'only 3 questions instead of 5', raw: JSON.stringify(quizOf().slice(0, 3)) },
    { label: 'a question with only 3 options', raw: JSON.stringify(quizOf({ options: ['a', 'b', 'c'] })) },
    { label: 'correctIndex as the string "2"', raw: JSON.stringify(quizOf({ correctIndex: '2' })) },
    { label: 'correctIndex out of range (4)', raw: JSON.stringify(quizOf({ correctIndex: 4 })) },
    { label: 'correctIndex is 1.5', raw: JSON.stringify(quizOf({ correctIndex: 1.5 })) },
    { label: 'two identical options', raw: JSON.stringify(quizOf({ options: ['x', 'x', 'y', 'z'] })) },
    { label: 'a question is missing its "question"', raw: JSON.stringify(quizOf({ question: undefined })) },
    { label: 'an object instead of an array', raw: JSON.stringify({ quiz: quizOf() }) },
  ]

  console.log('── Bad-reply gallery (no API calls) — what the checker does with each ──')
  for (const { label, raw } of samples) {
    const outcome = checkQuiz(raw)
    console.log(`  ${outcome.ok ? '✅' : '❌'} ${label}`)
    if (!outcome.ok) console.log(`       ↳ ${outcome.reason}`)
  }
  console.log()
}

async function main() {
  showBadReplyGallery()

  const documentId = process.argv[2] ?? (await listDocuments())[0]?.id
  if (!documentId) {
    console.log('No documents found — upload a PDF first.')
    process.exit(1)
  }

  console.log(`Document: ${documentId}`)
  const chunks = await sampleChunks(documentId, CHUNKS_FOR_QUIZ)
  console.log(`Sampled ${chunks.length} chunk(s) spread across the document\n`)
  const prompt = buildQuizPrompt(chunks.join('\n\n---\n\n'))

  const modes = [
    { name: 'plain', config: undefined },
    {
      name: 'structured',
      config: { responseMimeType: 'application/json', responseSchema: quizResponseSchema },
    },
  ]

  const tally: Record<string, { pass: number; fail: number }> = {}
  let firstGoodQuiz: Quiz | undefined
  const answerPositions = new Array(OPTIONS_PER_QUESTION).fill(0) as number[]

  for (const mode of modes) {
    tally[mode.name] = { pass: 0, fail: 0 }
    console.log(`── ${mode.name} mode ──`)

    for (let run = 1; run <= RUNS; run++) {
      let raw: string
      try {
        raw = await generateAnswer(prompt, mode.config)
      } catch (err) {
        tally[mode.name].fail++
        console.log(`  run ${run}: ❌ API error — ${err instanceof Error ? err.message.slice(0, 160) : err}`)
        continue
      }

      const outcome = checkQuiz(raw)
      if (outcome.ok) {
        tally[mode.name].pass++
        firstGoodQuiz ??= outcome.quiz
        for (const q of outcome.quiz) answerPositions[q.correctIndex]++
        console.log(`  run ${run}: ✅ valid quiz (${outcome.quiz.length} questions)`)
      } else {
        tally[mode.name].fail++
        console.log(`  run ${run}: ❌ ${outcome.reason}`)
      }
    }
    console.log()
  }

  console.log('── Summary ──')
  for (const [name, t] of Object.entries(tally)) {
    console.log(`  ${name.padEnd(10)} ${t.pass}/${t.pass + t.fail} valid`)
  }

  // Valid is not the same as good. Zod proves the SHAPE is right, not that the
  // content is sensible — e.g. does the model spread the correct answer around?
  const totalAnswers = answerPositions.reduce((a, b) => a + b, 0)
  if (totalAnswers > 0) {
    console.log('\nWhere the model put the correct answer, across every valid quiz:')
    answerPositions.forEach((n, i) =>
      console.log(`  position ${i}: ${String(n).padStart(3)}  (${Math.round((100 * n) / totalAnswers)}%)`),
    )
  }

  if (firstGoodQuiz) {
    const q = firstGoodQuiz[0]
    console.log('\nFirst question of a validated quiz — safe to use, fully typed:')
    console.log(`  ${q.question}`)
    q.options.forEach((option, i) => console.log(`   ${i === q.correctIndex ? '✔' : ' '} ${i}. ${option}`))
  }

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
