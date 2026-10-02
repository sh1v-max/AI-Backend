# 12 — Testing & Observability

**Roadmap: Phase 9** · **Status in DocMind: no tests yet** (`npm test` is still the default placeholder). Observability is partly there already: `pipelineLogger`, `summarizeError`, and the frontend `[DocMind:<scope>]` logger. This file covers how to test an AI backend and how to see what it's doing in production.

Code this file talks about: [quiz.service.ts](../../src/services/quiz.service.ts), [quiz.schema.ts](../../src/schemas/quiz.schema.ts), [chat.service.ts](../../src/services/chat.service.ts), [llm.service.ts](../../src/services/llm.service.ts), [chunkText.ts](../../src/utils/chunkText.ts), [errors.ts](../../src/utils/errors.ts), [pipelineLogger.ts](../../src/utils/pipelineLogger.ts), [app.ts](../../src/app.ts)

---

# PART A — TESTING

---

# 1. Why Is Testing an AI Backend Different?

A normal function:

```text
add(2, 3) → 5      every time. assert it.
```

An LLM call:

```text
generateAnswer("Explain RAG") → a different paragraph every time
```

You can't write `expect(answer).toBe("...")`. So people conclude "AI apps can't be tested". That's wrong, and seeing why is the whole topic.

Look at what DocMind's code actually does:

```text
validate input            deterministic
chunk text                deterministic
build a prompt string     deterministic
call Gemini               NON-deterministic  ← one line
parse / validate reply    deterministic
retry logic               deterministic
shuffle options           random, but with a testable invariant
save to DB                deterministic
format SSE frames         deterministic
```

Maybe 5% of the code is non-deterministic. The other 95% is ordinary code that happens to sit around an LLM call.

> **Mock the LLM at the boundary. Test everything else like normal software.**

---

# 2. Simple Analogy

A restaurant kitchen where one ingredient is delivered by an unreliable supplier.

You can't test the supplier. But you can test your kitchen:

* If the delivery is good → does the dish come out right?
* If the delivery is rotten → does the cook notice and reorder?
* If it's rotten twice → does the waiter apologise properly instead of serving it?

To run those tests you don't wait for a real delivery. You hand the cook a **fake delivery** you prepared: one good, one rotten.

The fake delivery is a **mock**.

---

# 3. Two Different Questions

Keep these apart. They need different tools.

```text
TESTING      "Does my CODE behave correctly?"
             deterministic, fast, runs on every commit, pass/fail
             → Vitest + mocks                              (this file)

EVALUATION   "Are the model's ANSWERS any good?"
             statistical, slow, costs API calls, a score not pass/fail
             → golden sets, LLM-as-judge                   (advanced/04)
```

A test says "when the model returns a 3-option question, we retry". An eval says "82% of answers were grounded in the retrieved chunks".

---

# 4. The Boundary

DocMind already has a clean boundary. Every external thing is behind one small module:

```text
llm.service.ts          → Gemini generation      (generateAnswer, streamAnswer)
embeddings.service.ts   → Gemini embeddings      (getEmbedding)
repositories/*          → Postgres               (the only place SQL lives)
```

Everything else imports those functions. So in a test you replace **those three things** and the rest runs for real.

That's the payoff of two rules from the 2026-09-20 refactor:

* "nothing outside `repositories/` touches SQL"
* "services never touch `req`/`res`"

They weren't only about tidiness. They're what makes the code testable without a database, a network, or an HTTP server.

---

# 5. Vitest in Five Minutes

```bash
npm install -D vitest
```

```json
"scripts": { "test": "vitest run", "test:watch": "vitest" }
```

```ts
import { describe, it, expect } from 'vitest'
import { chunkText } from '../src/utils/chunkText'

describe('chunkText', () => {
  it('splits into chunks of at most N words', () => {
    const text = Array.from({ length: 1200 }, (_, i) => `w${i}`).join(' ')
    const chunks = chunkText(text, 500)
    expect(chunks).toHaveLength(3)
    expect(chunks[2].split(' ')).toHaveLength(200)
  })

  it('returns no chunks for empty text', () => {
    expect(chunkText('   ')).toEqual([])
  })
})
```

Why Vitest over Jest here: it runs TypeScript with no extra setup, it's fast, and the frontend already uses Vite. The API is nearly identical to Jest (`describe`, `it`, `expect`, `vi.fn()` instead of `jest.fn()`).

The mock toolbox:

| Tool | Use |
|---|---|
| `vi.fn()` | a fake function you can inspect |
| `vi.mock('path')` | replace a whole module |
| `vi.mocked(fn)` | get the typed mock version of an imported function |
| `.mockResolvedValue(x)` | async function returns `x` |
| `.mockResolvedValueOnce(x)` | returns `x` only the next time (chain several) |
| `.mockRejectedValue(err)` | async function throws |
| `vi.spyOn(obj, 'method')` | watch a real method (or replace it) |
| `vi.stubGlobal('fetch', fn)` | replace global `fetch` |
| `vi.useFakeTimers()` | control time (for backoff tests) |

---

# 6. Level 1 — Pure Functions (No Mocks at All)

Start here. These need nothing faked.

**`checkQuizReply()`**: the bad-reply gallery from Step 4.1 is already a test suite, it's just printed to a terminal instead of asserted.

```ts
import { checkQuizReply } from '../src/services/quiz.service'

const good = Array.from({ length: 5 }, () => ({
  question: 'Q?', options: ['a', 'b', 'c', 'd'], correctIndex: 1,
}))

it('accepts a valid quiz', () => {
  expect(checkQuizReply(JSON.stringify(good)).ok).toBe(true)
})

it('rejects JSON wrapped in fences', () => {
  const out = checkQuizReply('```json\n' + JSON.stringify(good) + '\n```')
  expect(out.ok).toBe(false)
  if (!out.ok) expect(out.reason).toContain('fences')
})

it('rejects correctIndex as a string', () => {
  const bad = good.map((q) => ({ ...q, correctIndex: '2' }))
  expect(checkQuizReply(JSON.stringify(bad)).ok).toBe(false)
})
```

**`shuffleQuiz()`**: it's random, so you can't assert the output order. Assert the **invariant** instead:

```ts
it('keeps the correct answer correct after shuffling', () => {
  const quiz = good.map((q, i) => ({ ...q, options: [`a${i}`, `b${i}`, `c${i}`, `d${i}`], correctIndex: 2 }))
  for (let run = 0; run < 100; run++) {
    const shuffled = shuffleQuiz(quiz)
    shuffled.forEach((q, i) => {
      expect(q.options[q.correctIndex]).toBe(`c${i}`)        // still points at the same TEXT
      expect([...q.options].sort()).toEqual([`a${i}`, `b${i}`, `c${i}`, `d${i}`])   // nothing lost
    })
  }
})
```

That's **property-style** testing: instead of "the output equals X", you check "this property always holds". It's the right tool for randomness.

**`buildChatPrompt()`**: don't snapshot the entire prompt (it changes whenever wording improves and the test becomes noise). Assert the things that matter:

```ts
it('puts the question last and includes history', () => {
  const p = buildChatPrompt('CTX', [{ role: 'user', content: 'hi' }], 'what is X?')
  expect(p).toContain('CTX')
  expect(p).toContain('user: hi')
  expect(p.trim().endsWith('New question: what is X?')).toBe(true)
})

it('only adds the citation instruction in multi-document mode', () => {
  expect(buildChatPrompt('c', [], 'q', false)).not.toContain('name the document')
  expect(buildChatPrompt('c', [], 'q', true)).toContain('name the document')
})
```

Other pure targets: `summarizeError()` (does it clip the 3072-number Drizzle message? does it walk the `cause` chain?), the `FRONTEND_ORIGINS` parsing (trailing slash, commas), and later `cosineSimilarity()` and the workflow step functions.

---

# 7. Level 2 — Services With the Boundary Mocked

Now test `generateQuiz()`'s behaviour: the retry logic, the status codes.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/services/llm.service')
vi.mock('../src/repositories/chunks.repository')

import { generateQuiz } from '../src/services/quiz.service'
import { generateAnswer } from '../src/services/llm.service'
import { sampleChunks } from '../src/repositories/chunks.repository'

const VALID = JSON.stringify(/* the good quiz from above */)

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(sampleChunks).mockResolvedValue(['chunk one', 'chunk two'])
})

it('returns a quiz when the first reply is valid', async () => {
  vi.mocked(generateAnswer).mockResolvedValue(VALID)
  const result = await generateQuiz({ documentId: 'doc-1' }, Date.now())
  expect(result.ok).toBe(true)
  expect(generateAnswer).toHaveBeenCalledTimes(1)
})

it('retries once when the first reply is invalid', async () => {
  vi.mocked(generateAnswer)
    .mockResolvedValueOnce('Sure! Here is your quiz')   // garbage
    .mockResolvedValueOnce(VALID)                       // then good
  const result = await generateQuiz({ documentId: 'doc-1' }, Date.now())
  expect(result.ok).toBe(true)
  expect(generateAnswer).toHaveBeenCalledTimes(2)
})

it('gives a clean 502 after two invalid replies, and stops', async () => {
  vi.mocked(generateAnswer).mockResolvedValue('nope')
  const result = await generateQuiz({ documentId: 'doc-1' }, Date.now())
  expect(result).toMatchObject({ ok: false, status: 502 })
  expect(generateAnswer).toHaveBeenCalledTimes(2)       // never a third
})

it('rejects "all" with 400 before doing any work', async () => {
  const result = await generateQuiz({ documentId: 'all' }, Date.now())
  expect(result).toMatchObject({ ok: false, status: 400 })
  expect(sampleChunks).not.toHaveBeenCalled()
})

it('returns 404 when the document has no chunks', async () => {
  vi.mocked(sampleChunks).mockResolvedValue([])
  expect(await generateQuiz({ documentId: 'x' }, Date.now())).toMatchObject({ ok: false, status: 404 })
})
```

Look at what these prove. Step 4.2's notes say the "both attempts fail" branch was **never hit in real testing** (17/17 valid). So the 502 path is code that has never run. A mock is the only practical way to execute it.

> **Mocks let you test the failures that reality refuses to produce on demand.**

The same pattern for `prepareChat()`: mock `getEmbedding`, `searchSimilar`, `getRecentMessages`, `insertMessage`, then assert:

* missing message → 400, and `getEmbedding` not called
* array `documentId` → 400
* no chunks → 404
* `documentId` omitted → `searchSimilar` called with `undefined` (all-documents mode)
* the user message is saved, with the right scope
* multi-document context is labelled `[Source: file.pdf]`

---

# 8. Level 3 — Routes With Supertest

`app.ts` builds the Express app **without** calling `listen()`. That was deliberate (the comment in the file says so): tests can import the app without opening a port.

```bash
npm install -D supertest @types/supertest
```

```ts
import request from 'supertest'
import { app } from '../src/app'

vi.mock('../src/services/quiz.service')

it('POST /quiz → 400 without a documentId', async () => {
  vi.mocked(generateQuiz).mockResolvedValue({ ok: false, status: 400, error: 'documentId (string) is required' })
  const res = await request(app).post('/quiz').send({})
  expect(res.status).toBe(400)
  expect(res.body.error).toMatch(/documentId/)
})

it('GET / → health', async () => {
  const res = await request(app).get('/')
  expect(res.body.status).toBe('ok')
})
```

Route tests check the HTTP layer: status codes, JSON bodies, headers, CORS, the 413 on an oversize upload, and that a thrown error becomes a `503 { error }` rather than a stack trace.

---

# 9. Testing Streaming

Two separate things to test.

**The Gemini stream parser (`streamAnswer`)**: this is where the real `\r\n` bug lived. Mock `fetch` to return a `ReadableStream` you control, and feed it awkward byte splits:

```ts
function fakeSse(pieces: string[]) {
  const enc = new TextEncoder()
  return new Response(new ReadableStream({
    start(c) { pieces.forEach((p) => c.enqueue(enc.encode(p))); c.close() },
  }))
}

const frame = (t: string) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\r\n\r\n`

it('handles \\r\\n line endings', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeSse([frame('Hello'), frame(' world')])))
  const out: string[] = []
  for await (const piece of streamAnswer('p')) out.push(piece)
  expect(out).toEqual(['Hello', ' world'])
})

it('handles an event split across two network reads', async () => {
  const whole = frame('Hello')
  const cut = whole.length - 3                          // split inside the trailing \r\n\r\n
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeSse([whole.slice(0, cut), whole.slice(cut)])))
  const out: string[] = []
  for await (const piece of streamAnswer('p')) out.push(piece)
  expect(out).toEqual(['Hello'])
})
```

That second test is the regression test for the bug that was actually fixed (normalising `\r\n` on the whole buffer, not per chunk). **A bug you fixed without a test is a bug you'll meet again.**

**The route's SSE output (`/chat-stream`)**: mock `streamAnswer` with a tiny async generator and assert the frames in order:

```ts
vi.mocked(streamAnswer).mockImplementation(async function* () { yield 'Hi'; yield ' there' })

const res = await request(app).get('/chat-stream').query({ message: 'hello', documentId: 'd1' })
expect(res.headers['content-type']).toContain('text/event-stream')
expect(res.text).toMatch(/^event: meta\n/)
expect(res.text).toContain('data: {"text":"Hi"}')
expect(res.text.trimEnd().endsWith('event: done\ndata: {}')).toBe(true)
```

And the failure cases the frontend depends on:

* `streamAnswer` throws midway → an `event: error` frame, status still 200
* saving the assistant reply fails → **still** `event: done`, no error frame

---

# 10. Fixtures: Recorded Replies

A middle path between "hand-written fake" and "real API":

```text
1. Call the real API once
2. Save the raw response to tests/fixtures/quiz-reply-01.json
3. Tests replay that file through the mock
```

You get realistic data (including quirks like `\r\n`) with zero cost per run and no flakiness. Re-record when the model or prompt changes.

Never put a real resume, key, or email into a fixture. Fixtures get committed.

---

# 11. What About the Database?

Repositories are thin wrappers around Drizzle. Options:

| Approach | Tradeoff |
|---|---|
| Mock the repository module | fast; tests the service, not the SQL |
| A real test Postgres with pgvector (Docker, or a separate Neon branch) | tests the actual SQL, including `<=>`; slower, needs setup |
| An in-memory Postgres emulator | fast, but pgvector support is the problem |

For this project: mock repositories in service tests. If you want one real-DB test, `searchSimilar` is the one worth it, because cosine distance and the `LEFT JOIN documents` / `IS NOT NULL` orphan filter are the non-trivial SQL.

**Never point tests at the live Neon database.** `step2` and `step3` already showed what a destructive script does to real data.

---

# 12. The Test Pyramid for an LLM App

```text
                  ▲
                 ╱ ╲        EVALS            real model, golden set, scores
                ╱   ╲       (few, slow, cost money, run on demand)
               ╱─────╲
              ╱       ╲     INTEGRATION      routes via supertest, boundary mocked
             ╱         ╲    (some)
            ╱───────────╲
           ╱             ╲  UNIT             pure functions + services with mocks
          ╱_______________╲ (many, milliseconds, every commit)
```

Optional extra layer: one or two **smoke tests** that hit the real Gemini API ("does a real call still return text?"). Run them manually or nightly, never on every commit. They catch things mocks can't: a model being retired, a response format changing.

---

# 13. What NOT to Do

* **Don't call the real LLM in unit tests.** Slow, costs quota, fails randomly (the 503 "high demand" day would have turned the whole suite red for no reason), needs a secret in CI.
* **Don't assert exact model wording.**
* **Don't mock the thing you're testing.** If you mock `checkQuizReply` inside a test of `generateQuiz`, you've tested nothing.
* **Don't snapshot whole prompts.** Every wording tweak breaks the test and you learn to ignore it.
* **Don't share state between tests.** `vi.resetAllMocks()` in `beforeEach`.
* **Don't chase 100% coverage.** Test decisions and failure paths; skip trivial getters.

---

# 14. What to Test First (If Time Is Short)

Ordered by value:

1. `checkQuizReply` (port the gallery: 11 cases, already written)
2. `shuffleQuiz` invariant
3. `generateQuiz` retry + 400/404/502
4. `streamAnswer` with `\r\n` and split events
5. `prepareChat` validation + scope
6. `/chat-stream` frame order and error frames
7. `chunkText` edge cases

A dozen tests here cover the code where a silent break would hurt most.

---

# 15. CI

A GitHub Actions workflow runs on every push:

```yaml
name: test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm test
```

No `GEMINI_API_KEY`, no `DATABASE_URL`. If the suite needs either, something isn't mocked.

One trap in this repo: `config.ts` does `import 'dotenv/config'` and services read `process.env.GEMINI_API_KEY` at module load. That's fine (it's just `undefined` in tests), as long as no test path reaches a real `fetch`. `db/client.ts` creating a `Pool` at import is also fine as long as nothing queries it, but mocking the repository modules avoids importing it at all.

`tsc --noEmit` in CI matters here specifically: the dev script uses `--transpile-only`, so type errors don't stop the server locally.

---

# PART B — OBSERVABILITY

---

# 16. What is Observability?

> **Being able to answer "what happened, and why?" from the outside, without adding new code and redeploying.**

Testing happens **before** deploy. Observability is for **after**, when a real user says "it gave me a weird answer yesterday" and you need to find out why.

The classic three pillars:

```text
LOGS      discrete events        "chat request failed: ECONNRESET"
METRICS   numbers over time      "p95 latency = 4.2s, error rate = 1.3%"
TRACES    one request's journey  "embed 210ms → search 45ms → generate 3100ms"
```

---

# 17. What DocMind Already Has

More than it might seem:

```text
pipelineLogger   [1/7] Request received … [7/7] Saving assistant reply
                 timing() per step, preview() of chunks and answers
summarizeError   first line + cause chain + first in-repo stack frame
frontend logger  [DocMind:useChat] …
```

In the terminal, a single request reads like a **trace**: named steps, in order, with durations. That's the right idea already.

What it's missing for production:

* It's **human-formatted** (chalk colours), not machine-readable.
* It goes to the **terminal only**. On Render that's the log stream; nothing is searchable later.
* No **request id**: two overlapping requests interleave their lines and you can't tell them apart.
* No **token counts**, so no cost.
* No **aggregation**: you can't ask "what was the slowest step this week?"

---

# 18. Why LLM Apps Need More Than Normal Apps

A normal API fails loudly: a 500, a stack trace.

An LLM app often fails **quietly**:

```text
status: 200
answer: confident, fluent, and wrong
```

No error anywhere. The only way to diagnose it afterwards is to have recorded:

* the exact prompt that was sent
* which chunks were retrieved, and their distances
* which model, with which settings
* the exact reply

Without those you can't tell a **retrieval** problem (wrong chunks) from a **generation** problem (right chunks, bad answer). They have completely different fixes.

---

# 19. Step 9.2 — Wrap Every LLM Call

One wrapper, one structured log line per call:

```ts
type LlmCallLog = {
  event: 'llm_call'
  requestId: string
  operation: 'chat' | 'quiz' | 'embed' | 'classify'
  model: string
  promptChars: number
  responseChars: number
  promptTokens?: number
  outputTokens?: number
  durationMs: number
  attempt: number
  ok: boolean
  error?: string
}

console.log(JSON.stringify(entry))   // JSON lines: one object per line
```

Where the token numbers come from: Gemini's response includes `usageMetadata` (`promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`). `generateAnswer()` currently throws that away and returns only the text. Returning `{ text, usage }` is the one change that unlocks cost tracking (see [advanced/03](../advanced/03-token-counting-cost/More_on_Tokens_Cost.md)).

Why **structured** (JSON) instead of a sentence? Because a tool can then filter and aggregate: "all `llm_call` where `durationMs > 5000`", "sum of `outputTokens` per day".

Keep `pipelineLogger` too. The repo rule is "logging is a feature, never lose it". The coloured output is for you at the terminal; the JSON line is for machines. They can coexist: pretty in dev, JSON in production.

---

# 20. The Metrics That Matter for LLM Apps

| Metric | Why |
|---|---|
| **Latency per step** (embed / search / generate) | find the slow part |
| **TTFT** (time to first token) | what the user *feels* with streaming |
| **Total generation time** | cost and timeouts |
| **Tokens in / out** | cost, context limits |
| **Error rate by type** (429, 503, timeout, invalid output) | reliability |
| **Retry rate** | `/quiz` second attempts = prompt or model drifting |
| **Validation failure rate** | Zod rejections over time |
| **Retrieval distances** | top-1 distance creeping up = retrieval getting worse |
| **"Not in the document" rate** | too high = retrieval misses; too low = maybe hallucinating |
| **Queue depth / job duration** | once BullMQ exists |

TTFT is the streaming-specific one. For `/chat-stream`: timestamp when the request arrives, timestamp at the first `res.write` of a text piece. The whole reason to stream is to make this number small even when total time is large.

Percentiles, not averages. "Average 2s" hides the 1 in 20 users waiting 15s. **p50** is typical; **p95/p99** is the bad experience.

---

# 21. Request IDs (Correlation)

Give every request an id and put it on every log line:

```ts
app.use((req, res, next) => {
  req.id = randomUUID()
  res.setHeader('X-Request-Id', req.id)
  next()
})
```

Now "the slow one at 14:32" is one grep away. If the frontend logs the `X-Request-Id` it received, a user's bug report can be matched to server logs exactly.

Passing the id through every function call by hand is tedious; Node's `AsyncLocalStorage` lets a logger read "the current request's id" without threading it through arguments.

---

# 22. Tracing

A trace is a tree of **spans**, each with a start, an end, and attributes:

```text
trace: GET /chat-stream                               3.52s
 ├─ span: embed question                              0.21s
 ├─ span: vector search (top 3)                       0.05s   {distances: [0.31, 0.38, 0.44]}
 ├─ span: load history                                0.03s   {messages: 6}
 ├─ span: llm generate (stream)                       3.10s   {model, tokens_in: 1840, tokens_out: 212, ttft: 0.42s}
 └─ span: save assistant reply                        0.04s
```

`pipelineLogger`'s `step()` + `timing()` is this, flattened into text.

**OpenTelemetry (OTel)** is the vendor-neutral standard for producing traces/metrics/logs. LLM-specific tools build on the same idea and add prompt/response capture, token cost, and evaluation.

---

# 23. LLM Observability Tools (Langfuse and Friends)

The roadmap's optional step is **Langfuse** (open source, has a free cloud tier). Others in the same space: LangSmith, Helicone, Arize Phoenix, Braintrust.

What they give you over plain logs:

* a UI to open one conversation and see every step, prompt, and reply
* token and cost totals per user / per feature / per day
* prompt versioning ("which version of the system prompt produced this?")
* attaching scores (thumbs up/down, or LLM-judge scores) to traces
* turning real production traces into eval datasets

The mental model is the same wrapper as §19, sending the record to a service instead of `console.log`.

Check the free tier's limits before wiring anything in, and remember the privacy point below: these tools store your prompts.

---

# 24. Privacy and Redaction

Logging prompts means logging **user documents**. DocMind's database already contains resume text from early test uploads.

Rules:

* Never log secrets. The Gemini key is in the **URL** (`?key=...`), so never log full request URLs or raw `fetch` errors that include them. (Gemini also accepts the key in an `x-goog-api-key` header, which keeps it out of URLs entirely.)
* Clip long values. `preview()` already does this: it shows a prefix, not the whole chunk.
* Decide deliberately whether full prompts are stored, where, and for how long.
* Before sending anything to a third-party tracing service, ask whether user content is allowed to leave your system.
* `.history/` leaked a secret once in this project. Log files are the same risk: gitignore them.

The deferred `logs/errors.log` idea (JSON lines, `key=` redaction, long values clipped) is exactly this section. It was put off on purpose until errors got complex.

---

# 25. Health Checks and Alerts

* **Liveness**: `GET /` returns `{ status: 'ok' }`. Exists today. It proves the process is up, nothing more.
* **Readiness** (deeper): can it reach Postgres? A `/health` that runs `SELECT 1`. Don't call Gemini from a health check: it costs quota and makes your health depend on someone else's.
* **Alerts**: decide what's worth being woken for. Error rate above X%, p95 above Y seconds, queue depth growing. On a hobby project, "look at the Render logs when something feels off" is an honest answer.

---

# 26. Feedback Is Observability Too

The cheapest quality signal: a 👍/👎 on each answer, stored with the message id.

```text
👎 + the prompt + the retrieved chunks → a concrete bad example
```

A pile of those is the start of an eval set ([advanced/04](../advanced/04-evaluation/More_on_Evaluation.md)). Not built in DocMind; worth knowing it's how real systems close the loop between production and prompt changes.

---

# 27. Interview-Level Summary

If asked **"How do you test an application that uses an LLM?"**:

> I split deterministic from non-deterministic. The LLM call is one function at the boundary; I mock it and test everything around it: input validation, prompt construction, output validation, retry logic, error handling. With a mock I can force the cases the real model rarely produces, like two invalid replies in a row, and assert I return a clean 502 after exactly two attempts. I never call a real model in unit tests.

If asked **"How do you test something random?"**:

> I test invariants instead of exact outputs. For my option shuffle, I assert that after shuffling, `options[correctIndex]` is still the same text and no option was lost, across many runs.

If asked **"How do you test streaming?"**:

> Two parts. The parser that reads the provider's stream gets fed a fake `ReadableStream` with awkward splits, including an event cut across two reads and `\r\n` line endings, which was a real bug I hit. The route gets a mocked async generator, and I assert the SSE frames come out in the right order, including the error frame when the generator throws.

If asked **"Testing vs evaluation?"**:

> Tests check that my code is correct: deterministic and pass/fail. Evaluation measures whether the model's answers are good: statistical, run against a golden set with a real model, giving a score. They're complementary.

If asked **"What do you monitor in an LLM app?"**:

> Latency per pipeline step and time to first token, tokens in and out for cost, error rates by type, retry and validation-failure rates, and retrieval distances. I also log the prompt, the retrieved chunks and the reply per request, because LLM failures are usually a fluent wrong answer with a 200 status, and that's the only way to tell a retrieval problem from a generation problem.

If asked **"Why structured logs?"**:

> So they can be filtered and aggregated by a machine. A JSON line with a request id, model, duration and token counts can answer "what's my p95?" or "what did this request do?". A sentence can't.

---

# 28. Things That Will Bite You

* A test that secretly reaches the real API (missing mock) → slow, flaky, and burns quota.
* `vi.mock` must be at the top level of the file; mocks leaking between tests without `resetAllMocks`.
* Snapshotting prompts.
* Pointing tests at the live database.
* `--transpile-only` hiding type errors until CI.
* The API key in a logged URL.
* Logging entire chunks or prompts into a file that gets committed.
* Averages hiding the slow requests.
* No request id → interleaved logs you can't untangle.

---

# 29. Final Mental Model

```text
                      YOUR CODE
   ┌───────────────────────────────────────────────┐
   │ validate → build prompt →  [ LLM ]  → parse → │
   │ validate → retry → transform → save → respond │
   └───────────────────────────────────────────────┘
        ▲                   ▲                  ▲
        │                   │                  │
   deterministic      the ONLY random     deterministic
   → unit tests       part → MOCK it      → unit tests


   BEFORE DEPLOY                       AFTER DEPLOY
   ─────────────                       ────────────
   tests   "is my code right?"         logs     "what happened?"
   evals   "are answers good?"         metrics  "how often / how slow?"
                                       traces   "where did the time go?"
                                       feedback "was it actually good?"
```

**Mock the boundary. Test everything else like ordinary code.**

**Random output → test the invariant, not the value.**

**Every fixed bug gets a regression test.**

**Tests answer "is the code correct"; evals answer "is the output good".**

**LLM failures are quiet: log the prompt, the chunks, the reply, the tokens, the timing.**

**Structured logs + a request id turn "it was weird yesterday" into a query.**
