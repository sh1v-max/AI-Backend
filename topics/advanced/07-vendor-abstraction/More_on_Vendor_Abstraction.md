# Advanced 07 — Vendor Abstraction

**Roadmap: Phase 12** · **Revisits:** every phase that calls Gemini · **Status in DocMind:** hardcoded to Gemini, called with plain `fetch` (no SDK). But the code is already *partly* abstracted without having set out to be: every Gemini call lives in two small files, and the rest of the app calls three functions. This file is about what that buys, what it doesn't, and how to answer "how would you swap providers?"

Provider APIs change. The request/response shapes below describe the general form of each vendor's API to show how they differ; check current docs before writing an adapter.

Code this file talks about: [llm.service.ts](../../../src/services/llm.service.ts), [embeddings.service.ts](../../../src/services/embeddings.service.ts), [quiz.schema.ts](../../../src/schemas/quiz.schema.ts) (`quizResponseSchema`), [quiz.service.ts](../../../src/services/quiz.service.ts), [chat.service.ts](../../../src/services/chat.service.ts), [schema.ts](../../../src/db/schema.ts) (`vector(3072)`)

---

# 1. What is Vendor Abstraction?

> **Putting your own interface between your application and a provider's API, so the application doesn't know or care which provider is behind it.**

```text
WITHOUT                                   WITH

chat.service ──► Gemini API               chat.service ─┐
quiz.service ──► Gemini API               quiz.service ─┼─► YOUR interface ─► Gemini adapter ─► Gemini API
ingestion    ──► Gemini API               ingestion    ─┘                  └► OpenAI adapter ─► OpenAI API
```

Swapping providers then means writing one new adapter, not editing every file that talks to a model.

---

# 2. Simple Analogy

A wall socket.

Your lamp has a plug. It doesn't know whether the electricity comes from coal, solar, or a generator. The **socket** is the interface; the power station behind it can change and the lamp never notices.

Without the socket, the lamp would be wired directly into one specific power station. Changing supplier means rewiring every lamp in the house.

And a travel adapter is exactly what it sounds like: a small piece that makes one shape fit another. That's the **adapter pattern**.

---

# 3. You've Already Done This Once

The repository pattern (topic 03) is the same idea for the database:

```text
routes / services ──► repositories ──► Drizzle ──► Postgres
```

"Nothing outside `repositories/` touches SQL." If the database changed, only repository files would.

The LLM layer has the same shape today, informally:

```text
chat.service / quiz.service / ingestion.service
              │
              ▼
   generateAnswer(prompt, generationConfig?)     llm.service.ts
   streamAnswer(prompt)                          llm.service.ts
   getEmbedding(text)                            embeddings.service.ts
              │
              ▼
          Gemini REST
```

Nothing outside those two files knows a Gemini URL. That's a real boundary, and it happened as a side effect of keeping services small.

> **Vendor abstraction is the repository pattern, applied to the model.**

---

# 4. Why Would You Swap or Add a Provider?

Real reasons, roughly by how often they come up:

* **Reliability.** On 2026-09-27 Gemini returned 503 "high demand" on every Flash model. With one provider, that's an outage. With two, it's a fallback.
* **Cost.** Prices change; a cheaper model appears; one task is fine on a tiny model.
* **Quality.** A different model is better at your specific task.
* **Model retirement.** Models get deprecated on a schedule. The project already met this: the Gemini 2.5 models were closed to new users. A `-latest` alias can also move underneath you.
* **Different models for different jobs.** Cheap and fast for classification and query rewriting; stronger for answers; a specialised one for embeddings.
* **Rate limits.** Spread load across providers or keys.
* **Compliance.** A customer requires data to stay in a region, or to use a specific cloud.
* **Self-hosting.** Running an open model locally for privacy or cost.
* **Testing.** A fake provider for unit tests (topic 12).

The last one is the reason that applies to DocMind right now.

---

# 5. What Actually Differs Between Providers

More than the URL. This is the part interviewers probe.

### 5.1 Request shape

| | Gemini | OpenAI (chat-style) | Anthropic |
|---|---|---|---|
| Conversation | `contents: [{ role, parts: [{ text }] }]` | `messages: [{ role, content }]` | `messages: [{ role, content }]` |
| Assistant role name | `model` | `assistant` | `assistant` |
| System prompt | top-level `systemInstruction` | a message with a system/developer role | top-level `system` |
| Settings | nested `generationConfig` | top-level fields | top-level fields |
| Output cap | `maxOutputTokens` | a max-tokens field | `max_tokens` (**required**) |
| Model | in the **URL path** | in the body | in the body |
| Auth | `?key=` or `x-goog-api-key` header | `Authorization: Bearer` | `x-api-key` header |

DocMind's database stores the role as `'assistant'`. Gemini wants `'model'`. That one-word mapping is the smallest possible example of what an adapter is for.

### 5.2 Response shape

```text
Gemini      data.candidates[0].content.parts[0].text
OpenAI      data.choices[0].message.content
Anthropic   data.content[0].text
```

Usage fields have different names too (`promptTokenCount` / `candidatesTokenCount` vs `prompt_tokens` / `completion_tokens` vs `input_tokens` / `output_tokens`), and so do the "why did it stop" values (`STOP` / `MAX_TOKENS` vs `stop` / `length` vs `end_turn` / `max_tokens`).

### 5.3 Streaming

All three use SSE, with different events:

```text
Gemini      a different METHOD (streamGenerateContent?alt=sse); each event is a partial response object
OpenAI      a stream flag; "data: {delta}" events; ends with "data: [DONE]"
Anthropic   a stream flag; NAMED events (message_start, content_block_delta, message_stop, …)
```

`streamAnswer()` contains Gemini-specific knowledge in several places: the separate URL, the `\r\n` line endings (the real bug from Phase 3), and the path `candidates[0].content.parts[0].text`. Another provider needs a different parser. What stays the same is the **output**: an async generator yielding strings.

### 5.4 Structured output

```text
Gemini      generationConfig.responseMimeType + responseSchema (OpenAPI-style subset, UPPERCASE types)
OpenAI      a response-format option with a JSON Schema (strict mode has its own rules)
Anthropic   structured outputs / forcing a tool call whose input schema is your shape
```

`quizResponseSchema` in [quiz.schema.ts](../../../src/schemas/quiz.schema.ts) is written in Gemini's dialect. It wouldn't be accepted elsewhere as-is.

### 5.5 Tool calling

Same concept everywhere, different shapes: where declarations go, what a call looks like in the reply, how results are sent back, and whether ids link calls to results.

### 5.6 Embeddings

Different models, different dimensions, and sometimes a "task type" parameter (query vs document). The important part is §9.

### 5.7 Everything else

Error formats and codes, rate-limit headers, safety/moderation behaviour, context window sizes, tokenizers, supported file types, caching mechanisms, and pricing.

---

# 6. The Interface

Define what **your application** needs, in your own terms.

```ts
// src/llm/types.ts
export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export type GenerateOptions = {
  system?: string
  messages: ChatMessage[]
  temperature?: number
  maxOutputTokens?: number
  jsonSchema?: JsonSchema        // provider-neutral; each adapter translates it
}

export type Usage = { inputTokens: number; outputTokens: number }

export type GenerateResult = {
  text: string
  usage?: Usage
  finishReason: 'stop' | 'length' | 'blocked' | 'other'
}

export interface LlmProvider {
  generate(options: GenerateOptions): Promise<GenerateResult>
  stream(options: GenerateOptions): AsyncGenerator<string>
}

export interface EmbeddingProvider {
  readonly model: string
  readonly dimensions: number
  embed(text: string): Promise<number[]>
  embedBatch(texts: string[]): Promise<number[][]>
}
```

Design points:

* **Your vocabulary, not the vendor's.** `assistant`, not `model`. `system`, not `systemInstruction`. The adapter does the translating.
* **Normalise outputs.** One `finishReason` enum, one `Usage` shape.
* **Normalise errors** too: one error type carrying `status` and `retryable` (see [advanced/05](../05-rate-limiting-retries/More_on_Rate_Limiting_Retries.md)).
* **Two interfaces, not one.** Generation and embedding are separate concerns and often separate vendors.
* **Streaming stays an async generator of strings.** That's what `/chat-stream` consumes, and it's the most portable shape.

Compare with today's signature:

```ts
generateAnswer(prompt: string, generationConfig?: Record<string, unknown>): Promise<string>
```

`generationConfig` is a **leak**: it's Gemini's field name and Gemini's structure, and the caller (`quiz.service.ts`) builds a Gemini-shaped object to pass in. So the quiz service knows about Gemini. That's the specific thing a real interface would fix.

---

# 7. The Adapter

One per provider. It translates in both directions.

```ts
// src/llm/gemini.provider.ts
export class GeminiProvider implements LlmProvider {
  constructor(private apiKey: string, private model: string) {}

  async generate(o: GenerateOptions): Promise<GenerateResult> {
    const res = await fetch(`${BASE}/models/${this.model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({
        ...(o.system && { systemInstruction: { parts: [{ text: o.system }] } }),
        contents: o.messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',        // ← translation
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          temperature: o.temperature,
          maxOutputTokens: o.maxOutputTokens,
          ...(o.jsonSchema && {
            responseMimeType: 'application/json',
            responseSchema: toGeminiSchema(o.jsonSchema),         // ← translation
          }),
        },
      }),
    })
    if (!res.ok) throw new LlmError(`Gemini ${res.status}`, res.status)

    const data = await res.json()
    const candidate = data.candidates?.[0]
    return {
      text: candidate?.content?.parts?.[0]?.text ?? '',
      usage: data.usageMetadata && {
        inputTokens: data.usageMetadata.promptTokenCount,
        outputTokens: data.usageMetadata.candidatesTokenCount,
      },
      finishReason: mapFinishReason(candidate?.finishReason),     // ← translation
    }
  }

  async *stream(o: GenerateOptions): AsyncGenerator<string> { /* today's streamAnswer body */ }
}
```

Everything Gemini-specific is in this one file: URL, auth, role names, schema dialect, response paths, `\r\n` handling. This is essentially `llm.service.ts` with a stricter boundary.

Then one place picks the implementation:

```ts
// src/llm/index.ts
export const llm: LlmProvider =
  process.env.LLM_PROVIDER === 'openai'
    ? new OpenAiProvider(process.env.OPENAI_API_KEY!, process.env.LLM_MODEL!)
    : new GeminiProvider(process.env.GEMINI_API_KEY!, process.env.LLM_MODEL ?? 'gemini-flash-lite-latest')
```

Services import `llm` and never mention a vendor.

This is the **adapter pattern** (translate one interface to another) plus the **strategy pattern** (choose an implementation at runtime), and services depending on an interface rather than a concrete class is **dependency inversion**.

---

# 8. The Smallest Useful Step: a Model Env Var

Before any interface: the model name is a string literal inside two URLs.

```ts
const GENERATE_URL = '…/models/gemini-flash-lite-latest:generateContent'
const STREAM_URL   = '…/models/gemini-flash-lite-latest:streamGenerateContent'
```

Making it configurable was suggested on 09-27 and not built:

```ts
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-flash-lite-latest'
```

That gives the most common kind of "swap" (a different model from the same vendor) with no deploy, just an env change on Render. It's the 5-minute version of this whole topic, and it covers model retirement and "this model is overloaded, try another".

---

# 9. Embeddings Are the Hard Lock-In

This is the non-obvious part and the best thing to say in an interview.

Swapping a **generation** model: change the adapter, re-test prompts, done. Nothing stored depends on it.

Swapping an **embedding** model:

```text
stored chunk vectors   → made by model A
the query vector       → now made by model B
                          ↓
            different vector spaces: similarity is meaningless
```

Vectors from different models **can't be compared**, even if the dimensions happened to match. So changing the embedding model means:

1. re-embed **every chunk** of every document
2. usually change the column: `vector(3072)` is fixed to `gemini-embedding-001`'s size
3. rebuild any vector index
4. do it without downtime: write new vectors to a new column, backfill in the background (a job, topic 09), switch reads over, then drop the old column

And in DocMind there's an extra obstacle: only chunk text is stored, and the chunks are what gets embedded, so re-embedding is possible. But the original PDFs and full extracted text aren't kept, so re-**chunking** isn't ([advanced/02](../02-chunking-strategy/More_on_Chunking.md)).

What helps:

* store `embedding_model` (and dimension) per chunk, or per document, so you know what's what
* keep source text
* treat the embedding model as a **data migration** decision, not a config flag

The project already has a fossil of this: the roadmap text still says `text-embedding-004` / 768 dimensions, while the code uses `gemini-embedding-001` / 3072. That gap *is* an embedding migration.

> **Generation is swappable. Embeddings are a commitment.**

---

# 10. Prompts Don't Port Cleanly

An interface makes the *call* portable. It doesn't make the *behaviour* portable.

* A prompt tuned on one model may be too terse, too verbose, or ignored on another.
* Structured-output reliability differs. The "17/17 valid" result is a fact about `gemini-flash-lite-latest`, not about models in general.
* The answer-position bias (22/36/32/10%) would be different on another model. The shuffle-in-code fix is portable; the measurement isn't.
* Tokenizers differ, so the same prompt has a different token count and cost.
* Refusal and safety behaviour differ.

So a provider swap is:

```text
write the adapter           (hours)
+ re-run the eval set       (the real work)
+ adjust prompts
```

That's why evaluation ([advanced/04](../04-evaluation/More_on_Evaluation.md)) is what makes swapping *safe*. Without a golden set, "we switched models" means "we hope it still works".

Mature setups keep prompts per model, or at least record which model each prompt version was tested on.

---

# 11. Lowest Common Denominator vs Leaky Abstraction

The central design tension.

**Too thin** an interface (only what every provider supports):

* you can't use what makes a provider good: its caching, its thinking controls, its native structured output, its file handling
* you're paying for a capable model and using it like the weakest one

**Too thick** (expose everything):

* vendor concepts leak into the app (`generationConfig` today)
* the interface becomes a union of three APIs, and swapping is hard again

Practical middle:

```ts
generate({
  …common options…,
  providerOptions?: { gemini?: {...}; openai?: {...} }   // an explicit, labelled escape hatch
})
```

* a common core that covers 90% of calls
* a clearly marked place for vendor-specific options
* **capability flags** where behaviour genuinely differs (`supportsJsonSchema`, `supportsTools`)

An abstraction that hides a real difference isn't simpler, it's wrong. If one provider can't do schema-constrained output, the interface should say so, not pretend.

---

# 12. Build vs Buy

You don't have to write the interface yourself.

| Option | What it is | Tradeoff |
|---|---|---|
| **Your own thin interface** | what §6–7 describe | full control, you maintain adapters |
| **Vercel AI SDK** | TypeScript library with one API across many providers (generate, stream, structured output, tools) | a popular default in TS; a dependency to track |
| **LangChain.js** | large framework with model wrappers, retrievers, chains | broad; heavy abstraction |
| **OpenAI-compatible endpoints** | many providers and local servers accept OpenAI's request format | swap by changing a base URL; non-standard features don't map |
| **Gateways** (OpenRouter, LiteLLM, cloud AI gateways) | a proxy service: one API and key, many models behind it | adds fallback, logging, cost tracking; another hop and another party seeing your prompts |
| **Vendor SDKs** | each provider's official client | types, retries, streaming helpers; per-vendor |

Note what a **library is not**: adopting one moves your dependency from the provider to the library. You still want your own thin layer around it, so the rest of the app doesn't import it directly. Same boundary, different thing behind it.

### Why DocMind uses plain `fetch`

A deliberate learning choice, and a defensible one to explain:

* you saw the real HTTP requests and responses
* you parsed SSE by hand, which is how the `\r\n` bug got found and understood
* you learned that Gemini streaming is a different method, not a flag
* zero dependencies between you and the wire

What an SDK would have given: typed requests/responses, built-in retries and timeouts, streaming helpers. In production you'd likely use one. Having done it by hand first, you know what it's doing.

---

# 13. Fallback and Routing

With an interface, these become small:

**Fallback chain.**

```ts
async function generateWithFallback(options: GenerateOptions) {
  for (const provider of [primary, secondary]) {
    try { return await provider.generate(options) }
    catch (err) { if (!isRetryable(err)) throw err }     // a 400 is OUR bug; another provider won't fix it
  }
  throw new Error('All providers failed')
}
```

**Routing by task.**

```text
intent classification, query rewriting  → cheapest, fastest model
chat answers                            → mid-tier
evaluation judge                        → strongest
```

**Routing by load or cost.** Send traffic to whichever is cheaper or has headroom.

Caveats:

* fallback only applies to **generation**. The embedding model can't fall back (§9).
* a fallback model you never test will fail when you need it. Run the eval set on it.
* mid-stream fallback isn't possible once text has been sent ([advanced/05](../05-rate-limiting-retries/More_on_Rate_Limiting_Retries.md)).
* each provider needs its own key, limits, and monitoring.

---

# 14. Testing: The Benefit You Get Immediately

An interface means a fake implementation is trivial:

```ts
class FakeLlm implements LlmProvider {
  constructor(private replies: string[]) {}
  calls: GenerateOptions[] = []

  async generate(options: GenerateOptions) {
    this.calls.push(options)
    return { text: this.replies.shift() ?? '', finishReason: 'stop' as const }
  }
  async *stream() { for (const r of this.replies) yield r }
}
```

```ts
const llm = new FakeLlm(['not json', VALID_QUIZ])   // bad, then good → exercises the retry
```

No `vi.mock`, no module patching: pass the fake in. That's **dependency injection**.

`vi.mock('../services/llm.service')` achieves the same against today's code, because the functions are already isolated in one module (topic 12). So this benefit is available now; the interface makes it cleaner.

And it's the honest answer to "do you need this abstraction?": for swapping vendors, not yet. For testing, the boundary already pays.

---

# 15. When NOT to Abstract

The notes template says it: abstraction adds indirection, and it's only worth it if you expect to swap or support several.

Costs:

* more files and types to maintain
* every new provider feature has to be threaded through your interface
* a wrong abstraction is worse than none: it hides real differences and blocks features
* it can be built for a future that never comes (**YAGNI**)

A reasonable rule (the "rule of three"): one provider → keep calls in one module with clean function signatures. Two → extract an interface. Don't design the interface before you've seen two real implementations, or you'll just encode the first vendor's shape under generic names.

**Where DocMind is, and what's right-sized:**

```text
✓ all Gemini calls in two small files                    (done)
□ model name from an env var                             (5 minutes; worth doing)
□ generateAnswer takes neutral options, not generationConfig   (removes the one leak)
□ returns { text, usage } instead of a bare string       (also needed for cost + observability)
□ messages + system instead of one prompt string         (PI.2; also needed for tools)
✗ a multi-provider adapter layer                         (no second provider; don't)
```

The middle three aren't "abstraction work". They're changes other topics already need (PI.2, cost tracking, tool calling), and they happen to leave the code swap-ready. That's the best way to get an abstraction: as a by-product of real requirements.

Matches the repo's own rule: "no speculative folders".

---

# 16. What a Swap Would Actually Take in DocMind

A good interview answer is concrete. To move generation to another provider:

```text
1. llm.service.ts
     - new request shape (messages, system, role names)
     - new response path for the text
     - new streaming parser (different SSE events)
2. quiz.schema.ts
     - quizResponseSchema is in Gemini's dialect → translate, or generate from the Zod schema
3. quiz.service.ts
     - stops building a Gemini-shaped generationConfig
4. errors
     - different status codes / bodies → map to the same error type
5. config
     - new API key env var on Render; provider + model selection
6. prompts
     - re-run test questions; adjust wording
7. nothing changes in: routes, repositories, the frontend, the SSE protocol to the browser, Zod validation, shuffle
```

Item 7 is the payoff of the existing layering. The browser's SSE protocol (`meta` / text / `done` / `error`) is **DocMind's own**; it doesn't depend on how the provider streams.

To move **embeddings**: all of §9. That's a migration project.

---

# 17. Interview-Level Summary

If asked **"How would you swap LLM providers?"**:

> All my model calls go through two small modules exposing three functions: generate, stream, and embed. The rest of the app doesn't know it's Gemini. To swap generation, I'd rewrite that module as an adapter for the new provider: different request and response shapes, a different streaming parser, and a different structured-output schema format. Routes, repositories, validation and the frontend wouldn't change. Then I'd re-run my test questions, because prompts don't behave identically across models.

If asked **"What's the hard part?"**:

> Embeddings. Vectors from different models live in different spaces, so I can't compare a new query embedding with stored ones. Changing the embedding model means re-embedding every chunk, changing the vector column's dimension, and rebuilding the index, ideally with a dual-write migration. Generation is easy to swap; embeddings are a data migration.

If asked **"How do provider APIs differ?"**:

> The message format and role names, where the system prompt goes, how settings are passed, the response structure, the streaming event format, how structured output and tool calling are specified, plus error codes, limits and tokenizers. An adapter translates each of those to one internal shape.

If asked **"Why wrap the provider at all?"**:

> One place to change when a model is retired or a provider has an outage, the ability to route different tasks to different models, and testability: I can substitute a fake that returns scripted replies. It's the repository pattern applied to the model.

If asked **"What's the downside?"**:

> Indirection, and the lowest-common-denominator problem: a thin interface can't use provider-specific features, and a thick one leaks vendor concepts. It's only worth a full adapter layer when there are actually two providers. With one, I keep the calls isolated in one module with neutral signatures and don't build more.

If asked **"Why didn't you use an SDK?"**:

> Deliberately, to learn. Using `fetch` meant seeing the raw request and response, and parsing the SSE stream myself, which is how I found and understood a line-ending bug. In production I'd probably use an SDK or a multi-provider library for retries, typing and streaming helpers, still behind my own thin interface.

If asked **"Is there vendor leakage in your code today?"**:

> Yes, one clear spot. My generate function accepts a `generationConfig` object, which is Gemini's field name and schema format, so the quiz service builds a Gemini-shaped object. A neutral option like a JSON schema that the adapter translates would fix it. The model name is also hardcoded in the URL instead of coming from config.

---

# 18. Things to Remember

* Abstraction here = the repository pattern for the model.
* The call is portable; the behaviour isn't. Re-evaluate on every swap.
* Generation is swappable. Embeddings are a migration.
* `'assistant'` vs `'model'`: adapters translate vocabulary.
* `generationConfig` in a service is a leak.
* A model-name env var is the cheapest, most useful step.
* A fake provider for tests is the benefit you get today.
* Don't build a multi-provider layer for one provider.
* A library moves the dependency; it doesn't remove it.

---

# 19. Final Mental Model

```text
        routes  →  services (chat, quiz, ingestion)
                          │
                          │  speaks YOUR vocabulary:
                          │  generate({ system, messages, jsonSchema })
                          │  stream(...) → AsyncGenerator<string>
                          │  embed(text) → number[]
                          ▼
              ┌──────────────────────┐
              │   YOUR INTERFACE     │   normalised: text, usage, finishReason, errors
              └──────────────────────┘
                 │         │         │
                 ▼         ▼         ▼
             Gemini     OpenAI     Fake            ← adapters translate BOTH ways
             adapter    adapter   (tests)            roles · system prompt · schema dialect
                 │         │                         response path · stream events · errors
                 ▼         ▼
             Gemini     OpenAI


   GENERATION:  swap the adapter → re-run evals → adjust prompts
   EMBEDDINGS:  new model = new vector space → re-embed everything → new column + index
```

**Isolate the vendor behind your own small interface.**

**Adapters translate vocabulary, shapes, streams, and errors.**

**Swapping the call is easy; proving the behaviour needs an eval set.**

**Embeddings lock you in through your stored data.**

**Abstract when there's a second implementation, or a test, that needs it. Not before.**
