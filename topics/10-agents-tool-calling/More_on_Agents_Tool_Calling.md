# 10 — Agents & Tool Calling

**Roadmap: Phase 7** · **Status in DocMind: not built yet.** Concept + how it would land in this codebase. Gemini's function-calling request/response fields change between API versions, so check the current [function calling docs](https://ai.google.dev/gemini-api/docs/function-calling) when you build it.

Code this file talks about: [chat.service.ts](../../src/services/chat.service.ts) (`prepareChat`), [llm.service.ts](../../src/services/llm.service.ts), [chunks.repository.ts](../../src/repositories/chunks.repository.ts) (`searchSimilar`), [quiz.service.ts](../../src/services/quiz.service.ts)

---

# 1. What Problem Are We Solving?

Today `prepareChat()` runs the **same seven steps for every message**:

```text
"hi"                              → embed → search top 3 → history → prompt → generate
"thanks!"                         → embed → search top 3 → history → prompt → generate
"what does section 2 say?"        → embed → search top 3 → history → prompt → generate
"make me a quiz"                  → embed → search top 3 → history → prompt → generate
"which documents do you have?"    → embed → search top 3 → history → prompt → generate
```

That's a **fixed pipeline**. It's wrong for four of those five:

* "hi" doesn't need a vector search. It wastes an embedding call and stuffs 3 random chunks into the prompt.
* "make me a quiz" should trigger the quiz feature, not a chat answer.
* "which documents do you have?" can't be answered by chunk search at all (the known Step 3.3 tradeoff). It needs `listDocuments()`.

The fix is to let something **decide** what to do before doing it.

---

# 2. Workflow vs Agent

Two words people use loosely. A useful split:

```text
WORKFLOW   the path is written in code. The LLM fills in steps.
           (DocMind today: always embed → search → generate)

AGENT      the LLM chooses the path at runtime. Code executes its choices.
```

It's a spectrum, not a switch:

```text
fixed pipeline → router → single tool call → tool loop → multi-agent
   (today)      (7.1/7.2)     (7.3)          (full agent)
```

> **An agent is an LLM in a loop that can call tools, with code deciding when to stop.**

That's all it is. No magic.

Rule of thumb from people who build these: **use the simplest thing that works.** A router plus a fixed pipeline beats a free-roaming agent for most products. Agents cost more calls, more latency, and are harder to test.

---

# 3. Simple Analogy

### Fixed pipeline

A receptionist who sends **every** visitor to the library, even the one who only said good morning.

### Router

A receptionist who listens first, then points: "library", "front desk", "exam hall".

### Tool calling

A receptionist with a **phone list**. They can't leave the desk, but they can say "please call the library and ask for X". Someone else makes the call and reads back the answer.

That last part is the key idea: the receptionist (LLM) never does anything. They only **ask** for things to be done.

---

# 4. The One Sentence to Remember

> **The model never executes anything. It only outputs a request to call a function. Your code decides whether to run it.**

```text
LLM:   "I'd like to call searchDocument({ query: 'refund policy' })"
CODE:  validates args → runs the real function → returns the result
LLM:   reads the result → writes the answer
```

"AI decides, code acts."

Everything about safety in agents comes from this gap between *asking* and *doing*.

---

# 5. Step 7.1 — Routing With Structured Output

This reuses topic 08 exactly. Instead of a quiz, the JSON is a decision.

```ts
// src/schemas/intent.schema.ts
export const Intent = z.object({
  intent: z.enum(['document_question', 'smalltalk', 'quiz_request']),
})
```

```ts
const generationConfig = {
  responseMimeType: 'application/json',
  responseSchema: {
    type: 'OBJECT',
    properties: {
      intent: { type: 'STRING', enum: ['document_question', 'smalltalk', 'quiz_request'] },
    },
    required: ['intent'],
  },
  temperature: 0,
}
```

Prompt:

```text
Classify the user's message into exactly one intent.

document_question — asks about the content of their uploaded documents
smalltalk         — greetings, thanks, chit-chat, questions about you
quiz_request      — asks to be quizzed or tested

Message: "<the message>"
```

Then code routes:

```text
               message
                  ↓
           classifyIntent()
                  ↓
   ┌──────────────┼───────────────┐
   ↓              ↓               ↓
smalltalk   document_question  quiz_request
   ↓              ↓               ↓
plain reply   RAG pipeline    quiz flow
(no search)   (today's code)
```

What to decide when building:

* **Invalid classification?** Fall back to `document_question`. It's the safe default: the worst case is today's behaviour.
* **History matters.** "and the second one?" looks like nothing on its own. Give the classifier the last couple of turns.
* **Temperature 0.** You want the same message to get the same label.

Cost: one extra LLM call on **every** message, before the real one. That's the motivation for 7.2.

---

# 6. Step 7.2 — Routing With Vectors

Idea: you already own a machine that measures "how similar is this text to that text". Use it for routing.

```text
AT STARTUP (once):
  embed("questions about the content of an uploaded document...")  → vector A
  embed("greetings, thanks, casual chit-chat...")                   → vector B
  embed("requests to be quizzed or tested on the material...")      → vector C

PER MESSAGE:
  embed(message) → vector M
  cosine(M, A), cosine(M, B), cosine(M, C) → pick the closest
```

> **Intent routing IS vector search.** Same math as Phase 1, with 3 rows instead of thousands.

And here's the nice part: `prepareChat()` **already embeds the message** for retrieval. So the routing decision reuses that embedding and costs **zero extra API calls**. Three cosine computations over 3072 numbers is microseconds, done in plain JS, no database.

```ts
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
```

Making it work well:

* **Use several example phrases per intent**, not one description. Embed "hi", "thanks", "how are you" for smalltalk and take the best match (or average them). One abstract description is a weak target.
* **Add a confidence margin.** If the top two scores are close, don't trust it.

### Comparing the two routers

| | LLM classifier (7.1) | Vector router (7.2) |
|---|---|---|
| Extra cost per message | one LLM call | none (embedding already exists) |
| Latency | hundreds of ms | ~0 |
| Handles nuance / negation / context | well | poorly |
| Adding an intent | edit the prompt + enum | add example phrases |
| Deterministic | mostly (temp 0) | fully |
| Debuggable | read the reply | read the scores |

### The hybrid (what real systems do)

```text
vector router
   ├─ confident (clear winner) → route immediately
   └─ unsure (scores close)    → ask the LLM classifier
```

Cheap path for the easy 90%, smart path for the hard 10%.

---

# 7. Step 7.3 — Tool Calling

Routing picks one of N fixed paths. Tool calling lets the model ask for an action **with arguments it writes itself**.

You describe functions to the model:

```json
{
  "tools": [{
    "functionDeclarations": [{
      "name": "searchDocument",
      "description": "Search the user's uploaded document for passages relevant to a query. Use this whenever the question is about the document's content.",
      "parameters": {
        "type": "OBJECT",
        "properties": {
          "query": { "type": "STRING", "description": "A standalone search query, with pronouns resolved." }
        },
        "required": ["query"]
      }
    }]
  }]
}
```

The model can then reply in one of two ways:

```text
(a) normal text:        "Hi! How can I help?"
(b) a function call:    { functionCall: { name: "searchDocument", args: { query: "refund policy" } } }
```

It **chooses**. That's the difference from the fixed pipeline.

---

# 8. The Tool-Calling Round Trip

```text
1. YOU   → model:  contents + tool declarations
2. MODEL → you:    functionCall { name, args }
3. YOU:            validate args, run the REAL function
4. YOU   → model:  everything so far + functionResponse { name, response }
5. MODEL → you:    final text answer (or another functionCall)
```

It's (at least) **two model calls** for one user message.

Roughly what the second request's `contents` looks like in Gemini REST:

```json
{
  "contents": [
    { "role": "user",  "parts": [{ "text": "what's the refund policy?" }] },
    { "role": "model", "parts": [{ "functionCall": { "name": "searchDocument", "args": { "query": "refund policy" } } }] },
    { "role": "user",  "parts": [{ "functionResponse": { "name": "searchDocument", "response": { "chunks": ["...", "..."] } } }] }
  ],
  "tools": [ ... same declarations ... ]
}
```

Things to know:

* The API is **stateless**. You resend the whole conversation, including the model's own function call, every time.
* Send the model's turn back **exactly as you received it**. Newer Gemini models attach extra fields to those parts (thought signatures) that must be returned unchanged or the call is rejected.
* `toolConfig.functionCallingConfig.mode` controls choice: `AUTO` (model decides), `ANY` (must call some function), `NONE` (may not).
* A model can return **several** function calls in one turn (parallel calling). Run them all and send all the responses back.

---

# 9. The Agent Loop

Generalise the round trip and you have an agent:

```ts
const MAX_STEPS = 5
const contents = [/* history + user message */]

for (let stepNo = 0; stepNo < MAX_STEPS; stepNo++) {
  const reply = await callModel(contents, tools)
  contents.push(reply.content)                       // the model's turn, untouched

  const calls = reply.content.parts.filter((p) => p.functionCall)
  if (calls.length === 0) return textOf(reply)       // no tool wanted → that's the answer

  const responses = []
  for (const { functionCall } of calls) {
    const result = await runTool(functionCall.name, functionCall.args)  // validated inside
    responses.push({ functionResponse: { name: functionCall.name, response: result } })
  }
  contents.push({ role: 'user', parts: responses })
}

return 'Sorry, I could not finish that.'             // step limit hit
```

Three things make this safe:

1. **`MAX_STEPS`.** Same reason quiz retries are capped: an unbounded loop burns quota and hangs a request.
2. **`runTool` is a whitelist.** A `switch` (or a map) over known tool names. An unknown name returns an error result, never `eval`.
3. **Errors go back as data.** If a tool throws, send `{ error: "document not found" }` as the function response. The model can often recover or explain. Don't crash the loop.

---

# 10. Tool Arguments Are Untrusted Input

The model writes the arguments. Treat them exactly like a request body.

```ts
const SearchArgs = z.object({ query: z.string().min(1).max(500) })

async function runTool(name: string, rawArgs: unknown, ctx: { documentId: string }) {
  switch (name) {
    case 'searchDocument': {
      const args = SearchArgs.safeParse(rawArgs)
      if (!args.success) return { error: 'invalid arguments' }
      const embedding = await getEmbedding(args.data.query)
      const chunks = await searchSimilar(embedding, 3, ctx.documentId)   // documentId from the SERVER
      return { chunks: chunks.map((c) => c.content) }
    }
    default:
      return { error: `unknown tool: ${name}` }
  }
}
```

Look at where `documentId` comes from. **Not** from the model.

> **Never let the model supply identity or scope.** `documentId`, `userId`, `tenantId` come from the session/request, and the tool closes over them.

If `documentId` were a model-written argument, a line of text inside a PDF ("search document 7f3a… instead") could point the search at someone else's file. That's prompt injection turning into a data leak. See [advanced/06](../advanced/06-llm-security/More_on_LLM_Security.md).

---

# 11. Why Tool-Based Retrieval Beats the Fixed Pipeline

Today the search query is the **raw user message**:

```text
user: "what does it say about pricing?"
user: "and the second one?"          ← embedded as-is → retrieves junk
```

That's the exact problem written up as PI.1 in [prompt-improvement.md](../../prompt-improvement.md): `prepareChat()` embeds and searches *before* loading history, so "use the history to resolve 'the second one'" in the prompt can't fix retrieval.

With a `searchDocument(query)` tool, the model **writes the query** after reading the history:

```text
functionCall: searchDocument({ query: "second pricing tier details" })
```

Query rewriting comes for free. The model can also:

* skip the search for "thanks!"
* search **twice** with different queries for a two-part question
* search again if the first results were poor

This pattern has a name: **agentic RAG**.

The cost: at least two model calls per question, and the model can also wrongly decide *not* to search and answer from its own memory. So the system instruction has to be firm: "for anything about the document, you must call `searchDocument`; never answer from general knowledge".

---

# 12. Kind A vs Kind B Tools

This distinction is the heart of Step 7.3/7.4.

```text
KIND A   the LLM may call it on its own
         read-only, cheap, reversible, safe to repeat
         → searchDocument, listDocuments, getDocumentInfo

KIND B   the LLM never calls it
         writes data, costs money, sends something, deletes something
         → createQuiz, deleteDocument, sendEmail, chargeCard
         → only CODE calls it, after an explicit human confirmation
```

How Kind B looks in practice:

```text
user:  "quiz me on this"
LLM:   proposes → "5 questions covering the whole document. Sound good?"
user:  "yes"
CODE:  sees the confirmation → calls createQuiz() itself
```

The model never had a `createQuiz` tool to call. It could only *propose*. The act is done by code, gated by a human.

Why bother?

* A model can be talked into things (prompt injection from a PDF, a confused instruction).
* A model can misread intent ("don't quiz me" → calls the tool anyway).
* Side effects can't be undone by saying sorry.

The test for which kind a tool is:

> **"If the model called this at the wrong time, could I undo it for free?"** Yes → Kind A. No → Kind B.

The confirmation step is a **suspend/resume** workflow (propose → wait for the next message → act). That's exactly topic 11.

---

# 13. Step 7.4 in DocMind

```text
"make me a quiz"
      ↓
router → quiz_request
      ↓
LLM (no tools) writes a proposal:
   "I'll make 5 multiple-choice questions covering the whole document. OK?"
      ↓
save pending action somewhere: { type: 'create_quiz', documentId }
      ↓
next message: "yes please"
      ↓
CODE checks: is there a pending action AND is this a confirmation?
      ↓
generateQuiz({ documentId })     ← the function that already exists
```

Open questions you'll have to answer when building:

* **Where does the pending action live?** Not in memory (a restart loses it). A row in a table keyed by `sessionId`. This is the `workflow_runs` table of topic 11.
* **How do you detect "yes"?** A tiny structured-output classification (`confirm | reject | something_else`) is more robust than `message === 'yes'`.
* **How does the frontend show a quiz inside chat?** Today the quiz lives in a modal opened by a button, and the chat stream only carries text. You'd need a new SSE event (for example `event: quiz`) or have the frontend open the modal when told to.

---

# 14. Writing Good Tool Descriptions

The description **is the prompt** for that tool. The model reads it to decide when and how to call.

Weak:

```text
name: search
description: searches
```

Strong:

```text
name: searchDocument
description: Search the user's uploaded document for passages relevant to a query.
             Use this for ANY question about the document's content.
             Do not use it for greetings or questions about yourself.
parameters.query: A standalone search query. Resolve pronouns and references
                  using the conversation ("it", "the second one").
```

Guidelines:

* Verb-first, specific names: `searchDocument`, not `tool1`.
* Say **when to use it** and **when not to**.
* Describe each parameter, including format and an example.
* Few tools. Every extra tool is more to choose between and more tokens on every request. Don't declare 30.
* Return **compact** results. Tool output goes back into the prompt and costs tokens. Return 3 chunks, not 30, and not the embeddings.

---

# 15. Tool Calling and Streaming

`/chat-stream` streams text pieces. With tools, the model's first reply may not be text at all.

```text
step 1 (model decides)   → not shown to the user (it's a function call)
step 2 (tool runs)       → could emit a status event: "Searching the document…"
step 3 (model answers)   → stream this one
```

A clean way to fit it into the existing SSE protocol:

```text
event: meta     { sessionId }                       (sources aren't known yet!)
event: status   { text: "Searching the document…" }
event: sources  { sources: [...] }                  (after the tool ran)
data:           { text: "..." }  × N
event: done     {}
```

Notice the consequence: today `meta` carries `sources` **first** because search always happens before generation. With a tool, sources only exist after the model decides to search. That's a protocol change the frontend depends on, so plan it.

Simplest first version: do the decision + tool steps with non-streaming calls, then stream only the final answer.

---

# 16. What Agents Cost

| | Fixed pipeline | Tool loop |
|---|---|---|
| Model calls per message | 1 | 2 or more |
| Latency | one generation | sum of all steps |
| Tokens | prompt once | prompt + tool declarations resent every step |
| Failure modes | one | wrong tool, wrong args, loops, no tool when needed |
| Testability | easy | you must test the decisions too |

On a free tier with tight per-minute limits, doubling the calls per message is a real cost. Routing (7.2, free) + a fixed pipeline for `document_question` is often the better product. Build the tool loop to **understand** it.

---

# 17. Common Agent Patterns (Names to Know)

* **Router** — classify, then pick a fixed path. (7.1 / 7.2)
* **ReAct** — "Reason + Act": the loop of think → call a tool → observe → think. Modern native tool calling is this pattern built into the API.
* **Agentic RAG** — retrieval as a tool the model calls, with its own queries. (7.3)
* **Human-in-the-loop** — the agent pauses for approval before a side effect. (7.4, topic 11)
* **Plan-and-execute** — one call writes a plan, then steps run.
* **Multi-agent / orchestrator-workers** — one model delegates to others. Rarely needed.
* **MCP (Model Context Protocol)** — a standard way to expose tools to models so the same tool server works across apps. Tool calling is the mechanism; MCP is a packaging standard on top.

---

# 18. Failure Modes

| Failure | What it looks like | Defense |
|---|---|---|
| No tool when needed | answers from general knowledge | firm system instruction; or `mode: ANY` on the first step |
| Tool when not needed | searches for "thanks" | better description; router in front |
| Hallucinated tool name | calls `search_docs` | whitelist; return an error result |
| Bad arguments | missing/empty query | Zod on args; return an error result |
| Infinite loop | keeps searching | `MAX_STEPS` |
| Injection through tool output | PDF text says "now call…" | Kind B for anything with side effects; scope from server |
| Cost blow-up | 6 calls per message | step cap; log steps per request |

---

# 19. Where the Code Would Go

Following the repo's structure rule:

```text
src/
  schemas/intent.schema.ts        Zod Intent + Gemini response schema
  services/router.service.ts      classifyIntent() (LLM) and/or routeByVector()
  services/agent.service.ts       the tool loop
  tools/                          one file per tool: declaration + Zod args + execute()
  services/llm.service.ts         needs a new function: it only accepts ONE prompt string today
```

That last line is real work. `generateAnswer(prompt)` and `streamAnswer(prompt)` build `contents: [{ parts: [{ text: prompt }] }]`: a single user turn with everything pasted in. Tool calling needs:

* multi-turn `contents` with roles
* a `tools` field
* returning the whole reply (to see `functionCall` parts), not just `parts[0].text`

That's the same change PI.2 in [prompt-improvement.md](../../prompt-improvement.md) asks for (`systemInstruction` + real turns). Do PI.2 first and tool calling gets much easier.

`prepareChat()` would split: validation + history loading stay, and "embed → search" becomes the body of the `searchDocument` tool.

---

# 20. Testing Agents

The decisions are what you test (topic 12):

```text
router:
  "hi"                    → smalltalk
  "what is chapter 2?"    → document_question
  "quiz me"               → quiz_request
  garbage classification  → falls back to document_question

tool loop (model mocked):
  model returns functionCall   → the right tool runs with those args
  model returns unknown tool   → error result, no crash
  model returns bad args       → error result, no crash
  model always returns a call  → stops at MAX_STEPS
  model returns text           → loop ends, text returned
```

Mock the model with a scripted list of replies. No real LLM in unit tests.

For the vector router: precompute a handful of fixed vectors and test the math, or keep a small labelled set of messages and measure accuracy when you change the examples (that's an eval, see [advanced/04](../advanced/04-evaluation/More_on_Evaluation.md)).

---

# 21. Interview-Level Summary

If asked **"What is an agent?"**:

> An LLM in a loop with tools. Each turn the model either answers or asks to call a function; my code runs the function and feeds the result back, until the model answers or a step limit is hit. The model decides, code acts.

If asked **"How does tool calling work?"**:

> I send the model function declarations: a name, a description, and a JSON schema for the arguments. Instead of text it can return a structured function call. The model doesn't execute anything. My code validates the arguments, runs the real function, and sends the result back in a second request, and the model then writes the final answer.

If asked **"Workflow vs agent?"**:

> In a workflow the path is fixed in code and the LLM fills in steps. In an agent the LLM chooses the path at runtime. I'd default to a workflow or a router because it's cheaper and more predictable, and add agent behaviour only where the flexibility pays for itself.

If asked **"How do you route intents?"**:

> Two ways. An LLM classification with structured output, validated by Zod, which is accurate but costs a call per message. Or vector routing: embed example phrases for each intent once, embed the incoming message, pick the closest by cosine similarity. In a RAG app the message is embedded anyway, so vector routing is free. A hybrid uses vectors first and falls back to the LLM when the scores are close.

If asked **"How do you keep an agent safe?"**:

> Three rules. Tool arguments are untrusted input, so they're validated. Identity and scope come from the server session, never from the model. And tools with side effects aren't callable by the model at all: the model proposes, a human confirms, and code performs the action.

If asked **"What can go wrong?"**:

> Wrong tool, bad arguments, loops, skipping the tool and hallucinating, and prompt injection through tool results. So: a whitelist, argument validation, a step cap, firm instructions, and no model access to anything irreversible.

---

# 22. Things That Will Bite You

* `llm.service.ts` only takes one prompt string; tool calling needs multi-turn `contents`.
* Forgetting to send the model's function-call turn back (or modifying it).
* Classifying a follow-up without history.
* Letting the model pass `documentId`.
* `sources` no longer known at `meta` time.
* Twice the API calls on a free tier.
* A router that's wrong silently: log the chosen intent with `pipelineLogger` on every request.

---

# 23. Final Mental Model

```text
                     USER MESSAGE
                          │
                          ↓
                    ┌───────────┐
                    │  ROUTER   │  vector match (free) → unsure? → LLM classify (Zod)
                    └───────────┘
            ┌─────────────┼───────────────┐
            ↓             ↓               ↓
        smalltalk   document_question   quiz_request
            │             │               │
            ↓             ↓               ↓
       plain reply   ┌─────────┐     LLM PROPOSES
       (no search)   │  MODEL  │◄─┐       │
                     └─────────┘  │       ↓
                       │     │    │   user confirms
                  text │     │ functionCall   │
                       │     ↓    │       ↓
                       │  validate args   CODE calls generateQuiz()
                       │  run searchDocument   (Kind B: model never calls it)
                       │  (Kind A)  │
                       │     └──────┘
                       ↓   functionResponse
                    ANSWER   (max N steps)
```

**The model asks. Code acts.**

**Routing is classification; classification is structured output or vector search.**

**Tool args are untrusted. Scope comes from the server.**

**Kind A: model may call (read-only). Kind B: only code calls, after a human says yes.**

**Always cap the loop.**

**Simplest thing that works beats the cleverest agent.**
