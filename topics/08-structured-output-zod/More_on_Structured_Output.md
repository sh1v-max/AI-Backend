# 08 — Structured Output (Zod)

**Roadmap: Phase 4** · **Status in DocMind: built** (Steps 4.1, 4.2, 4.2F, 4.3/4.3F)

Code this file talks about: [quiz.schema.ts](../../src/schemas/quiz.schema.ts), [quiz.service.ts](../../src/services/quiz.service.ts), [quiz.routes.ts](../../src/routes/quiz.routes.ts), [llm.service.ts](../../src/services/llm.service.ts), [step4-quiz-zod.ts](../../src/step4-quiz-zod.ts)

---

# 1. What is Structured Output?

Everything `/chat` returns is **prose**. A human reads it in a chat bubble.

```text
LLM → "RAG stands for Retrieval-Augmented Generation..." → human reads it
```

A quiz is different. Nobody reads the raw reply. **Code** reads it.

```text
LLM → [ {question, options[4], correctIndex}, ... x5 ] → React renders radio buttons
```

Structured output means:

> Getting the model to return data in an exact, machine-readable shape, and proving it is in that shape before any code uses it.

The second half of that sentence is the important one.

---

# 2. Simple Analogy

### Prose

You ask a friend for directions and they talk for a minute. You're a human, you figure it out.

### Structured output

You ask a courier company for a delivery, and they hand you a **form**:

```text
Name:      ________
Address:   ________
Pincode:   ______   (exactly 6 digits)
```

The warehouse machine reads that form. If the pincode has 5 digits, the machine jams.

So two things have to happen:

1. Give the person a form to fill (ask for a shape).
2. Have someone at the counter check the form before it goes to the machine (verify the shape).

The model is the person filling the form. Zod is the person at the counter.

---

# 3. Why Can't We Just Trust the Model?

An LLM does one thing: **predict the next token**, over and over.

```text
"[" → "{" → "\"question\"" → ":" → ...
```

Each step is a pick from a probability distribution. Valid JSON is the *most likely* continuation. It is not the *only possible* one.

So "likely" is what you get. "Guaranteed" is what your UI needs.

Ways a quiz reply goes wrong. The first ten rows are the ten bad samples in the bad-reply gallery in [step4-quiz-zod.ts](../../src/step4-quiz-zod.ts); the last one isn't in the gallery but is real (see §27):

| What comes back | What breaks |
|---|---|
| ` ```json [...] ``` ` (markdown fence) | `JSON.parse` throws on the backticks |
| `Sure! Here is your quiz: [...]` | `JSON.parse` throws on the `S` |
| 3 questions instead of 5 | UI expects 5 |
| a question with 3 options | radio group is wrong |
| `"correctIndex": "2"` (a string) | `options["2"]` works by accident in JS, strict comparison `=== 2` fails |
| `"correctIndex": 4` | `options[4]` is `undefined`, no answer is correct |
| `"correctIndex": 1.5` | not an index at all |
| a question missing its `question` | renders an empty card, or crashes far from the cause |
| two identical options | valid types, broken question |
| `{ "quiz": [...] }` (an object wrapping the array) | `.map` on an object |
| JSON cut off halfway | hit the output token limit |

None of these mean the model is broken. It means text generation isn't a contract.

---

# 4. The Core Idea: Two Separate Jobs

```text
        JOB 1: ASK                       JOB 2: VERIFY
  make the right shape LIKELY     make the wrong shape IMPOSSIBLE to use

   prompt wording                       JSON.parse
   structured-output mode       +       Zod safeParse
   (responseSchema)                     business rules (.refine)
```

Remember:

> **Asking is a request. Verifying is a guard.**

You can skip job 1 and still be safe (you'll just retry more). You can never skip job 2.

---

# 5. Job 1, Way A — Ask in the Prompt

The plain way. Describe the shape in words:

```ts
`Respond with ONLY a JSON array — no markdown, no explanation, no text before or after — where each item is:
{ "question": string, "options": [exactly 4 different strings], "correctIndex": number from 0 to 3 }`
```

That's `buildQuizPrompt()` in [quiz.service.ts](../../src/services/quiz.service.ts).

What makes prompt-asking work better:

* Say "ONLY JSON" and name the things you don't want (markdown, explanation).
* Show the shape literally, with field names spelled exactly.
* State counts as numbers ("exactly 4"), not vibes ("a few").
* Put the shape instructions **before** the long content, and keep the content last.
* One example of a good item (few-shot) helps weaker models a lot.

It works most of the time. With `gemini-flash-lite-latest` it was valid every single run in testing.

---

# 6. Job 1, Way B — Structured-Output Mode

The API itself can constrain the reply. In Gemini that's two fields inside `generationConfig`:

```ts
const generationConfig = {
  responseMimeType: 'application/json',
  responseSchema: quizResponseSchema,
}
```

And the schema ([quiz.schema.ts](../../src/schemas/quiz.schema.ts)):

```ts
export const quizResponseSchema = {
  type: 'ARRAY',
  minItems: 5,
  maxItems: 5,
  items: {
    type: 'OBJECT',
    properties: {
      question: { type: 'STRING' },
      options: { type: 'ARRAY', minItems: 4, maxItems: 4, items: { type: 'STRING' } },
      correctIndex: { type: 'INTEGER' },
    },
    required: ['question', 'options', 'correctIndex'],
  },
}
```

Things to notice:

* It's an **OpenAPI-style subset** of JSON Schema, not Zod.
* Types are **UPPERCASE** (`'STRING'`, `'OBJECT'`, `'ARRAY'`, `'INTEGER'`). Lowercase is a classic first mistake.
* It can express types and counts. It can't express "all options must be different" or "correctIndex must really be the right answer".
* Field names in this API have changed over time. Always check the current [structured output docs](https://ai.google.dev/gemini-api/docs/structured-output).

`generateAnswer(prompt, generationConfig?)` in [llm.service.ts](../../src/services/llm.service.ts) spreads it into the request body only when it's passed. That's why chat (no config) and quiz (with config) share one function.

---

# 7. How Does Structured Mode Actually Work?

This is worth understanding because interviewers like it.

Normal generation:

```text
model computes probabilities for ALL tokens
        ↓
sample one
```

Constrained generation (often called **constrained decoding** or grammar-guided decoding):

```text
model computes probabilities for ALL tokens
        ↓
tokens that would break the schema are masked out (probability → 0)
        ↓
sample one from what's left
```

So if the schema says the next thing must be a number, the token `"` simply can't be picked.

What this gives you:

```text
✓ syntactically valid JSON
✓ the right field names
✓ the right types
```

What it does **not** give you:

```text
✗ correct content (correctIndex might point at a wrong answer)
✗ rules the schema language can't express
✗ protection from truncation (output token limit hit → JSON cut off)
✗ protection from a safety block / empty candidate
```

That's why Zod still runs after it.

---

# 8. Three Levels of "JSON mode"

People mix these up. They're different strengths:

```text
Level 0   prompt only                 "please reply with JSON"
Level 1   JSON mode                   responseMimeType: application/json  (valid JSON, any shape)
Level 2   schema-constrained mode     + responseSchema                    (valid JSON, YOUR shape)
```

DocMind uses Level 2 in `generateQuiz()`.

Other vendors have the same idea with different names:

| Vendor | Name |
|---|---|
| Gemini | `responseMimeType` + `responseSchema` |
| OpenAI | `response_format: { type: 'json_schema', ... }` ("Structured Outputs") |
| Anthropic | structured outputs / forcing a tool call with an input schema |

The older trick on every vendor: define a "tool" whose arguments are your shape, force the model to call it, and read the arguments. Tool calling *is* structured output (see topic 10).

---

# 9. Job 2 — Zod

You already know Zod from request bodies. Here it's aimed the other way.

```text
Request validation:    untrusted USER   → Zod → your code
Output validation:     untrusted MODEL  → Zod → your code
```

> **The model is just another untrusted client.**

The DocMind schema:

```ts
export const QuizQuestion = z
  .object({
    question: z.string().min(1),
    options: z.array(z.string().min(1)).length(4),
    correctIndex: z.number().int().min(0).max(3),
  })
  .refine((q) => new Set(q.options).size === q.options.length, {
    message: 'options must all be different',
    path: ['options'],
  })

export const Quiz = z.array(QuizQuestion).length(5)
```

Line by line:

* `z.string().min(1)` rejects `""`. An empty question is a valid string and a useless question.
* `.length(4)` is *exactly* 4. Not `.min(4)`.
* `z.number().int().min(0).max(3)` rejects `"2"`, `1.5`, `-1`, `4`.
* `.refine()` is for rules that types can't express.

---

# 10. `parse` vs `safeParse`

```ts
Quiz.parse(data)       // returns typed data, or THROWS a ZodError
Quiz.safeParse(data)   // never throws: { success: true, data } | { success: false, error }
```

Rule of thumb:

```text
script / startup config      → parse      (crash loudly, it's a bug)
request handler / LLM reply  → safeParse  (you want to branch: retry or clean error)
```

`checkQuizReply()` uses `safeParse` because a bad reply isn't an exception, it's an expected outcome with a next step (retry).

---

# 11. `z.infer` — One Schema, Two Things

```ts
export type Quiz = z.infer<typeof Quiz>
```

Without this you'd write a TypeScript `interface Quiz` by hand **and** a runtime check by hand, and one day they'd disagree.

```text
        Zod schema
        /        \
runtime check    TypeScript type
(safeParse)      (z.infer)
```

They can't drift because the type is *derived* from the check.

TypeScript types disappear at runtime. That's the whole reason Zod exists: `as Quiz` is a promise to the compiler, `Quiz.safeParse()` is an actual check.

---

# 12. `.refine()` and Friends

Things a type can't say, that a rule can:

```ts
.refine((q) => new Set(q.options).size === q.options.length, { message: '...', path: ['options'] })
```

Useful relatives:

| Tool | Use |
|---|---|
| `.refine(fn)` | one custom yes/no rule |
| `.superRefine((val, ctx) => ...)` | several custom issues with their own paths |
| `.transform(fn)` | change the value after it validates (trim, map) |
| `z.coerce.number()` | turn `"2"` into `2` instead of rejecting |
| `z.enum(['a','b'])` | one of a fixed set (intent routing in topic 10 uses this) |
| `z.discriminatedUnion('type', [...])` | "one of these shapes, decided by a tag field" |
| `.optional()` / `.nullable()` / `.default(x)` | missing / null / fallback |
| `z.strictObject({...})` | reject unknown extra keys (plain `z.object` strips them silently) |

A choice worth thinking about: **coerce or reject?** DocMind rejects `"2"`. Coercing would "fix" it, but it also hides that the model is drifting. For a learning project, reject and log is more honest. For production, coercing harmless things is reasonable.

---

# 13. Reading a ZodError

When `safeParse` fails, `result.error.issues` is an array. Each issue has:

```ts
{ code: 'too_small', path: [3, 'options'], message: 'Too small: expected array to have >=4 items' }
```

* `path` tells you **where**: question index 3, field `options`.
* `message` tells you **what**.

`checkQuizReply()` turns the first three into one line:

```text
wrong shape — 3.options: ... | 0.correctIndex: ... (+2 more)
```

That line goes to the terminal. That log is how you improve the prompt later: if the same issue keeps showing up, the prompt is unclear about that field.

Zod 4 also has `z.prettifyError(error)` if you want a readable multi-line string.

---

# 14. The Two-Stage Check

Don't jump straight to Zod. There are two different failures:

```text
raw text
   ↓
JSON.parse ──fail──→ "not JSON" (fence? chatter? truncated?)
   ↓ ok
Quiz.safeParse ──fail──→ "JSON, but the wrong shape" (+ which field)
   ↓ ok
typed Quiz
```

Keeping them separate means the log says *which kind* of failure happened. "Not JSON at all" and "5th question has 3 options" need different fixes.

`checkQuizReply()` goes one step further on a `JSON.parse` failure: it tries stripping ` ``` ` fences just to *report* "valid JSON, but wrapped in fences". It deliberately doesn't accept the stripped version in DocMind (structured mode makes fences basically impossible), but in a prompt-only setup, stripping fences before parsing is a normal and fine thing to do.

---

# 15. Validate → Retry Once → Fail Cleanly

```text
call model → check
   ├─ ok      → shuffle → return
   └─ not ok  → call model again → check
                   ├─ ok      → shuffle → return
                   └─ not ok  → 502 "Could not generate a valid quiz right now"
```

In code: `MAX_ATTEMPTS = 2` and a `for` loop in `generateQuiz()`.

Why retry at all? Generation is random. The same prompt gives a different reply next time, so one more try often just works.

Why **only once**?

* A human is waiting on this request.
* Every attempt is a paid/quota'd API call.
* If it failed twice, it's probably the prompt or the document, and a third try won't fix that.
* An unbounded `while (!valid)` loop can hang a request forever and burn the free tier.

Why `502`? Your server is fine; the thing *upstream* of it (the model) gave a bad response. That's exactly what "Bad Gateway" means.

---

# 16. A Smarter Retry: Feed the Error Back

DocMind's retry sends the **same prompt** again. A stronger pattern:

```text
attempt 1 → invalid: "2.options: expected 4 items, got 3"
attempt 2 → same prompt + "Your previous reply was invalid: 2.options had 3 items. Return corrected JSON only."
```

This is sometimes called a **repair prompt** or self-correction. It costs more tokens but converges faster on weaker models. Libraries like Instructor do this automatically.

Not built in DocMind because the model was valid 17/17 times, so there was nothing to repair.

---

# 17. Valid ≠ Good (The Shuffle Story)

This is the best thing Step 4.1 found.

Every quiz was **valid**. Then the correct answer's position got tallied across 50 questions:

```text
position 0: 22%
position 1: 36%
position 2: 32%
position 3: 10%
```

A fair quiz would be 25/25/25/25. The model rarely puts the answer last. A student could learn "never pick D".

Zod can't catch this. Each individual quiz is perfectly valid. It's a property of **many** outputs, not one.

The fix: don't ask the model to be random. Models are bad at random. Do it in code.

```ts
function shuffleQuestion(q: QuizQuestion): QuizQuestion {
  const order = q.options.map((_, i) => i)          // order[newPosition] = originalIndex
  for (let i = order.length - 1; i > 0; i--) {      // Fisher–Yates
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return {
    ...q,
    options: order.map((originalIndex) => q.options[originalIndex]),
    correctIndex: order.indexOf(q.correctIndex),    // follow the correct answer to its new seat
  }
}
```

General lesson:

> **Anything that must be exact, random, counted, or computed belongs in code, not in the prompt.**

Same idea applies to: IDs, timestamps, totals, sorting, dedup.

---

# 18. What Zod Can Never Catch

```text
Shape problems      → Zod catches            (3 options, string index, missing field)
Rule problems       → .refine catches        (duplicate options)
Statistical bias    → only measuring catches (answer position)
Meaning problems    → nothing in code catches reliably
```

Meaning problems:

* `correctIndex` points at an option that's actually wrong.
* The question asks about something the PDF never says.
* Two options are both correct.

Partial defenses:

* The prompt says "based ONLY on the content below".
* A second LLM call can grade the quiz against the source ("LLM-as-judge", see [advanced/04](../advanced/04-evaluation/More_on_Evaluation.md)).
* A human spot-checks.

Be honest about this in an interview: validation guarantees shape, not truth.

---

# 19. Why the Quiz Doesn't Stream

```text
chat, half-arrived:   "RAG stands for Retr"          ← still useful, a human can read it
quiz, half-arrived:   [{"question":"What is","opt    ← useless, JSON.parse throws
```

You can't validate half an object, so you can't show it. `POST /quiz` waits for the whole reply, validates it, then responds once.

(There *are* streaming JSON parsers that emit partial objects, used for things like "show question 1 while question 2 generates". That's a real technique, just overkill here.)

---

# 20. Why the Quiz Doesn't Use `searchSimilar`

`searchSimilar()` answers: "which chunks are closest to **this question**?"

A quiz has no question. If you searched with some fake query, all 5 questions would come from one corner of the PDF.

So there's a different repository function:

```ts
sampleChunks(documentId, 5)   // 5 chunks, evenly spaced, in reading order
```

```text
chunks:   0 1 2 3 4 5 6 7 8 9
picked:   0   2   4   6   8
```

It works because `chunks.id` is a serial assigned in document order at upload, so `ORDER BY id` is page order.

Lesson: **retrieval strategy depends on the task.** "Relevant to a query" and "representative of the whole" are different problems.

---

# 21. The Full `/quiz` Flow

```text
POST /quiz { documentId }
        ↓
quiz.routes.ts (thin, wrapped in withErrorHandling)
        ↓
generateQuiz()
        ↓
validate documentId ── missing/not string → 400
                    ── 'all'              → 400
        ↓
[2/4] sampleChunks(documentId, 5) ── none → 404
        ↓
[3/4] buildQuizPrompt(chunks joined with ---)
        ↓
[4/4] generateAnswer(prompt, { responseMimeType, responseSchema })
        ↓
checkQuizReply(raw)
   ├─ ok → shuffleQuiz → 200 { documentId, quiz }
   └─ no → attempt 2 → ok? → 200 : 502
```

`generateQuiz()` never touches `req`/`res`. It returns `{ ok: false, status, error }` and the route sends it. Same pattern as `prepareChat()`, and the reason a worker could call it later.

---

# 22. Status Codes for LLM Endpoints

| Situation | Code | Why |
|---|---|---|
| bad input from the client | 400 | their fault |
| document doesn't exist | 404 | nothing to quiz |
| model replied twice with junk | 502 | upstream gave a bad response |
| Gemini / DB unreachable | 503 | service unavailable (`withErrorHandling`) |
| Gemini rate limit | 429 or 503 | see [advanced/05](../advanced/05-rate-limiting-retries/More_on_Rate_Limiting_Retries.md) |

Never 500 with a stack trace, and never 200 with garbage.

---

# 23. Grading: Why There's No `/quiz/check`

The roadmap suggested `POST /quiz/check`. It wasn't built, on purpose.

```text
client has:  the quiz, including correctIndex
server has:  nothing (quizzes aren't stored, no quizId)
```

A check endpoint would receive `{ picked, correctIndex }` from the client and compare two numbers the client sent. The client could lie about either. The server adds nothing.

So `QuizModal.tsx` grades itself.

When would a server check be real?

```text
POST /quiz → server stores the quiz, returns it WITHOUT correctIndex, plus a quizId
POST /quiz/:quizId/check { answers } → server compares against ITS stored copy
```

That needs a `quizzes` table. It's the right design if scores ever matter (leaderboards, grades). It's also exactly what the Phase 8 workflow work moves toward.

Lesson: **a server-side check is only worth something if the server holds something the client doesn't.**

---

# 24. Structured Output as a Control Signal

So far the JSON was *content* (a quiz). The same trick can produce a *decision*:

```ts
const Intent = z.object({
  intent: z.enum(['document_question', 'smalltalk', 'quiz_request']),
})
```

```text
user message → LLM (structured mode) → { intent: "smalltalk" } → code routes on it
```

That's Step 7.1. An agent is mostly this: structured output used to choose what happens next.

Other everyday uses of the same pattern:

* **Extraction** — pull `{ name, email, dates }` out of a resume.
* **Classification** — `{ sentiment: 'positive' | 'negative' }`.
* **Query rewriting** — `{ standaloneQuestion: string }` (PI.1 in [prompt-improvement.md](../../prompt-improvement.md)).
* **Grading** — `{ score: 1-5, reason: string }` (LLM-as-judge).

---

# 25. Schema Design Tips for LLMs

Things that make models fill a schema better:

* **Descriptive field names.** `correctIndex` beats `ci`.
* **Add `description` to fields** in the response schema. The model reads them.
* **Keep it flat.** Deep nesting raises error rates.
* **Use enums** instead of free strings wherever the set is known.
* **Reasoning before answer.** If you add a `reasoning` field, put it *before* the answer field. The model writes left to right, so reasoning first means the answer is conditioned on it. Reasoning after is just a rationalisation.
* **Indexes vs values.** `correctIndex: 2` is compact but easy to get off by one. `correctAnswer: "<the option text>"` is more robust and can be mapped to an index in code. DocMind uses an index and it has been fine, but it's a real tradeoff.
* **Don't ask for counts in two places** that can disagree (prompt says 5, schema says 4).

---

# 26. One Schema, Written Twice (a Known Wart)

DocMind has the quiz shape in two forms:

```text
Quiz (Zod)              → the guard
quizResponseSchema      → the request to Gemini
```

They're hand-kept in sync through the shared constants `QUIZ_LENGTH` and `OPTIONS_PER_QUESTION`. That's two sources of truth.

The cleaner way: generate one from the other. Zod 4 has `z.toJSONSchema(schema)` built in. The catch is Gemini's `responseSchema` wants its own uppercase OpenAPI subset and doesn't support every JSON Schema keyword, so the output usually needs a small conversion step (newer API versions also accept standard JSON Schema through a separate field, check the docs).

For a 3-field schema, writing it twice is fine. For 20 schemas, derive it.

---

# 27. Truncation: The Sneaky Failure

Even with schema-constrained mode, this can happen:

```text
[{"question":"What is RAG?","options":["A","B","C","D"],"correctIndex":1},{"question":"Wh
```

The model hit `maxOutputTokens` and stopped mid-object. The reply's `finishReason` will be `MAX_TOKENS` instead of `STOP`.

Defenses:

* Give enough output budget for the biggest valid answer.
* Check `finishReason` and treat anything other than `STOP` as a failure with its own log line.
* Ask for less per call (5 questions, not 50).

DocMind's `generateAnswer()` only reads `candidates[0].content.parts[0].text` today. A safety-blocked or empty candidate would throw a `TypeError` there (caught by `withErrorHandling`, shown as the generic connection message). Worth tightening later.

---

# 28. Temperature and Structured Output

Temperature controls randomness.

```text
0.0  → nearly deterministic, same quiz each time
1.0  → varied
```

For **shape reliability**, lower is safer. For a **quiz**, some variety is the point (Regenerate should give new questions). DocMind doesn't set it, so it uses the model default.

For extraction/classification (intent routing), set temperature low. You want the same input to give the same label.

---

# 29. Testing Structured Output Without the API

The bad-reply gallery in Step 4.1 is the template:

```text
11 hand-written replies (1 good, 10 wrong in realistic ways)
        ↓
checkQuizReply(reply)
        ↓
assert: 10 rejected with the right reason, 1 accepted
```

No API calls, runs instantly, never flaky. That's a unit test in everything but name, and it becomes real Vitest tests in Phase 9.

Things worth testing:

* each bad shape is rejected
* a good one is accepted
* `shuffleQuestion` keeps `options[correctIndex]` pointing at the same text
* `generateQuiz` with a mocked `generateAnswer` that returns bad-then-good → succeeds on attempt 2
* bad-then-bad → `{ ok: false, status: 502 }`

---

# 30. Real Numbers From This Project

Quote these, they're measured:

* Bad-reply gallery: **10/10** bad replies caught, each with a precise reason.
* Real runs: **17/17 valid** in both plain-prompt mode and structured mode.
* Correct-answer position across 50 questions: **22% / 36% / 32% / 10%**.
* Retries: 1 (2 attempts total), then `502`.
* A quiz takes roughly 10–30 seconds to generate.

The honest reading of 17/17: with this model, Zod was **insurance**, not something that visibly saved the day. Say that plainly. The gallery is what proves the check works.

---

# 31. Interview-Level Summary

If asked **"How do you get reliable JSON from an LLM?"**:

> Two separate jobs. First I ask for the shape, using the API's structured-output mode with a response schema so the model is constrained to it. Then I verify: `JSON.parse`, then a Zod `safeParse`. If it fails I retry once, and if it fails again I return a clean 502 instead of looping.

If asked **"If the API guarantees the schema, why validate?"**:

> The schema language only covers types and counts. It can't express rules like "all options are different", it doesn't protect against a truncated reply, and API behaviour changes. Validation is cheap, and it's the only thing between model output and my UI.

If asked **"`parse` or `safeParse`?"**:

> `safeParse` in a request path, because a bad reply is an expected outcome I want to branch on. `parse` in scripts or startup config, where throwing is fine.

If asked **"Why cap retries?"**:

> A person is waiting, each attempt costs quota, and two failures in a row usually means the prompt or the input is the problem, which another attempt won't fix.

If asked **"What can't validation catch?"**:

> Meaning. A quiz can be perfectly shaped and still mark the wrong answer correct. I also found the correct answer's position was biased, 22/36/32/10 percent across positions, so I shuffle options in code. Valid isn't the same as good.

If asked **"Why doesn't the quiz stream?"**:

> Half a JSON object can't be parsed or validated, so there's nothing safe to show until the whole thing has arrived.

---

# 32. Things That Actually Bit You

* `responseSchema` types must be uppercase.
* Fences around JSON break `JSON.parse` in plain-prompt mode.
* A valid quiz had a biased answer position, found only by counting across many runs.
* `//` comments in `package.json` broke `npm run step4` (`EJSONPARSE`).
* A DNS resolver refusing the Neon hostname looked like a code bug mid-step and wasn't.
* The CSS specificity bug in grading (selected highlight beating the incorrect color) was only visible in a screenshot.

---

# 33. Final Mental Model

```text
              NEED DATA, NOT PROSE
                      │
                      ↓
        ┌─────────────────────────────┐
        │  ASK                        │
        │  prompt: "ONLY JSON, shape" │
        │  + responseSchema           │
        └─────────────────────────────┘
                      │
                      ↓
                 raw string
                      │
                      ↓
        ┌─────────────────────────────┐
        │  VERIFY                     │
        │  JSON.parse                 │
        │  Zod safeParse (+ refine)   │
        └─────────────────────────────┘
              │                │
            valid           invalid
              │                │
              ↓                ↓
      fix in code what     retry once
      the model is bad at      │
      (shuffle)             still invalid
              │                │
              ↓                ↓
          200 + data       502 clean error
```

**Ask = make it likely. Verify = make it safe.**

**Structured mode constrains shape, never meaning.**

**`safeParse` in request paths, retry once, fail cleanly.**

**Valid ≠ good: measure across many outputs.**

**If it must be exact or random, do it in code.**
