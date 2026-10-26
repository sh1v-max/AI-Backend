import 'dotenv/config'
import chalk from 'chalk'
import { pipelineStart, pipelineEnd } from './utils/pipelineLogger'
import { getEmbedding, getEmbeddings } from './services/embeddings.service'
import {
  INTENT_EXAMPLES,
  getExampleVectors,
  routeByVector,
  classifyIntent,
  cosineSimilarity,
  type VectorRoute,
  type HistoryMessage,
} from './services/router.service'
import { INTENTS, type Intent } from './schemas/intent.schema'
import { ROUTER_MIN_MARGIN } from './config'

// AG.1 — the router EVAL: is the router right, and where should the margin be?
//
// Run:
//   npm run step7           everything: vector router + LLM classifier on all
//                           41 messages, then the hybrid at every margin
//                           (~3 embedding calls + 41 Flash-Lite calls, ~4.5 min)
//   npm run step7 vector    only the vector router (3 embedding calls, seconds):
//                           for trying out different example phrases cheaply
//
// A router that's wrong doesn't crash anything, the user just gets a worse
// answer, so it has to be MEASURED before it's trusted (More_on §29). The
// trick that keeps this cheap: each router runs once per message, and the
// hybrid at ANY margin is computed from those two results afterwards
// ("vector if its margin ≥ m, else the LLM's answer"), with no extra calls.
//
// Safe to run any time: no database, no DocMind data. Flash-Lite is 15
// requests/minute on this key (shared with the live site), so classifier
// calls are paced PAUSE_MS apart.

const PAUSE_MS = 5000
const RETRY_AFTER_429_MS = 30_000

// ── The labelled set ────────────────────────────────────────────────────────
// Each message has the intent a human says is right (`expect`; an array when
// two answers are both fine). `heldOut` messages are NOT used to pick the
// margin, only to check it afterwards: tuning on the same messages you test
// on measures memory, not the router.
type EvalItem = {
  group: string
  message: string
  expect: Intent | Intent[]
  history?: HistoryMessage[]
  heldOut?: boolean
}

const turn = (question: string, answer: string): HistoryMessage[] => [
  { role: 'user', content: question },
  { role: 'assistant', content: answer },
]
const PRICING = turn('what are the pricing tiers?', 'There are three tiers: Basic at $10/month, Pro at $25/month and Team at $60/month.')
const SCHEDULE = turn('is the project on schedule?', 'No. The report says phase 2 is three weeks behind.')
const OVERFITTING = turn('what is overfitting according to the notes?', 'The notes describe overfitting as a model that memorises its training data and then fails on new data.')
const SECTION4 = turn('what does section 4 cover?', 'Section 4 covers the data retention policy and the backup schedule.')
const METHOD = turn('explain the methodology', 'The study ran a randomised controlled trial with 200 participants split into two groups for 12 weeks.')

const EVAL: EvalItem[] = [
  // smalltalk
  { group: 'smalltalk', message: 'hi', expect: 'smalltalk' },
  { group: 'smalltalk', message: 'hello there', expect: 'smalltalk' },
  { group: 'smalltalk', message: 'thanks!', expect: 'smalltalk' },
  { group: 'smalltalk', message: 'ok cool', expect: 'smalltalk' },
  { group: 'smalltalk', message: 'who are you?', expect: 'smalltalk' },
  { group: 'smalltalk', message: 'what can you do?', expect: 'smalltalk' },
  { group: 'smalltalk', message: 'good morning', expect: 'smalltalk' },
  { group: 'smalltalk', message: 'bye', expect: 'smalltalk' },
  { group: 'smalltalk', message: 'lol', expect: 'smalltalk' },
  { group: 'smalltalk', message: "you're awesome", expect: 'smalltalk', heldOut: true },
  // document questions
  { group: 'document', message: 'what is this document about?', expect: 'document_question' },
  { group: 'document', message: 'summarise section 2', expect: 'document_question' },
  { group: 'document', message: 'what does it say about pricing?', expect: 'document_question' },
  { group: 'document', message: 'explain the first point again', expect: 'document_question' },
  { group: 'document', message: 'which documents do I have?', expect: 'document_question' },
  { group: 'document', message: 'compare the two pdfs', expect: 'document_question' },
  { group: 'document', message: "I'm preparing for an interview and need to understand how the onboarding process in the handbook works, especially the probation period and who approves it. Can you walk me through it?", expect: 'document_question' },
  { group: 'document', message: 'wat r the main conclusons of the reprot', expect: 'document_question' },
  { group: 'document', message: 'isme pricing ke baare me kya likha hai?', expect: 'document_question' },
  { group: 'document', message: 'how many chapters are there?', expect: 'document_question' },
  { group: 'document', message: "what's the refund policy?", expect: 'document_question' },
  { group: 'document', message: 'define gradient descent as used in the notes', expect: 'document_question' },
  { group: 'document', message: 'who wrote it?', expect: 'document_question', heldOut: true },
  { group: 'document', message: 'is there anything about deadlines?', expect: 'document_question', heldOut: true },
  // follow-ups: meaningless alone, clear with the history
  { group: 'follow-up', message: 'and the second one?', expect: 'document_question', history: PRICING },
  { group: 'follow-up', message: 'why?', expect: 'document_question', history: SCHEDULE },
  { group: 'follow-up', message: 'give an example', expect: 'document_question', history: OVERFITTING },
  { group: 'follow-up', message: 'what about that?', expect: 'document_question', history: SECTION4 },
  { group: 'follow-up', message: 'can you explain it more simply?', expect: 'document_question', history: METHOD, heldOut: true },
  { group: 'follow-up', message: 'thanks!', expect: 'smalltalk', history: PRICING },
  // quiz requests
  { group: 'quiz', message: 'quiz me', expect: 'quiz_request' },
  { group: 'quiz', message: 'make me a quiz on this', expect: 'quiz_request' },
  { group: 'quiz', message: 'test me on chapter 1', expect: 'quiz_request' },
  { group: 'quiz', message: 'can you give me some MCQs?', expect: 'quiz_request' },
  { group: 'quiz', message: "I'd like to practise with a few questions", expect: 'quiz_request', heldOut: true },
  { group: 'quiz', message: 'mujhe iska quiz do', expect: 'quiz_request', heldOut: true },
  // traps: topic says one thing, meaning says another
  { group: 'trap', message: "don't quiz me, just explain the summary", expect: 'document_question' },
  { group: 'trap', message: 'what is a quiz?', expect: ['document_question', 'smalltalk'] },
  { group: 'trap', message: 'thanks, now what does page 3 say?', expect: 'document_question' },
  { group: 'trap', message: "no need for a test, what's the main argument?", expect: 'document_question', heldOut: true },
  { group: 'trap', message: 'hello! what does chapter 4 cover?', expect: 'document_question', heldOut: true },
]

// ── Judging ─────────────────────────────────────────────────────────────────
// Mistakes don't cost the same (More_on §29):
//   worst     a real question routed to smalltalk → answered with NO search
//   annoying  e.g. a question routed to the quiz offer, "hi" offered a quiz
//   harmless  smalltalk or a quiz request sent down the document path =
//             today's behaviour
type Verdict = 'ok' | 'worst' | 'annoying' | 'harmless'

function judge(item: EvalItem, predicted: Intent): Verdict {
  const accepted = Array.isArray(item.expect) ? item.expect : [item.expect]
  if (accepted.includes(predicted)) return 'ok'
  if (accepted.includes('document_question') && predicted === 'smalltalk') return 'worst'
  if (predicted === 'document_question') return 'harmless'
  return 'annoying'
}

// ── Printing ────────────────────────────────────────────────────────────────
const SHORT: Record<Intent, string> = { document_question: 'doc', smalltalk: 'small', quiz_request: 'quiz' }
const MARK: Record<Verdict, string> = {
  ok: chalk.green.bold('✓'),
  worst: chalk.red.bold('✗ WORST'),
  annoying: chalk.red('✗ annoying'),
  harmless: chalk.yellow('~ harmless'),
}
const t0 = Date.now()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text).padEnd(n)
const expectLabel = (item: EvalItem) =>
  (Array.isArray(item.expect) ? item.expect.map((i) => SHORT[i]).join('|') : SHORT[item.expect]).padEnd(9)
const tag = (item: EvalItem) => (item.history ? chalk.gray(' +history') : '') + (item.heldOut ? chalk.cyan(' [held out]') : '')

const findings: [string, string][] = []
const note = (fact: string, value: string) => {
  findings.push([fact, value])
  console.log(`  ${chalk.yellow.bold('★')} ${chalk.bold(fact)}: ${chalk.white(value)}`)
}

function confusion(title: string, predictions: Intent[]) {
  console.log(`\n  ${chalk.bold(title)}   ${chalk.gray('(rows = right answer, columns = what the router said)')}`)
  console.log(chalk.gray(`  ${''.padEnd(10)}${INTENTS.map((i) => SHORT[i].padStart(8)).join('')}`))
  for (const actual of INTENTS) {
    const cells = INTENTS.map((predicted) => {
      const n = EVAL.filter((item, k) => !Array.isArray(item.expect) && item.expect === actual && predictions[k] === predicted).length
      const text = String(n).padStart(8)
      return n === 0 ? chalk.gray(text) : actual === predicted ? chalk.green(text) : chalk.red(text)
    })
    console.log(`  ${chalk.gray(SHORT[actual].padEnd(10))}${cells.join('')}`)
  }
  const ambiguous = EVAL.filter((item) => Array.isArray(item.expect)).length
  if (ambiguous) console.log(chalk.gray(`  (${ambiguous} message(s) with two acceptable answers left out of the table)`))
}

function tally(predictions: Intent[], filter: (item: EvalItem) => boolean = () => true) {
  const verdicts = EVAL.map((item, k) => (filter(item) ? judge(item, predictions[k]) : null)).filter(
    (v): v is Verdict => v !== null,
  )
  return {
    total: verdicts.length,
    ok: verdicts.filter((v) => v === 'ok').length,
    worst: verdicts.filter((v) => v === 'worst').length,
    annoying: verdicts.filter((v) => v === 'annoying').length,
    harmless: verdicts.filter((v) => v === 'harmless').length,
  }
}

// ── Run ─────────────────────────────────────────────────────────────────────
async function main() {
  const mode = process.argv[2] ?? 'all'
  if (mode !== 'all' && mode !== 'vector') {
    console.error(chalk.red.bold('✗ Unknown mode. ') + chalk.red('Use: npm run step7 [all|vector]'))
    process.exit(1)
  }
  let embedCalls = 0
  let llmCalls = 0

  // 1. The example phrases, exactly the way the live router will load them
  pipelineStart('agent', '1. EXAMPLE PHRASES: embedded once, in one batch call')
  let started = Date.now()
  await getExampleVectors()
  embedCalls++
  console.log(
    chalk.gray('  ') +
      INTENTS.map((i) => `${SHORT[i]}: ${INTENT_EXAMPLES[i].length}`).join(chalk.gray(' · ')) +
      chalk.yellow(`  in ${Date.now() - started} ms`),
  )

  // 2. The 41 eval messages, also in one batch call
  pipelineStart('agent', `2. EMBEDDING THE ${EVAL.length} EVAL MESSAGES (one batch call)`)
  started = Date.now()
  const vectors = await getEmbeddings(EVAL.map((item) => item.message))
  embedCalls++
  console.log(chalk.yellow(`  done in ${Date.now() - started} ms`) + chalk.gray(` · ${vectors[0].length} dimensions`))

  // 3. Sanity check: in the live app the MESSAGE is embedded with
  // getEmbedding() (one call, embedContent) and the PHRASES with
  // getEmbeddings() (batch). Comparing them is only fair if both give the
  // same vector for the same text.
  pipelineStart('agent', '3. SAME VECTOR BOTH WAYS? getEmbedding() vs getEmbeddings() on the same text')
  const probe = EVAL.findIndex((item) => item.message === 'which documents do I have?')
  const single = await getEmbedding(EVAL[probe].message)
  embedCalls++
  const same = cosineSimilarity(single, vectors[probe])
  console.log(
    `  ${same > 0.9999 ? chalk.green.bold('✓') : chalk.red.bold('✗')} cosine(single, batch) = ` +
      (same > 0.9999 ? chalk.green(same.toFixed(6)) : chalk.red(same.toFixed(6))),
  )
  note('single vs batch embedding of the same text', `cosine ${same.toFixed(6)}${same > 0.9999 ? ' (identical)' : ' (DIFFERENT)'}`)

  // 4. The vector router alone
  pipelineStart('agent', '4. VECTOR ROUTER ALONE (0 API calls per message)')
  const vectorRoutes: VectorRoute[] = []
  for (const [k, item] of EVAL.entries()) {
    const route = await routeByVector(vectors[k])
    vectorRoutes.push(route)
    const [first, second] = route.scores
    console.log(
      `  ${MARK[judge(item, route.intent)].padEnd(12)} ${chalk.gray('expect')} ${expectLabel(item)} ` +
        `${chalk.gray('got')} ${chalk.bold(SHORT[route.intent].padEnd(6))}` +
        `${chalk.gray('margin')} ${chalk.yellow(route.margin.toFixed(3))}  ` +
        chalk.white(JSON.stringify(clip(item.message, 40))) +
        chalk.gray(`  best ${first.score.toFixed(3)} "${first.bestExample}" · 2nd ${SHORT[second.intent]} ${second.score.toFixed(3)}`) +
        tag(item),
    )
  }
  const vectorPredictions = vectorRoutes.map((r) => r.intent)
  const v = tally(vectorPredictions)
  note('vector router alone', `${v.ok}/${v.total} right · worst ${v.worst} · annoying ${v.annoying} · harmless ${v.harmless}`)
  confusion('Vector router', vectorPredictions)
  const margins = vectorRoutes.map((r) => r.margin).sort((a, b) => a - b)
  note('vector margins', `min ${margins[0].toFixed(3)} · median ${margins[Math.floor(margins.length / 2)].toFixed(3)} · max ${margins[margins.length - 1].toFixed(3)}`)

  if (mode === 'vector') return finish(embedCalls, llmCalls)

  // 5. The LLM classifier alone
  pipelineStart('agent', `5. LLM CLASSIFIER ALONE (1 Flash-Lite call per message, paced ${PAUSE_MS / 1000} s apart)`)
  const llmPredictions: (Intent | null)[] = []
  const llmMs: number[] = []
  let llmFailures = 0
  for (const [k, item] of EVAL.entries()) {
    if (k > 0) await sleep(PAUSE_MS)
    started = Date.now()
    let intent: Intent | null = null
    let failure = ''
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        llmCalls++
        intent = await classifyIntent(item.message, item.history ?? [])
        failure = intent ? '' : 'reply was not a valid intent'
        break
      } catch (err) {
        failure = err instanceof Error ? err.message.slice(0, 120) : String(err)
        // a 429 = the per-minute limit: wait it out once, then give up
        if (attempt === 1 && failure.includes('429')) {
          console.log(chalk.gray(`  … 429, waiting ${RETRY_AFTER_429_MS / 1000} s and retrying once`))
          await sleep(RETRY_AFTER_429_MS)
          continue
        }
        break
      }
    }
    const ms = Date.now() - started
    llmMs.push(ms)
    llmPredictions.push(intent)
    if (!intent) llmFailures++
    const shown: Intent = intent ?? 'document_question'
    console.log(
      `  ${(intent ? MARK[judge(item, shown)] : chalk.red.bold('✗ failed')).padEnd(12)} ${chalk.gray('expect')} ${expectLabel(item)} ` +
        `${chalk.gray('got')} ${chalk.bold((intent ? SHORT[intent] : '—').padEnd(6))}` +
        chalk.yellow(`${ms} ms`.padEnd(9)) +
        chalk.white(JSON.stringify(clip(item.message, 40))) +
        tag(item) +
        (failure ? chalk.red(`  ${failure}`) : ''),
    )
  }
  // a failed classification means the fallback, document_question
  const llmAsRouted: Intent[] = llmPredictions.map((i) => i ?? 'document_question')
  const l = tally(llmAsRouted)
  const sortedMs = [...llmMs].sort((a, b) => a - b)
  note('LLM classifier alone', `${l.ok}/${l.total} right · worst ${l.worst} · annoying ${l.annoying} · harmless ${l.harmless} · failed calls ${llmFailures}`)
  note('LLM classifier latency', `median ${sortedMs[Math.floor(sortedMs.length / 2)]} ms · max ${sortedMs[sortedMs.length - 1]} ms`)
  confusion('LLM classifier', llmAsRouted)

  // 6. The hybrid at every margin, computed from the two runs above
  pipelineStart('agent', '6. HYBRID SWEEP: vector if its margin ≥ m, otherwise the LLM (no extra calls)')
  const tuning = (item: EvalItem) => !item.heldOut
  const heldOut = (item: EvalItem) => !!item.heldOut
  const tuningCount = EVAL.filter(tuning).length
  console.log(
    chalk.gray(`  tuning set = ${tuningCount} messages, held-out = ${EVAL.length - tuningCount} (not used to choose m)\n`) +
      chalk.gray('  margin   vector decides   LLM calls   tuning: right  worst  annoying   held-out: right  worst  annoying'),
  )
  type SweepRow = { m: number; vectorDecides: number; tune: ReturnType<typeof tally>; held: ReturnType<typeof tally> }
  const rows: SweepRow[] = []
  for (let step = 0; step <= 20; step++) {
    const m = step / 100
    const hybrid = EVAL.map((_, k) => (vectorRoutes[k].margin >= m ? vectorRoutes[k].intent : llmAsRouted[k]))
    const row = {
      m,
      vectorDecides: vectorRoutes.filter((r) => r.margin >= m).length,
      tune: tally(hybrid, tuning),
      held: tally(hybrid, heldOut),
    }
    rows.push(row)
    const bad = (n: number) => (n ? chalk.red(String(n).padStart(5)) : chalk.green(String(n).padStart(5)))
    console.log(
      `  ${chalk.yellow(m.toFixed(2).padEnd(8))} ${String(`${row.vectorDecides}/${EVAL.length}`).padStart(14)}   ${String(EVAL.length - row.vectorDecides).padStart(9)}` +
        `   ${String(`${row.tune.ok}/${row.tune.total}`).padStart(13)}  ${bad(row.tune.worst)}  ${bad(row.tune.annoying).padStart(8)}` +
        `   ${String(`${row.held.ok}/${row.held.total}`).padStart(15)}  ${bad(row.held.worst)}  ${bad(row.held.annoying).padStart(8)}` +
        (m === ROUTER_MIN_MARGIN ? chalk.magentaBright('   ← current ROUTER_MIN_MARGIN') : ''),
    )
  }

  // The rule from agents-plan §2.2: the smallest margin where no real
  // question is routed away from the documents (worst AND annoying = 0) on
  // the tuning set. A bigger margin only adds LLM calls.
  const pick = rows.find((r) => r.tune.worst === 0 && r.tune.annoying === 0)
  if (pick) {
    note(
      'recommended ROUTER_MIN_MARGIN',
      `${pick.m.toFixed(2)} (smallest with 0 worst + 0 annoying on the tuning set): vector decides ${pick.vectorDecides}/${EVAL.length}, ` +
        `LLM ${EVAL.length - pick.vectorDecides} · held-out ${pick.held.ok}/${pick.held.total} right, worst ${pick.held.worst}, annoying ${pick.held.annoying}`,
    )
  } else {
    note('recommended ROUTER_MIN_MARGIN', 'none up to 0.20 has 0 worst + 0 annoying: the LLM itself makes those mistakes, read section 5')
  }
  return finish(embedCalls, llmCalls)
}

function finish(embedCalls: number, llmCalls: number) {
  pipelineStart('agent', `FINDINGS (${embedCalls} embedding call(s), ${llmCalls} Flash-Lite call(s))`)
  const width = Math.max(...findings.map(([fact]) => fact.length))
  for (const [fact, value] of findings) console.log(`  ${chalk.yellow.bold('★')} ${chalk.gray(fact.padEnd(width))}  ${chalk.white(value)}`)
  pipelineEnd('agent', Date.now() - t0, 'Total script time')
}

main().catch((err) => {
  console.error(chalk.red.bold('✗ step7 crashed: '), err)
  process.exit(1)
})
