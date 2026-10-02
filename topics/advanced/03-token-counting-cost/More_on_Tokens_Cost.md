# Advanced 03 — Token Counting & Cost

**Roadmap: Phase 12** · **Revisits:** Phase 2 (RAG prompt size, conversation memory) · **Status in DocMind:** nothing is counted. Prompts are logged by **character** length (`Built prompt — N characters`), history is limited by **message count** (`HISTORY_LIMIT = 8`), and Gemini's token usage data is discarded. It works because the prompts are small and the tier is free.

Prices, context-window sizes, and rate limits change often and differ per model. This file teaches the mechanics; **look up current numbers** on the provider's pricing and models pages before quoting any.

Code this file talks about: [llm.service.ts](../../../src/services/llm.service.ts), [chat.service.ts](../../../src/services/chat.service.ts), [config.ts](../../../src/config.ts) (`HISTORY_LIMIT`), [chunkText.ts](../../../src/utils/chunkText.ts), [ingestion.service.ts](../../../src/services/ingestion.service.ts)

---

# 1. What is a Token?

Models don't read characters or words. They read **tokens**: pieces of text from a fixed vocabulary.

```text
"Hello world"            → ["Hello", " world"]                     2 tokens
"unbelievable"           → ["un", "believ", "able"]                3 tokens (roughly)
"RAG"                    → ["R", "AG"]  or  ["RAG"]                depends on the tokenizer
"https://example.com/a?b=1" → many small pieces                    lots of tokens
```

A token can be a whole word, part of a word, a space plus a word, a punctuation mark, or a single byte.

> **Tokens are the unit of everything: limits, speed, and price.**

---

# 2. Simple Analogy

A telegram office charges per **syllable**, not per word, and each telegram form has a maximum number of syllables.

* Short common words: one syllable, cheap.
* Long or unusual words: several syllables.
* The price list and the form size are both in syllables.

Counting your message in *words* gives an estimate. Only counting syllables with the office's own rulebook gives the real number. And a different office has a different rulebook.

---

# 3. Why Not Just Words or Characters?

The tokenizer (commonly **BPE**, byte-pair encoding, or a similar subword method) is built by finding the most frequent character sequences in training data and giving each one an id.

* Frequent sequences ("the", " and", "ing") become single tokens.
* Rare words are assembled from smaller pieces.
* Any text can be encoded, even a made-up word: worst case, byte by byte.

That gives a fixed-size vocabulary (tens to hundreds of thousands of tokens) that can still represent everything.

---

# 4. Rules of Thumb

For ordinary English:

```text
1 token  ≈ 4 characters
1 token  ≈ ¾ of a word
100 tokens ≈ 75 words
1 page of text ≈ 500–800 tokens
```

Where the rule breaks:

| Content | Tokens per word |
|---|---|
| plain English prose | ~1.3 |
| code | higher (symbols, indentation, identifiers) |
| JSON | much higher (quotes, braces, repeated keys) |
| numbers, ids, hashes, URLs | very high |
| non-English text | varies a lot; many scripts cost more per word than English |
| emoji | often several tokens each |

So: 500-word DocMind chunk ≈ 650–700 tokens **if** it's English prose. A chunk full of tables or code could be double that.

**Different models have different tokenizers.** The same text has a different token count on Gemini, GPT, and Claude models. Never reuse one vendor's count for another.

---

# 5. Counting for Real

**Before the call**: the `countTokens` endpoint.

```ts
const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:countTokens?key=${API_KEY}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  },
)
const { totalTokens } = await res.json()
```

Exact, but it's a network round trip, so use it for decisions that matter (is this about to overflow?), not on every chunk.

**After the call**: every `generateContent` response includes usage.

```json
"usageMetadata": {
  "promptTokenCount": 1843,
  "candidatesTokenCount": 212,
  "totalTokenCount": 2055
}
```

(There can also be fields for cached tokens and for the model's internal "thinking" tokens. Check the current response shape.)

`generateAnswer()` currently returns only `data.candidates[0].content.parts[0].text` and **throws this away**. Returning `{ text, usage }` instead is a small change that gives exact counts for free on every call. That's the first step of any cost tracking, and it's the same change observability needs (topic 12).

With streaming, usage arrives in the stream's chunks, with the final totals on the last one. `streamAnswer()` only extracts the text.

**Estimate locally**: `Math.ceil(text.length / 4)`. Free, instant, approximate. Fine for budgeting with a safety margin; wrong for billing.

---

# 6. The Context Window

Each model has a maximum number of tokens it can handle in one request: the **context window**.

```text
┌──────────────────── context window ────────────────────┐
│ system instruction │ history │ retrieved chunks │ question │ ← INPUT
│                                                  [ OUTPUT ] │
└────────────────────────────────────────────────────────┘
```

Things to know:

* There's a limit on input and a **separate, smaller** limit on output (`maxOutputTokens`).
* Go over the input limit → the API returns an error (a 400), it doesn't quietly truncate.
* Hit the output limit → generation just **stops mid-sentence**, with `finishReason: MAX_TOKENS`. For JSON output that means invalid JSON (topic 08).
* Context windows have grown enormously. Many current models accept hundreds of thousands of tokens or more.

Which leads to an important correction of a common belief:

> **Fitting in the window doesn't mean you should fill it.**

---

# 7. Why Bigger Context Isn't Free

Even when 500 pages *fit*:

**Cost.** You pay for every input token on every request. A 100,000-token document sent with each of 50 questions is 5 million input tokens.

**Latency.** More input takes longer to process, and time-to-first-token grows.

**Quality.** Models attend less reliably to material in the middle of a very long context ("lost in the middle"), and irrelevant text can distract from the relevant part. More context can produce a *worse* answer.

**Rate limits.** Limits are often expressed in tokens per minute. Huge prompts exhaust them in a few requests.

That's the standing argument for RAG even with huge context windows: retrieval sends the few hundred tokens that matter instead of everything.

---

# 8. How Cost Is Calculated

```text
cost = (input tokens  × input price per token)
     + (output tokens × output price per token)
```

Prices are quoted **per million tokens**.

Three structural facts (true across vendors, even as the numbers change):

1. **Output tokens cost several times more than input tokens.** Generating is more expensive than reading.
2. **Bigger models cost much more than small ones.** Often by an order of magnitude or more. `flash-lite`-class models are the cheap tier.
3. **Embeddings are far cheaper than generation.**

A worked example with **made-up round prices** (input $0.10 / 1M, output $0.40 / 1M), just to show the arithmetic:

```text
one DocMind chat request:
   input:  ~2,500 tokens  (rules + 3 chunks + 8 history messages + question)
   output: ~200 tokens

   input cost:  2,500 × 0.10 / 1,000,000 = $0.00025
   output cost:   200 × 0.40 / 1,000,000 = $0.00008
   total ≈ $0.00033 per message

10,000 messages a day ≈ $3.30 a day ≈ $100 a month
```

Two lessons from the shape of that:

* One request is a rounding error. Cost only matters **at volume**, so think in "per 1,000 requests" or "per user per month".
* Input dominates here (2,500 vs 200 tokens), even though output is pricier per token. In RAG, **the prompt is the bill.**

---

# 9. Where DocMind Spends Tokens

| Operation | Calls | Tokens |
|---|---|---|
| Upload | **1 embedding call per chunk**, sequential | whole document, once |
| Chat | 1 embedding (the question) + 1 generation | ~2–3k in, ~200 out |
| Quiz | 1 generation, up to 2 with the retry | 5 chunks (~3.5k) in, ~500–800 out |

Planned features add calls:

| Feature | Extra per message |
|---|---|
| Query rewriting (PI.1) | +1 small generation |
| LLM intent classifier (Step 7.1) | +1 small generation |
| Tool calling (Step 7.3) | +1 or more generations, with tool declarations resent each time |
| LLM-as-judge evaluation | +1 generation per graded answer |

Each is small. Together they can triple the calls per message. That's why vector routing (Step 7.2) is attractive: it reuses the embedding that already exists and adds zero calls.

---

# 10. Free Tier: "Cost" Means Quota

On a free tier you don't pay money, you hit **rate limits**:

```text
RPM   requests per minute
TPM   tokens per minute
RPD   requests per day
```

Exceed one and the API returns `429`. The limits differ per model and change; check the current rate-limits page.

So token thinking still matters at $0:

* TPM is a token budget. Big prompts use it up fast.
* Upload is the risk: a 100-chunk PDF is 100 embedding requests in a quick loop. That's how you meet RPM limits.
* A quiz retry doubles the cost of the request.

How to handle hitting a limit is [advanced/05](../05-rate-limiting-retries/More_on_Rate_Limiting_Retries.md).

Also note what free tiers can cost in privacy: some providers' free-tier terms allow using your prompts to improve their products. Worth reading before sending real users' documents.

---

# 11. The Interview Question: "The Document Is Too Big for the Context Window"

The answer has layers. For **question answering**:

> You don't put the document in the context at all. You chunk it, embed it, retrieve the few chunks relevant to the question, and send only those. That's RAG, and it's what my project does. The document's size stops mattering to the prompt.

For tasks that need the **whole** document (summarise it, extract every date):

**Map-reduce.**

```text
chunk 1 → summary 1 ┐
chunk 2 → summary 2 ├─► combine summaries → final summary
chunk 3 → summary 3 ┘
```

Parallelisable. Loses cross-chunk connections.

**Refine (iterative).**

```text
summary = summarise(chunk 1)
summary = refine(summary, chunk 2)
summary = refine(summary, chunk 3) ...
```

Keeps a running understanding. Sequential, slow, and early content can fade.

**Hierarchical.** Summaries of summaries, as a tree. For very large corpora.

**A long-context model.** If it fits and the cost is acceptable, just send it. Simple, but pay attention to §7.

DocMind's quiz does a cheap version of "whole document": `sampleChunks()` takes 5 evenly spaced chunks. It's coverage by sampling, not by reading everything. For a long PDF, most of it is never seen by the quiz.

---

# 12. Conversations That Outgrow the Window

History grows with every turn. Strategies:

**Sliding window (what DocMind does).** Keep the last N messages.

```ts
export const HISTORY_LIMIT = 8
```

Simple and predictable. The weakness: it counts **messages**, not tokens. Eight short messages are 100 tokens; eight long assistant answers could be several thousand. There's no upper bound on prompt size.

**Token-budgeted window.** Walk backwards from the newest message, adding until a token budget is reached.

```ts
function fitHistory(messages: Msg[], budget: number): Msg[] {
  const kept: Msg[] = []
  let used = 0
  for (const m of [...messages].reverse()) {          // newest first
    const cost = Math.ceil(m.content.length / 4)      // estimate
    if (used + cost > budget) break
    kept.unshift(m)
    used += cost
  }
  return kept
}
```

Bounded, and adapts to message length.

**Summarisation.** When history gets long, replace the oldest turns with an LLM-written summary, and keep the most recent turns verbatim.

```text
[summary of turns 1–20] + [turns 21–28 verbatim] + new question
```

Keeps the gist of a long conversation. Costs an extra call occasionally, and summaries lose detail.

**Retrieval over history.** Embed past messages and retrieve only the relevant ones. "Long-term memory". Heavier machinery.

Background in [topic 06](../../06-conversation-memory/NOTES.md).

---

# 13. Budgeting a Prompt

Decide the budget on purpose instead of letting it happen:

```text
model input limit                       (large)
your own budget per request             e.g. 6,000 tokens   ← a product decision: cost + latency
   − system instruction                    ~300
   − reserved for the answer               ~800   (maxOutputTokens)
   − the question                          ~50
   = left for chunks + history             ~4,850
        chunks:   3 × ~700                 ~2,100
        history:  whatever fits in         ~2,750
```

Rules:

* **Reserve output space first.** Otherwise the answer gets cut off.
* **Set `maxOutputTokens`.** It's a cost ceiling and stops runaway generations. DocMind sets none.
* **Decide what's dropped first** when over budget. Usually the oldest history, then the lowest-ranked chunk. Never the system instruction or the question.
* **Log the actual counts** so the budget is based on data.

The current log line is `Built prompt — ${prompt.length} characters`. Dividing by 4 gives a rough token figure; `usageMetadata` gives the real one.

---

# 14. Ways to Reduce Cost

Roughly in order of payoff:

**1. Use the smallest model that does the job.** The biggest lever by far. DocMind already uses a `flash-lite` model. A common pattern is **routing by difficulty**: a cheap model for easy tasks (classification, rewriting), a stronger one only where needed.

**2. Send less input.**

* fewer or smaller chunks; a relevance threshold so poor chunks aren't sent (PI.6)
* trim history by tokens
* skip retrieval for smalltalk (routing)
* tighten the system instruction

**3. Limit output.** `maxOutputTokens`, and "answer in 2–4 sentences". Output tokens are the expensive ones.

**4. Prompt caching (context caching).** Providers can cache a repeated prompt prefix and charge much less for it on later requests. It only helps when the **beginning** of the prompt is identical across requests, so put stable content first (system instruction, tool declarations, a fixed document) and variable content last. Some providers do this automatically, some need an explicit cache. There's a minimum size and a time-to-live.

**5. Application-level caching.**

* same question on the same document → return the saved answer
* same text → don't embed it again (key by content hash)
* cache keys must include the user/tenant (topic 16)

**6. Batch APIs.** For work nobody's waiting on, providers offer asynchronous batch endpoints at a discount (often around half price). A natural fit for background ingestion or nightly evaluation runs.

**7. Batch embedding requests.** `ingestPdf()` calls the embedding API once per chunk. Gemini has a batch embedding endpoint (`batchEmbedContents`) that takes many texts in one request: fewer round trips, fewer requests against RPM, faster uploads.

**8. Don't retry blindly.** Each retry is a full-price call. Cap them (the quiz caps at 2).

**9. Reduce embedding dimensions.** Storage, not API cost: `gemini-embedding-001` produces 3072 dimensions and supports requesting fewer (`outputDimensionality`). Smaller vectors mean a smaller table and faster search, at a small quality cost. Changing it means re-embedding everything.

---

# 15. Tokens and Latency

Two different speeds:

```text
TTFT              time to first token    depends on: input size, model, queueing
tokens / second   generation speed       depends on: model
total time ≈ TTFT + (output tokens ÷ tokens per second)
```

* **Output length drives total time.** A 1,000-token answer takes about five times as long as a 200-token one. Asking for shorter answers is a latency optimisation.
* **Input length drives TTFT**, more gently.
* **Streaming** doesn't change total time; it makes TTFT the wait the user feels instead of the total. That's why `/chat-stream` exists.

---

# 16. Protecting Yourself From Cost

Once an API is public (DocMind's is), cost becomes a security topic.

* **Per-user limits and quotas.** Needs auth (topic 15).
* **Cap input size.** A user can paste a 200,000-character "question". `prepareChat` checks that `message` is a non-empty string and nothing else. A length cap is one line.
* **Cap uploads.** `MAX_UPLOAD_BYTES` (10 MB) exists for memory; it's also a cost cap, since every chunk is an embedding call.
* **`maxOutputTokens`** on every call.
* **Cap loops**: retries, agent steps.
* **Budget alerts** in the provider's console, and a hard spending limit if the provider offers one.

The attack this prevents has a name: **denial of wallet**. Instead of taking the service down, someone makes it expensive.

---

# 17. Tracking Cost

To know what something costs, record it per call:

```ts
{ operation: 'chat', model, promptTokens, outputTokens, userId, durationMs }
```

Then cost is arithmetic on the logs:

```text
cost per request     = tokens × price
cost per user        = sum over their requests
cost per feature     = chat vs quiz vs upload
cost per document    = embedding tokens at ingestion
```

Keep the price table in config, with the model name and the date it was checked. Prices change, and `-latest` model aliases can point at a new model with a new price.

This is the same record observability wants (topic 12): one log line serves both.

---

# 18. Interview-Level Summary

If asked **"What's a token?"**:

> The unit a model reads and writes: a piece of text from the tokenizer's vocabulary, often a word or part of a word. In English it's roughly four characters or three-quarters of a word, but it varies with the content and the tokenizer differs per model. Limits and prices are both measured in tokens.

If asked **"How is cost calculated?"**:

> Input tokens times the input price plus output tokens times the output price, quoted per million. Output is several times more expensive than input, and larger models cost far more than small ones. In a RAG app the input usually dominates because of the retrieved context and history.

If asked **"What's a context window?"**:

> The maximum number of tokens a model can take in one request, covering the instructions, history, retrieved context and question, with a separate smaller cap on output. Exceeding the input limit is an error; hitting the output limit truncates the reply.

If asked **"How do you handle a document too big for the context window?"**:

> For question answering, I don't put it in the window: chunk, embed, retrieve the relevant few chunks. That's RAG. For tasks needing the whole document, map-reduce summarisation or an iterative refine, or a long-context model if it fits and the cost is acceptable. Even when it fits, filling the window costs more, is slower, and can reduce quality.

If asked **"And a conversation that gets too long?"**:

> A sliding window over recent messages, ideally budgeted by tokens rather than message count, and for long conversations summarising older turns while keeping recent ones verbatim. My project uses a fixed window of the last eight messages, which is simple but isn't token-bounded.

If asked **"How would you reduce cost?"**:

> Use the smallest model that works, send less input by retrieving fewer and more relevant chunks and trimming history, cap output length, cache repeated prefixes and repeated questions, batch embedding calls, and use batch APIs for offline work. And measure first: log tokens per call so I know where the spend actually is.

If asked **"How do you count tokens?"**:

> Exactly, from the usage metadata the API returns with each response, or with the count-tokens endpoint before sending. For quick budgeting, characters divided by four with a safety margin.

---

# 19. Things to Remember

* Tokens, not words. Tokenizers differ per model.
* Output tokens cost more; input usually dominates in RAG.
* Fits ≠ should. Long context costs money, time, and sometimes quality.
* Hitting the output cap truncates silently.
* `HISTORY_LIMIT` counts messages, so it doesn't bound tokens.
* `usageMetadata` is free information being thrown away.
* One embedding call per chunk is the slow, quota-hungry part of upload.
* Unbounded input is a cost vulnerability.
* Never quote prices or limits from memory.

---

# 20. Final Mental Model

```text
                        TEXT
                         │ tokenizer (model-specific)
                         ▼
                      TOKENS
        ┌────────────────┼─────────────────┐
        ▼                ▼                 ▼
     LIMITS            COST             SPEED
  context window   in × price_in     TTFT ← input size
  max output     + out × price_out   total ← output length
  TPM / RPM        (out ≫ in)
        │                │                 │
        └────────────────┼─────────────────┘
                         ▼
                 BUDGET THE PROMPT
   system │ history (token window / summary) │ top-k chunks │ question │ [reserved output]
                         │
                         ▼
              MEASURE (usageMetadata) → log per call
                         │
                         ▼
     REDUCE: smaller model · less input · shorter output · cache · batch
```

**Everything is priced and limited in tokens.**

**cost = input × price_in + output × price_out.**

**RAG exists so you send the relevant few hundred tokens, not the whole document.**

**Reserve output space; cap everything a user can make bigger.**

**You can't reduce what you don't measure: keep `usageMetadata`.**
