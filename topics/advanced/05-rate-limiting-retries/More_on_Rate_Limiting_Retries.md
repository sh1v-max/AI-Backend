# Advanced 05 — Rate Limiting & Retries

**Roadmap: Phase 12** · **Revisits:** Phase 4 (the quiz's retry-once), Phase 6 (job retries) · **Status in DocMind:** one retry exists, and it's for a different failure than this topic is about. `generateQuiz()` retries once when the reply is **invalid** (bad shape). There is **no** retry for network or API failures anywhere, no timeout on any `fetch`, and no rate limiting on the public API.

A real incident to anchor this: on 2026-09-27 `/chat-stream` failed with `Gemini API error: 503` — "This model is currently experiencing high demand" — on every Flash model tried. Not a code bug. Exactly the situation this file is about.

Rate-limit numbers for any provider change; check current docs.

Code this file talks about: [llm.service.ts](../../../src/services/llm.service.ts), [embeddings.service.ts](../../../src/services/embeddings.service.ts), [errors.ts](../../../src/utils/errors.ts) (`withErrorHandling`), [quiz.service.ts](../../../src/services/quiz.service.ts), [ingestion.service.ts](../../../src/services/ingestion.service.ts), [config.ts](../../../src/config.ts)

---

# 1. Two Directions

"Rate limiting" means two different things, and both matter:

```text
            INBOUND                              OUTBOUND
   users ──────────► YOUR API ──────────► Gemini / Neon
        you limit them                they limit YOU

   protect your server and           survive their limits and
   your quota from callers           their bad days
```

* **Outbound** (most of this file): what to do when Gemini says "slow down" or "try later".
* **Inbound** (§17 onward): stopping one caller from using up everything.

---

# 2. Things Fail. Which Kind of Failure Is It?

Every network call can fail. The first question is always:

> **Is this failure temporary or permanent?**

```text
TRANSIENT   it might work if tried again     → retry
PERMANENT   it will fail the same way again  → don't retry, report it
```

| Signal | Meaning | Retry? |
|---|---|---|
| `429` Too Many Requests | you're over a rate limit | yes, **after waiting** |
| `500` Internal Server Error | their bug, maybe momentary | yes, a few times |
| `502` / `504` | gateway problem / timeout | yes |
| `503` Service Unavailable | overloaded (the 09-27 incident) | yes, with backoff |
| Timeout, `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND` | network blip | yes |
| `400` Bad Request | your request is malformed | **no** |
| `401` / `403` | bad or missing key | **no** |
| `404` | wrong model name / URL | **no** |
| `413` / context too long | input too big | **no** (make it smaller) |
| Safety block / empty candidate | the content was refused | **no** (same input, same result) |

Retrying a `400` is the classic mistake: it fails identically three times and you've wasted three calls and several seconds.

In DocMind, every Gemini failure becomes the same thing:

```ts
throw new Error(`Gemini API error: ${res.status} ${await res.text()}`)
```

The status is buried inside a string. `withErrorHandling` then shows "check your internet connection" for all of them, including a bad API key (a known wart noted in the project docs). To retry *selectively* you first need errors that carry their status (§12).

---

# 3. Simple Analogy

You phone a busy restaurant and get the engaged tone.

* **Redial instantly, forever**: you and everyone else doing the same keep the line jammed. Nobody gets through.
* **Wait a minute, try again; wait longer the next time**: the line clears.
* **Everyone waits exactly one minute**: you all redial at the same second. Jammed again.
* **Everyone waits a slightly different, random time**: calls spread out. People get through.
* **After five failed tries**: you stop and order elsewhere, instead of dialling all night.
* **The recorded message says "call back after 8pm"**: you call at 8pm, not before.

That's backoff, jitter, max attempts, and `Retry-After`.

---

# 4. Why Immediate Retry Makes It Worse

A server returns 503 because it's overloaded.

```text
1,000 clients fail
        ↓
1,000 clients retry immediately
        ↓
the server, already struggling, gets hit again at once
        ↓
it fails again → they all retry again → ...
```

That's a **retry storm**. Your retries become part of the outage. For a 429 it's worse: every retry counts against the limit you already exceeded, extending the lockout.

---

# 5. Exponential Backoff

Wait longer after each failure, doubling each time:

```text
attempt 1 fails → wait 1s
attempt 2 fails → wait 2s
attempt 3 fails → wait 4s
attempt 4 fails → wait 8s
attempt 5 fails → give up
```

```text
delay = min(maxDelay, baseDelay × 2^attempt)
```

Why doubling works: short glitches recover on the first quick retry, and long outages get progressively more breathing room. One rule handles both.

Always include:

* a **cap** on the delay (`maxDelay`), or it grows absurdly
* a **maximum number of attempts**
* a **total time budget**: if a user is waiting, they won't wait 30 seconds

---

# 6. Jitter

Pure exponential backoff still has every client retrying at the same moments (1s, 2s, 4s…): the **thundering herd**.

Add randomness:

```ts
// "full jitter": a random time between 0 and the exponential delay
const delay = Math.random() * Math.min(maxDelay, baseDelay * 2 ** attempt)
```

```text
without jitter:   ████        ████        ████          bursts
with jitter:      █ ██ █ █  ██ █ █ █ █  █ █ ██ █ █      spread out
```

It looks like a small detail. It's the difference between retries that help and retries that keep a service down.

---

# 7. `Retry-After`

Sometimes the server tells you how long to wait:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 20
```

(seconds, or an HTTP date). Gemini's 429 body can also include retry timing details.

> **If the server says when to come back, believe it over your own formula.**

Retrying earlier is guaranteed to fail and counts against you.

---

# 8. A Retry Helper

```ts
type RetryOptions = { attempts?: number; baseDelayMs?: number; maxDelayMs?: number }

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { attempts = 3, baseDelayMs = 500, maxDelayMs = 8000 } = opts

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const last = attempt >= attempts - 1
      if (last || !isRetryable(err)) throw err                 // permanent, or out of tries

      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
      const delay = retryAfterMs(err) ?? Math.random() * backoff   // server's hint wins; else full jitter
      await new Promise((r) => setTimeout(r, delay))
    }
  }
}

function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number }).status
  if (status !== undefined) return status === 429 || status >= 500
  return true        // no status = a network-level failure (timeout, reset)
}
```

Usage:

```ts
const embedding = await withRetry(() => getEmbedding(chunk))
```

It belongs in one place (a `utils/retry.ts`), wrapped around the three functions that touch Gemini. Not copy-pasted into each.

---

# 9. Where to Retry in DocMind (and Where Not To)

| Call | Retry? | Notes |
|---|---|---|
| `getEmbedding()` | **yes** | Pure function of its input. Safest call to retry. And the most valuable: upload makes one per chunk, so one blip currently fails the whole upload |
| `generateAnswer()` | yes | Idempotent from your side (no state changed until you save the reply). Costs a full call each time |
| `streamAnswer()` **before the first piece** | yes | Nothing has been sent to the browser yet; a 503 here can be retried invisibly |
| `streamAnswer()` **after pieces were sent** | **no** | The user has half an answer on screen. A retry would generate a *different* answer from the start. Send `event: error` (what the route does now) |
| DB reads | yes | e.g. the first query after Neon wakes from suspend can hit `ECONNRESET` |
| DB writes | careful | Only if idempotent (see §11) |

The streaming row is worth understanding: **a stream is retryable only until the first byte reaches the user.** After that the failure has to be shown, not hidden.

And the budget depends on who's waiting:

```text
online  (chat, a human is watching)   → 1–2 quick retries, a few seconds total, then fail clearly
offline (ingestion job)               → many retries, long backoff, minutes are fine
```

---

# 10. The Two Kinds of Retry in the Quiz

`generateQuiz()` already retries. It's worth being precise about what:

```text
VALIDATION RETRY (exists)    the call SUCCEEDED but the content is wrong (bad JSON / shape)
                             → call again immediately; no backoff needed, the service is healthy
                             → MAX_ATTEMPTS = 2

TRANSPORT RETRY (missing)    the call FAILED (429 / 503 / timeout)
                             → wait with backoff, then call again
```

They're different layers and they nest:

```text
for attempt in 1..2:                              ← validation retry
    raw = withRetry(() => generateAnswer(...))    ← transport retry inside
    if valid(raw): return
```

Watch the multiplication: 2 validation attempts × 3 transport attempts = up to **6 calls** for one request. Always work out the worst case when nesting retries.

---

# 11. Retries Need Idempotency

> **Only retry what is safe to repeat.**

A timeout doesn't tell you whether the operation happened:

```text
request sent → server did the work → response lost → client sees "timeout"
```

If you retry a non-idempotent write, it happens twice.

In DocMind:

* Reads and pure computations (embedding, generation): safe.
* `insertChunk` in a retried ingestion: duplicates, unless the job deletes the document's chunks first.
* `insertMessage`: a retry could save the user's message twice.

Full treatment in [topic 16](../../16-idempotency-multi-tenancy/More_on_Idempotency_Multi_Tenancy.md). The two topics are halves of one idea: idempotency is what makes retrying safe.

---

# 12. Typed Errors

To decide retry vs fail, and to show the user the right message, errors need structure:

```ts
export class LlmError extends Error {
  constructor(
    message: string,
    public status?: number,
    public retryAfterMs?: number,
  ) { super(message) }
}

// in llm.service.ts
if (!res.ok) {
  const retryAfter = Number(res.headers.get('retry-after'))
  throw new LlmError(
    `Gemini API error: ${res.status}`,
    res.status,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
  )
}
```

Then `withErrorHandling` can map causes to honest messages:

| Cause | User message | Status |
|---|---|---|
| 429 from Gemini | "The AI service is busy. Try again in a moment." | 503 (or 429) |
| 503 from Gemini | "The AI model is overloaded right now." | 503 |
| 401 / 403 from Gemini | "Server configuration problem." (and a loud server log) | 500 |
| network / DB unreachable | the current connection message | 503 |

Today all four produce "check your internet connection", which is wrong for three of them. The terminal has the truth (`summarizeError`); the user doesn't.

Careful when adding detail to errors: the Gemini key is in the request **URL**. Never put the URL in an error message or a log line.

---

# 13. Timeouts

`fetch` has no default timeout. If Gemini accepts the connection and then never answers, the request **hangs**: the user stares at "Thinking…", and a connection is held open.

```ts
const res = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) })
```

Every outbound call should have one. And a retry without a timeout is pointless: a call that hangs never fails, so it never retries.

Different calls deserve different timeouts:

```text
embedding         ~10s     (fast, small)
generation        ~30–60s  (a quiz takes 10–30s)
streaming         a timeout to FIRST token, and an idle timeout between pieces,
                  not a total cap (a long answer is legitimately long)
```

A timed-out call is the "did it happen?" case from §11. Fine for reads; careful with writes.

---

# 14. Cancelling Work Nobody Wants

Related to timeouts. If the user closes the tab mid-stream:

```text
browser disconnects → the server keeps reading from Gemini → tokens generated for nobody
```

`/chat-stream` doesn't currently listen for the disconnect. The fix is an `AbortController` tied to the request:

```ts
const controller = new AbortController()
req.on('close', () => controller.abort())
// pass controller.signal to the fetch inside streamAnswer()
```

Saves quota and frees the connection. Noted as an open item in the streaming notes too.

---

# 15. Circuit Breaker

Retries handle a *blip*. During a real *outage*, every request retrying is wasted time and added load: each user waits through the full backoff sequence just to fail anyway.

A circuit breaker remembers that the service is down:

```text
              failures exceed threshold
   ┌────────┐ ───────────────────────► ┌────────┐
   │ CLOSED │                          │  OPEN  │  fail IMMEDIATELY, don't even call
   │(normal)│ ◄─────────────────────── │        │
   └────────┘      trial succeeded     └────────┘
        ▲                                  │ after a cooldown
        │                                  ▼
        │        trial failed         ┌───────────┐
        └──────────────────────────── │ HALF-OPEN │  let ONE request through as a test
                                      └───────────┘
```

Analogy: an electrical breaker. It trips so a fault doesn't keep heating the wires; you flip it back and see if it holds.

Benefits:

* **fail fast**: users get "the AI service is down, try again shortly" in milliseconds, not after 15 seconds of retries
* the struggling service gets room to recover
* your own server doesn't pile up hung requests

On 09-27, with a breaker: after a handful of 503s, DocMind would have answered instantly with a clear message for the next minute instead of making each user wait and fail.

A minimal breaker is a counter, a timestamp, and a state variable. Libraries exist (`opossum` for Node). In memory it resets on restart and isn't shared across instances; that's acceptable for a small service.

---

# 16. Fallbacks and Graceful Degradation

When the primary fails for good, can you still do *something* useful?

| Fallback | Example |
|---|---|
| **Another model** | flash-lite overloaded → try another Flash model. (On 09-27 all of them were busy, so this isn't a guarantee.) A `GEMINI_MODEL` env var was suggested then, not built |
| **Another provider** | needs the abstraction in [advanced/07](../07-vendor-abstraction/More_on_Vendor_Abstraction.md) |
| **Cached answer** | same question on the same document |
| **Degraded mode** | generation is down but search works → show the retrieved passages with "the AI is unavailable, here are the relevant sections" |
| **Queue it** | "we'll process this when the service recovers" (offline work only) |
| **An honest error** | the minimum: a message that says what's wrong and what to do |

The degraded-mode idea fits DocMind well: `prepareChat` has already found the sources before generation is attempted, and the stream sends them in `meta` first. So even when generation fails, the UI already holds the relevant passages.

Not every model swap is free: embeddings from a different embedding model aren't comparable with the stored ones. Generation models can be swapped; the embedding model can't without re-embedding everything.

---

# 17. Staying Under the Limit (Client-Side Throttling)

Better than recovering from a 429 is not causing it.

**Ingestion is the risk in DocMind.** `ingestPdf()` loops over chunks, awaiting one embedding call each. Sequential, so it's naturally paced by network latency, but a 100-chunk PDF is still 100 requests in a short burst, and several uploads at once multiply it.

Tools:

* **Concurrency limit**: at most N calls in flight (a small pool, or `p-limit`). Sequential is N = 1.
* **Pacing**: a minimum gap between calls.
* **Token bucket** (§19) for your own outbound calls.
* **Batching**: Gemini's batch embedding endpoint takes many texts in one request. 100 chunks become a few requests. Fewer requests against the per-minute limit and faster uploads.
* **A queue with a limiter** (topic 09): BullMQ's `concurrency` and `limiter` turn ten simultaneous uploads into an orderly line.

Limits come in several units (requests per minute, **tokens** per minute, requests per day). Batching reduces requests but not tokens.

---

# 18. Inbound: Rate Limiting Your Own API

DocMind's API is public with no auth and no limit. One `while (true)` loop against `/chat` uses up the Gemini quota for everyone.

The quick version:

```ts
import rateLimit from 'express-rate-limit'

app.set('trust proxy', 1)                 // behind Render's proxy: read the real client IP

const chatLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,                              // 20 requests per minute per client
  standardHeaders: true,                  // sends RateLimit-* headers
  message: { error: 'Too many requests. Please slow down.' },
})

app.use('/chat', chatLimiter)
app.use('/chat-stream', chatLimiter)
```

Things to get right:

* **`trust proxy`.** Behind a proxy, every request appears to come from the proxy's IP. Without this, all users share one bucket. Set it to the number of proxies in front, not blindly `true` (which lets a client spoof its IP with a header).
* **Different limits per route.** Upload and quiz are expensive: a few per minute. Listing documents is cheap.
* **What's the key?** IP is the only option without auth, and it's weak (shared networks, easy to rotate). With auth, key by **user id** (topic 15).
* **Respond properly**: `429` with a `Retry-After` header. Be the kind of API you'd like Gemini to be.
* **SSE can't show a 429.** `EventSource` can't read a non-200 body, the same limitation that made stream errors in-band. A rate-limited stream request needs an `event: error` frame, or the frontend should check with a normal request first.
* **In-memory counters** reset on restart and aren't shared between instances. With more than one instance, the store must be shared (Redis).

---

# 19. Rate Limiting Algorithms

| Algorithm | How | Trait |
|---|---|---|
| **Fixed window** | count per calendar minute | simple; allows a double burst across the boundary (20 at 0:59 + 20 at 1:00) |
| **Sliding window** | count over the last 60 seconds, rolling | smooth; a bit more bookkeeping |
| **Token bucket** | a bucket refills at a steady rate; each request takes a token | allows short bursts up to the bucket size, then the steady rate. Most common |
| **Leaky bucket** | requests drain at a fixed rate | smooths output to a constant flow |

Token bucket in a sentence: "you can make 10 requests instantly, and after that one more every 3 seconds."

For LLM APIs, limiting by **tokens or cost** is more accurate than by request count, because one request can be 50 tokens or 50,000.

Other protective layers that aren't strictly rate limits:

* **Quotas**: N messages per user per day.
* **Concurrency caps**: one active generation per user at a time.
* **Input caps**: maximum message length, the 10 MB upload cap.
* **Load shedding**: when overloaded, reject new work quickly with a 503 instead of accepting it and timing out.

---

# 20. Retries at Different Layers

```text
frontend     retries a failed fetch? (should it?)
your API     retries the Gemini call
BullMQ       retries the failed job
Gemini SDK   (if you used one) retries internally
```

If every layer retries 3 times, one failure becomes 3 × 3 × 3 = 27 attempts. **Retry amplification.**

Rule: **retry at one layer**, usually the one closest to the failing call, and have the others fail fast. For DocMind: retry inside the service around the Gemini call; the frontend shows the error with a "try again" button (a human-initiated retry).

---

# 21. Observing All This

Log every retry, not only the final failure:

```text
[gemini] 503 on attempt 1/3, retrying in 840ms
[gemini] 503 on attempt 2/3, retrying in 1920ms
[gemini] succeeded on attempt 3/3 (total 4.1s)
```

Metrics worth having ([topic 12](../../12-testing-observability/More_on_Testing_Observability.md)):

* retry rate, and success-after-retry rate
* count of 429 vs 5xx vs timeouts
* circuit breaker state changes
* inbound 429s you served

A rising retry rate is an early warning: you're near a limit, or the provider is degrading. Silent retries hide that until it becomes an outage.

Keep it in the same style as `pipelineLogger`. Logging is a feature in this repo.

---

# 22. Testing Retry Logic

Deterministic and cheap with mocks and fake timers:

```ts
vi.useFakeTimers()

it('retries a 503 and then succeeds', async () => {
  const fn = vi.fn()
    .mockRejectedValueOnce(Object.assign(new Error('x'), { status: 503 }))
    .mockResolvedValueOnce('ok')

  const p = withRetry(fn)
  await vi.runAllTimersAsync()
  expect(await p).toBe('ok')
  expect(fn).toHaveBeenCalledTimes(2)
})

it('does not retry a 400', async () => {
  const fn = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { status: 400 }))
  await expect(withRetry(fn)).rejects.toThrow()
  expect(fn).toHaveBeenCalledTimes(1)
})
```

Also: gives up after max attempts; honours `Retry-After`; delays grow. Fake timers mean the test doesn't actually wait.

---

# 23. Interview-Level Summary

If asked **"How do you handle LLM API failures?"**:

> First classify: transient or permanent. 429s, 5xx and network timeouts are worth retrying; 4xx like a bad request or bad key aren't. For transient ones I retry with exponential backoff and jitter, honour `Retry-After` when the server sends it, cap the attempts, and put a timeout on every call. If it still fails, the user gets a clear, accurate message.

If asked **"Why exponential backoff? Why jitter?"**:

> Retrying immediately adds load to a service that's already overloaded, and with a rate limit it counts against you. Increasing delays give it time to recover. Jitter randomises the delay so that many clients that failed together don't all retry at the same instant.

If asked **"429 vs 503?"**:

> A 429 means I specifically am over a limit: wait, ideally for the time the server tells me, and then fix my own request rate. A 503 means the service is overloaded or down: back off, and if it persists, stop calling for a while.

If asked **"What's a circuit breaker?"**:

> A guard that tracks failures to a dependency. After too many, it opens and fails calls immediately instead of trying, then after a cooldown lets one trial request through to see if the service recovered. Retries handle short blips; the breaker handles sustained outages, so users fail fast and the dependency gets room to recover.

If asked **"When is it unsafe to retry?"**:

> When the operation isn't idempotent. A timeout doesn't tell you whether it happened, so retrying a write can duplicate it. And mid-stream: once part of an answer has reached the user, retrying would produce a different answer, so I report the error instead.

If asked **"Tell me about a real failure."**:

> My streaming endpoint failed with a 503 from the model provider, "experiencing high demand", on every model I tried. It wasn't my code. But it showed what was missing: no retry with backoff, no timeout, and my error handler mapped every failure to a "check your connection" message, which was wrong. The fixes are typed errors that carry the status, a retry wrapper for transient ones, and an honest message per cause.

If asked **"How would you rate-limit your API?"**:

> Per user once there's auth, per IP before that, with stricter limits on expensive routes like upload and generation. Token bucket is the usual algorithm since it allows short bursts. Respond with 429 and `Retry-After`, keep the counters in a shared store if there's more than one instance, and for LLM endpoints consider limiting by tokens or cost rather than request count.

---

# 24. Things to Remember

* Classify before retrying. Never retry a 4xx (except 429).
* Backoff + jitter + max attempts + a timeout. All four.
* `Retry-After` beats your formula.
* `fetch` never times out by itself.
* A stream is retryable only until the first byte is sent.
* Validation retry and transport retry are different things.
* Nested retries multiply.
* Retry only what's idempotent.
* Sustained failure → circuit breaker, not more retries.
* Behind a proxy, set `trust proxy` or everyone shares one rate limit.
* Tell the user the real reason.

---

# 25. Final Mental Model

```text
INBOUND                                   OUTBOUND
───────                                   ────────
request                                   call Gemini (with a TIMEOUT)
   │                                             │
   ▼                                        ┌────┴─────┐
rate limit (per user / IP)                  ok        fail
   │ over → 429 + Retry-After               │          │
   ▼                                        ▼          ▼
input caps (size, length)                 use it   transient?  (429 / 5xx / network)
   │                                                │        │
   ▼                                               yes       no (400/401/404…)
handler ──────────────────────────────►            │         │
                                                   ▼         ▼
                                          circuit open?    fail now,
                                            │       │      accurate message
                                           yes      no
                                            │       │
                                            ▼       ▼
                                      fail fast   wait: Retry-After
                                                  or backoff × jitter
                                                    │
                                              attempts left?
                                               │         │
                                              yes        no
                                               │         │
                                             retry    fallback → degraded → honest error
```

**Transient → retry with backoff and jitter. Permanent → fail fast.**

**Every call gets a timeout. Every retry loop gets a cap.**

**Retries are for blips; circuit breakers are for outages.**

**Don't cause the 429: pace, batch, queue.**

**Protect your own API the same way: limit, cap, and answer with 429 + `Retry-After`.**

**Whatever happens, tell the user what actually went wrong.**
