import 'dotenv/config'
import chalk from 'chalk'
import { pipelineStart, pipelineEnd } from './utils/pipelineLogger'

// AG.0 — a learning script: what tool calling (function calling) actually
// looks like on the wire, before any of it touches DocMind's real chat.
//
// Run:
//   npm run step6              all seven experiments (~17 Gemini calls, ~1.5 min)
//   npm run step6 roundtrip    one at a time, to save quota:
//   npm run step6 stream         roundtrip | stream | choices | twopart | modes | gallery | laststep
//
// Safe to run any time: no database, no Redis, no DocMind code. The "document"
// is three hard-coded paragraphs about a made-up town, so the facts can only
// come from the tool, never from the model's own memory.
//
// Why a probe script first (agents-plan.md AG.0): the Gemini docs moved their
// function-calling guide to a newer API, and some things they don't say at all
// (does this model attach thought signatures? does a function call arrive in
// one piece inside a stream?). The answers decide how AG.3/AG.4 get built
// (decision D2), so we LOOK instead of guessing — same habit as step5's
// command counting.
//
// Quota: Flash-Lite is 15 requests/minute on this key, shared with the live
// site, so every call waits PAUSE_MS first (≤ 12/min).

const API_KEY = process.env.GEMINI_API_KEY
// Same model as llm.service.ts. "-latest" is an alias; every reply says which
// real model answered (`modelVersion`), which this script prints.
const MODEL_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest'
const PAUSE_MS = 5000

if (!API_KEY) {
  console.error(chalk.red.bold('✗ GEMINI_API_KEY is missing from .env (see .env.example).'))
  process.exit(1)
}

// ── Colours ─────────────────────────────────────────────────────────────────
// Same chalk + pipelineLogger as the app (importing pipelineLogger also
// forces colours on). Every kind of line has one colour, so a run can be read
// by colour alone:
//   magenta   the `agent` theme: experiment banners and outgoing calls (→)
//   green     a 200 coming back (←), and findings that went as hoped (✓)
//   red       errors and findings that need attention (✗)
//   yellow    what the MODEL asked for (functionCall) and timings
//   cyan      what OUR CODE did (⚙ ran a tool)
//   white     text the model wrote (answers)
//   gray      timestamps, token counts, signatures, waiting
const agent = chalk.magentaBright
const t0 = Date.now()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const stamp = () => chalk.gray(`[+${((Date.now() - t0) / 1000).toFixed(1)}s]`)
const log = (text: string) => console.log(`${stamp()} ${text}`)
const indent = (text: string) => log(`  ${text}`)

// ── The shapes (generateContent REST API, see agents-plan.md §13) ──────────
// A request's `contents` is a list of turns; each turn has a role and parts.
// A part is ONE of: text, a functionCall (model → us), a functionResponse
// (us → model). Any part may also carry a thoughtSignature (an opaque string
// the model needs back unchanged, More_on §25).
type FunctionCall = { id?: string; name: string; args?: Record<string, unknown> }
type FunctionResponse = { id?: string; name: string; response: Record<string, unknown> }
type Part = {
  text?: string
  thought?: boolean
  thoughtSignature?: string
  functionCall?: FunctionCall
  functionResponse?: FunctionResponse
}
type Content = { role: 'user' | 'model'; parts: Part[] }
type GeminiReply = {
  candidates?: { content?: Content; finishReason?: string }[]
  usageMetadata?: Record<string, unknown>
  modelVersion?: string
}
type Mode = 'AUTO' | 'ANY' | 'NONE'

// ── The fake document ───────────────────────────────────────────────────────
// Made-up facts on purpose: if an answer contains "Orla Vantris", it can only
// have come through the tool.
const FILENAME = 'velmora_guide.pdf'
const PARAGRAPHS = [
  'The Velmora lighthouse was built in 1874 by the engineer Orla Vantris. Its lamp burned whale oil until 1921, when it was converted to electricity.',
  'The Velmora ferry has three passes: a Day pass costs 4 credits, a Week pass costs 18 credits, and the Harbour card costs 60 credits per year. Children under 6 ride free.',
  'Every October the town holds the Lantern Festival, when residents float paper lanterns across the harbour. The festival started in 1902.',
]

// ── The tools: what we DECLARE to the model ─────────────────────────────────
// A declaration is name + description + JSON schema for the args. The
// description is the prompt for "when should I call this?" (More_on §14).
// `parameters` uses the same OpenAPI-style schema (uppercase types) as the
// quiz's responseSchema in Phase 4.
//
// Notice what's NOT here: no documentId, no userId. In the real app the tool
// closes over those on the server (agents-plan rule 1). The model only gets to
// choose the search words.
const DECLARATIONS = [
  {
    name: 'searchDocuments',
    description:
      "Search the user's uploaded documents for passages relevant to a query. Use it for ANY question about the documents' content, before answering. Not for greetings or questions about yourself.",
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description:
            'A standalone search query. Resolve "it", "the second one" etc. from the conversation.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'listDocuments',
    description:
      "List the user's uploaded documents (filename, status, number of chunks). Use it when the user asks which documents they have.",
    // no `parameters`: this tool takes no arguments
  },
]

const SYSTEM_INSTRUCTION = `You are DocMind, an assistant that answers questions about the user's uploaded documents.
For any question about the documents' content you must call searchDocuments first and answer only from what it returns.
Never answer document questions from general knowledge. If the search results don't contain the answer, say so plainly.
For greetings and small talk, reply briefly without calling any tool.`

// ── The tools: what our CODE runs ───────────────────────────────────────────
// The model never runs these. It returns a functionCall; we look the name up
// in a fixed switch (a whitelist — an unknown name can't run anything) and
// send the result back. Bad args and unknown names come back as { error },
// as DATA, not as an exception (More_on §9).
function runTool(call: FunctionCall): Record<string, unknown> {
  switch (call.name) {
    case 'searchDocuments': {
      const query = call.args?.query
      if (typeof query !== 'string' || !query.trim()) {
        return { error: 'query must be a non-empty string' }
      }
      return fakeSearch(query)
    }
    case 'listDocuments':
      return { documents: [{ filename: FILENAME, status: 'ready', chunkCount: PARAGRAPHS.length }] }
    default:
      return { error: `unknown tool: ${call.name}` }
  }
}

// Stands in for getEmbedding + searchSimilar: rank paragraphs by how many of
// the query's words (4+ letters) they contain. Good enough to see WHAT query
// the model writes, which is the point here.
function fakeSearch(query: string): Record<string, unknown> {
  const words = (query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 3)
  const ranked = PARAGRAPHS.map((content) => ({
    content,
    score: words.filter((w) => content.toLowerCase().includes(w)).length,
  }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
  return ranked.length
    ? { results: ranked.map((r) => ({ filename: FILENAME, content: r.content })) }
    : { results: [], note: 'nothing relevant found' }
}

// ── Building requests ───────────────────────────────────────────────────────
const user = (text: string): Content => ({ role: 'user', parts: [{ text }] })

function buildRequest(contents: Content[], mode: Mode = 'AUTO') {
  return {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents,
    tools: [{ functionDeclarations: DECLARATIONS }],
    // AUTO = model decides (text or a call), ANY = must call, NONE = must not
    toolConfig: { functionCallingConfig: { mode } },
  }
}

const functionCallsOf = (turn: Content | undefined) =>
  (turn?.parts ?? []).filter((p) => p.functionCall).map((p) => p.functionCall!)

// Run every function call in the model's turn and build OUR reply turn.
// Function responses go in a 'user' turn (roles are only 'user' | 'model').
// If the call carried an `id`, the response carries the same id.
function toolResponseTurn(turn: Content): Content {
  return {
    role: 'user',
    parts: functionCallsOf(turn).map((call) => {
      const response = runTool(call)
      indent(
        chalk.cyan.bold('⚙ ran ') +
          chalk.cyan(`${call.name}(${JSON.stringify(call.args ?? {})})`) +
          chalk.gray(` → ${JSON.stringify(response).slice(0, 100)}…`),
      )
      return {
        functionResponse: { ...(call.id && { id: call.id }), name: call.name, response },
      }
    }),
  }
}

// ── Printing ────────────────────────────────────────────────────────────────
// Signatures are long base64 blobs, so they're shown by length only.
const shortenSignatures = (key: string, value: unknown) =>
  key === 'thoughtSignature' && typeof value === 'string' ? `<signature, ${value.length} chars>` : value

function describeParts(parts: Part[] | undefined): string {
  if (!parts?.length) return chalk.gray('(no parts)')
  return parts
    .map((p) => {
      const bits: string[] = []
      if (p.thought) bits.push(chalk.gray.italic('THOUGHT'))
      if (p.functionCall) {
        const id = p.functionCall.id ? chalk.gray(` id=${p.functionCall.id}`) : chalk.red(' (no id)')
        bits.push(
          chalk.yellow.bold(`functionCall ${p.functionCall.name}`) +
            chalk.yellow(`(${JSON.stringify(p.functionCall.args ?? {})})`) +
            id,
        )
      }
      if (p.text !== undefined) {
        bits.push(chalk.gray(`text(${p.text.length}) `) + chalk.white(JSON.stringify(p.text.slice(0, 60))))
      }
      if (p.thoughtSignature) bits.push(chalk.gray.dim(`+signature(${p.thoughtSignature.length})`))
      return `${chalk.gray('[')}${bits.join(' ')}${chalk.gray(']')}`
    })
    .join(' ')
}

function describeUsage(usage: Record<string, unknown> | undefined): string {
  if (!usage) return chalk.gray('no usageMetadata')
  const pick = ['promptTokenCount', 'candidatesTokenCount', 'thoughtsTokenCount', 'totalTokenCount']
  return chalk.gray(
    pick.filter((k) => usage[k] !== undefined).map((k) => `${k.replace('TokenCount', '')}=${usage[k]}`).join(' '),
  )
}

const finishLabel = (reason: string | undefined) =>
  reason === 'STOP' ? chalk.gray(`finishReason=${reason}`) : chalk.red(`finishReason=${reason}`)

function printAnswer(text: string) {
  indent(chalk.gray('answer: ') + chalk.white(text.replace(/\n+/g, ' ')))
}

// Facts collected along the way, printed as a table at the end. These are
// what goes into agents-plan.md §9 (AG.0) and §13.
//   good = went as hoped (green ✓) · bad = needs attention (red ✗) · info = just a fact (yellow ★)
type Tone = 'good' | 'bad' | 'info'
const TONES = {
  good: { mark: chalk.green.bold('✓'), color: chalk.green },
  bad: { mark: chalk.red.bold('✗'), color: chalk.red },
  info: { mark: chalk.yellow.bold('★'), color: chalk.white },
}
const findings: [string, string, Tone][] = []
const note = (fact: string, value: string, tone: Tone = 'info') => {
  findings.push([fact, value, tone])
  indent(`${TONES[tone].mark} ${chalk.bold(fact)}: ${TONES[tone].color(value)}`)
}

// ── Calling Gemini ──────────────────────────────────────────────────────────
let callCount = 0

async function pace() {
  if (callCount > 0) {
    log(chalk.gray(`… waiting ${PAUSE_MS / 1000} s (15 requests/min limit)`))
    await sleep(PAUSE_MS)
  }
  callCount++
}

const outgoing = (kind: string, label: string) =>
  log(agent.bold(`→ call #${callCount}`) + agent(` (${kind}) `) + label)

function errorLine(status: number, ms: number | null, error: string) {
  log(
    chalk.red.bold(`← ${status}`) +
      (ms !== null ? chalk.yellow(` in ${ms} ms`) : '') +
      chalk.red(`: ${error.replace(/\s+/g, ' ').slice(0, 300)}`),
  )
}

// Non-streamed (generateContent). Never throws on a non-200: the gallery WANTS
// to see the error bodies.
async function callGemini(body: object, label: string) {
  await pace()
  outgoing('generateContent', label)
  const started = Date.now()
  const res = await fetch(`${MODEL_URL}:generateContent?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const ms = Date.now() - started
  if (!res.ok) {
    const error = await res.text()
    errorLine(res.status, ms, error)
    return { ok: false as const, status: res.status, error }
  }
  const reply = (await res.json()) as GeminiReply
  const candidate = reply.candidates?.[0]
  log(
    chalk.green.bold('← 200') +
      chalk.yellow(` in ${ms} ms`) +
      chalk.gray(' · ') +
      finishLabel(candidate?.finishReason) +
      chalk.gray(' · ') +
      describeUsage(reply.usageMetadata),
  )
  indent(chalk.gray('model turn: ') + describeParts(candidate?.content?.parts))
  return { ok: true as const, reply, turn: candidate?.content, finishReason: candidate?.finishReason }
}

// Streamed (streamGenerateContent?alt=sse). Same byte-level parsing as
// streamAnswer() in llm.service.ts (\r\n normalised on the whole buffer, split
// on blank lines, keep the trailing partial event). Every event is logged as
// it arrives, which is the whole point: we want to SEE how a function call is
// cut up inside a stream.
async function streamGemini(body: object, label: string) {
  await pace()
  outgoing('streamGenerateContent', label)
  const started = Date.now()
  const res = await fetch(`${MODEL_URL}:streamGenerateContent?alt=sse&key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok || !res.body) {
    errorLine(res.status, null, await res.text())
    return { ok: false as const, events: [] as GeminiReply[] }
  }

  const events: GeminiReply[] = []
  const handle = (frame: string) => {
    const line = frame.trim()
    if (!line.startsWith('data: ')) return
    const event = JSON.parse(line.slice('data: '.length)) as GeminiReply
    events.push(event)
    const finish = event.candidates?.[0]?.finishReason
    indent(
      chalk.green(`event #${events.length}`) +
        chalk.yellow(` at +${Date.now() - started} ms`) +
        chalk.gray(': ') +
        describeParts(event.candidates?.[0]?.content?.parts) +
        (finish ? chalk.gray(' · ') + finishLabel(finish) : '') +
        (event.usageMetadata ? chalk.gray(' · ') + describeUsage(event.usageMetadata) : ''),
    )
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n')
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    frames.forEach(handle)
  }
  if (buffer.trim()) handle(buffer) // a last event with no trailing blank line
  log(
    chalk.green.bold('← stream ended') +
      chalk.yellow(` after ${Date.now() - started} ms`) +
      chalk.gray(`, ${events.length} event(s)`),
  )
  return { ok: true as const, events }
}

// Rebuild ONE model turn from all the stream's events: this is what would be
// pushed into `contents` for the next request. Rules (More_on §26):
// adjacent plain-text parts are joined (one answer split by the network);
// function calls and anything carrying a signature are kept exactly as sent.
function reassembleTurn(events: GeminiReply[]): Content {
  const parts: Part[] = []
  const isPlainText = (p: Part | undefined) =>
    p !== undefined && p.text !== undefined && !p.thought && !p.thoughtSignature && !p.functionCall
  for (const event of events) {
    for (const part of event.candidates?.[0]?.content?.parts ?? []) {
      const last = parts[parts.length - 1]
      if (isPlainText(part) && isPlainText(last)) last.text += part.text!
      else parts.push({ ...part })
    }
  }
  return { role: 'model', parts }
}

const textOf = (turn: Content | undefined) =>
  (turn?.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join('')

// ── Experiment A: one full round trip, not streamed ─────────────────────────
async function roundtrip() {
  pipelineStart('agent', 'A. ROUND TRIP (not streamed): question → functionCall → we run it → functionResponse → answer')
  const contents: Content[] = [user('When was the Velmora lighthouse built, and who built it?')]

  const first = await callGemini(buildRequest(contents), 'the question, with 2 tools declared')
  if (!first.ok || !first.turn) return
  console.log(chalk.gray('\n    The model turn, raw (signatures shortened):'))
  console.log(chalk.yellow(JSON.stringify(first.turn, shortenSignatures, 2).replace(/^/gm, '    ')) + '\n')
  note('model behind gemini-flash-lite-latest', first.reply.modelVersion ?? '(not sent)')
  const calls = functionCallsOf(first.turn)
  note(
    'A: called a tool for a document question?',
    calls.length ? `yes: ${calls.map((c) => c.name).join(', ')}` : 'NO',
    calls.length ? 'good' : 'bad',
  )
  if (!calls.length) return
  note('functionCall has an id?', calls[0].id ? `yes (${calls[0].id})` : 'no')
  const signed = first.turn.parts.filter((p) => p.thoughtSignature)
  note(
    'thoughtSignature on the call turn?',
    signed.length
      ? `yes, on ${signed.map((p) => (p.functionCall ? 'the functionCall part' : 'a text part')).join(' + ')}`
      : 'no',
  )
  note('thoughtsTokenCount on the decision call', String(first.reply.usageMetadata?.thoughtsTokenCount ?? 0))

  // The model's turn goes back EXACTLY as received (rule 7), then our results.
  contents.push(first.turn, toolResponseTurn(first.turn))
  const second = await callGemini(buildRequest(contents), 'everything so far + the functionResponse')
  if (!second.ok) return
  printAnswer(textOf(second.turn))
  const grounded = /vantris/i.test(textOf(second.turn))
  note('A: answer used the tool result?', grounded ? 'yes (mentions Orla Vantris)' : 'NO', grounded ? 'good' : 'bad')
}

// ── Experiment B: the same round trip, streamed ─────────────────────────────
async function stream() {
  pipelineStart('agent', 'B. ROUND TRIP, STREAMED: how does a functionCall arrive inside an SSE stream?')
  const contents: Content[] = [user('What ferry passes are there, and what does each one cost?')]

  const first = await streamGemini(buildRequest(contents), 'the question, streamed, tools declared')
  if (!first.ok) return
  const withCall = first.events.filter((e) => e.candidates?.[0]?.content?.parts?.some((p) => p.functionCall))
  const withSignature = first.events.filter((e) => e.candidates?.[0]?.content?.parts?.some((p) => p.thoughtSignature))
  const textBeforeCall = first.events
    .slice(0, first.events.findIndex((e) => withCall.includes(e)))
    .some((e) => textOf(e.candidates?.[0]?.content))
  note('B: events in the decision stream', String(first.events.length))
  note(
    'B: events carrying a functionCall',
    `${withCall.length} (1 = the call arrives whole, args included)`,
    withCall.length === 1 ? 'good' : 'bad',
  )
  note('B: events carrying a signature', String(withSignature.length))
  note('B: text streamed BEFORE the call?', textBeforeCall ? 'yes' : 'no', textBeforeCall ? 'bad' : 'good')

  const turn = reassembleTurn(first.events)
  indent(chalk.gray('reassembled model turn: ') + describeParts(turn.parts))
  if (!functionCallsOf(turn).length) {
    note('B: called a tool?', 'NO (answered directly)', 'bad')
    return
  }

  contents.push(turn, toolResponseTurn(turn))
  const second = await streamGemini(buildRequest(contents), 'reassembled turn + functionResponse, streamed')
  if (!second.ok) return
  printAnswer(textOf(reassembleTurn(second.events)))
  note('B: reassembled turn accepted by the API?', 'yes (the 2nd call succeeded)', 'good')
  note(
    'B: final answer streamed in',
    `${second.events.filter((e) => textOf(e.candidates?.[0]?.content)).length} text event(s)`,
  )
}

// ── Experiment C: does the model choose well? ───────────────────────────────
async function choices() {
  pipelineStart('agent', 'C. CHOICES: smalltalk and a meta question, same tools declared (mode AUTO)')
  const hi = await callGemini(buildRequest([user('hi!')]), '"hi!"')
  if (hi.ok) {
    const calls = functionCallsOf(hi.turn)
    note(
      'C: "hi!" → tool call?',
      calls.length ? `yes (${calls[0].name}), unwanted` : `no, replied: ${JSON.stringify(textOf(hi.turn).slice(0, 60))}`,
      calls.length ? 'bad' : 'good',
    )
  }

  const meta = await callGemini(buildRequest([user('Which documents do I have?')]), '"Which documents do I have?"')
  if (meta.ok) {
    const calls = functionCallsOf(meta.turn)
    note(
      'C: "Which documents do I have?" →',
      calls.length ? calls.map((c) => c.name).join(', ') : 'no tool (answered from nothing)',
      calls.some((c) => c.name === 'listDocuments') ? 'good' : 'bad',
    )
  }
}

// ── Experiment D: a two-part question in a capped loop ──────────────────────
// This is the agent loop from More_on §9 in miniature: call → if function
// calls, run them and go again → stop on text or at MAX_STEPS (the last step
// runs with mode NONE so the model has to answer — experiment G shows why
// the real loop leaves `tools` out instead).
async function twopart() {
  pipelineStart('agent', 'D. TWO-PART QUESTION in a loop capped at 3 steps: one call, two calls in one turn, or two turns?')
  const MAX_STEPS = 3
  const contents: Content[] = [user('Who built the lighthouse, and how much is a week pass on the ferry?')]
  const pattern: string[] = []
  for (let stepNo = 1; stepNo <= MAX_STEPS; stepNo++) {
    const mode: Mode = stepNo === MAX_STEPS ? 'NONE' : 'AUTO'
    const reply = await callGemini(buildRequest(contents, mode), `step ${stepNo}/${MAX_STEPS} (mode ${mode})`)
    if (!reply.ok || !reply.turn) return
    contents.push(reply.turn)
    const calls = functionCallsOf(reply.turn)
    if (!calls.length) {
      pattern.push('answer')
      printAnswer(textOf(reply.turn))
      break
    }
    pattern.push(`${calls.length} call(s): ${calls.map((c) => JSON.stringify(c.args?.query ?? '')).join(' + ')}`)
    contents.push(toolResponseTurn(reply.turn))
  }
  note('D: what the model did, step by step', pattern.join(' → '))
}

// ── Experiment E: forcing the choice ────────────────────────────────────────
async function modes() {
  pipelineStart('agent', 'E. MODES: ANY (must call a tool) and NONE (may not)')
  const any = await callGemini(buildRequest([user('thanks!')], 'ANY'), '"thanks!" with mode ANY')
  if (any.ok) {
    const calls = functionCallsOf(any.turn)
    note(
      'E: mode ANY on "thanks!"',
      calls.length ? `forced a call: ${calls[0].name}(${JSON.stringify(calls[0].args ?? {})})` : 'no call (?)',
    )
  }

  const none = await callGemini(buildRequest([user('When was the lighthouse built?')], 'NONE'), 'a document question with mode NONE')
  if (none.ok) {
    const called = functionCallsOf(none.turn).length > 0
    note(
      'E: mode NONE on a document question',
      called ? 'still called a tool: NONE was ignored' : `no call, said: ${JSON.stringify(textOf(none.turn).slice(0, 80))}`,
      called ? 'bad' : 'good',
    )
  }
}

// ── Experiment F: the failure gallery ───────────────────────────────────────
// Break the round trip on purpose and read the errors, so they're familiar
// when they show up for real. Here a 400 is the EXPECTED result.
async function gallery() {
  pipelineStart('agent', 'F. FAILURE GALLERY: drop the signature, and answer under the wrong function name')
  const contents: Content[] = [user('When was the Velmora lighthouse built?')]
  const first = await callGemini(buildRequest(contents), 'a fresh decision to break')
  if (!first.ok || !first.turn || !functionCallsOf(first.turn).length) {
    indent(chalk.gray('(no function call this time, nothing to break)'))
    return
  }
  const responses = toolResponseTurn(first.turn)

  // F1: rebuild the model turn by hand without signatures — the classic bug
  // (More_on §25: "never rebuild the model's turn from its pieces").
  if (first.turn.parts.some((p) => p.thoughtSignature)) {
    const stripped: Content = {
      role: 'model',
      parts: first.turn.parts.map(({ thoughtSignature: _dropped, ...rest }) => rest),
    }
    const f1 = await callGemini(buildRequest([...contents, stripped, responses]), 'F1: same turn, signature REMOVED')
    note(
      'F1: signature removed →',
      f1.ok ? `accepted (finishReason=${f1.finishReason})` : `rejected with ${f1.status} (expected)`,
      f1.ok ? 'bad' : 'good',
    )
  } else {
    note('F1: signature removed →', 'skipped (this turn had no signature)')
  }

  // F2: our functionResponse names a function the model never called.
  const renamed: Content = {
    role: 'user',
    parts: responses.parts.map((p) => ({ functionResponse: { ...p.functionResponse!, name: 'searchDocs' } })),
  }
  const f2 = await callGemini(buildRequest([...contents, first.turn, renamed]), 'F2: functionResponse under the WRONG name')
  note(
    'F2: wrong functionResponse name →',
    f2.ok
      ? `accepted (finishReason=${f2.finishReason}), answer: ${JSON.stringify(textOf(f2.turn).slice(0, 60))}`
      : `rejected with ${f2.status} (expected)`,
    f2.ok ? 'bad' : 'good',
  )
}

// ── Experiment G: how do we FORCE an answer on the loop's last step? ────────
// Added after the first full run: experiment E showed mode NONE being ignored
// on a fresh question (the model still returned a functionCall). The plan's
// loop relies on NONE for its last step, so: does it repeat, does it hold in
// the real situation (a tool already ran), and what if `tools` is left out of
// the request entirely?
async function laststep() {
  pipelineStart('agent', 'G. LAST STEP: mode NONE again, NONE after a tool already ran, and no `tools` at all')
  const fresh = await callGemini(buildRequest([user('When was the lighthouse built?')], 'NONE'), 'G1: fresh question, mode NONE (repeat of E)')
  if (fresh.ok) {
    const called = functionCallsOf(fresh.turn).length > 0
    note('G1: NONE on a fresh question (repeat)', called ? 'called a tool AGAIN' : 'answered without a tool', called ? 'bad' : 'good')
  }

  // The real loop situation: question → call → result, then the last step.
  const contents: Content[] = [user('When did the Lantern Festival start?')]
  const first = await callGemini(buildRequest(contents), 'a decision, to get a completed tool round')
  if (!first.ok || !first.turn || !functionCallsOf(first.turn).length) return
  contents.push(first.turn, toolResponseTurn(first.turn))

  const none = await callGemini(buildRequest(contents, 'NONE'), 'G2: after the tool ran, mode NONE')
  if (none.ok) {
    const called = functionCallsOf(none.turn).length > 0
    note(
      'G2: NONE after a tool round',
      called ? 'called a tool AGAIN' : `answered: ${JSON.stringify(textOf(none.turn).slice(0, 60))}`,
      called ? 'bad' : 'good',
    )
  }

  // Same contents, but no tools/toolConfig in the request at all. The history
  // still contains a functionCall + functionResponse: is that accepted?
  const { tools: _tools, toolConfig: _toolConfig, ...withoutTools } = buildRequest(contents)
  const bare = await callGemini(withoutTools, 'G3: after the tool ran, NO tools declared')
  const answered = bare.ok && functionCallsOf(bare.turn).length === 0
  note(
    'G3: no tools declared, tool round in history',
    !bare.ok
      ? `rejected with ${bare.status}`
      : answered
        ? `accepted, answered: ${JSON.stringify(textOf(bare.turn).slice(0, 60))}`
        : `still a call (finishReason=${bare.finishReason})`,
    answered ? 'good' : 'bad',
  )
}

// ── Run ─────────────────────────────────────────────────────────────────────
const EXPERIMENTS: Record<string, () => Promise<void>> = { roundtrip, stream, choices, twopart, modes, gallery, laststep }

async function main() {
  const which = process.argv[2] ?? 'all'
  const names = which === 'all' ? Object.keys(EXPERIMENTS) : [which]
  const unknown = names.filter((n) => !EXPERIMENTS[n])
  if (unknown.length) {
    console.error(chalk.red.bold(`✗ Unknown experiment "${unknown[0]}". `) + chalk.red(`Use: all | ${Object.keys(EXPERIMENTS).join(' | ')}`))
    process.exit(1)
  }
  for (const name of names) await EXPERIMENTS[name]()

  pipelineStart('agent', `FINDINGS (${callCount} Gemini call(s))`)
  const width = Math.max(...findings.map(([fact]) => fact.length))
  for (const [fact, value, tone] of findings) {
    console.log(`  ${TONES[tone].mark} ${chalk.gray(fact.padEnd(width))}  ${TONES[tone].color(value)}`)
  }
  pipelineEnd('agent', Date.now() - t0, 'Total script time')
}

main().catch((err) => {
  console.error(chalk.red.bold('✗ step6 crashed: '), err)
  process.exit(1)
})
