# Project Build Walkthrough — DocMind

The actual build order, phase by phase, step by step. This is the "what do I physically build, in what order" document — for concepts and theory, see [topics/](topics/); for what to do *right now*, see [PROGRESS.md](PROGRESS.md). This file is the map between them: each step here names the topic it teaches and the code it produces.

Building **DocMind**: upload a PDF → chat with it (with memory) → stream the reply → generate a quiz from it. Five endpoints, nothing more, until it's genuinely understood.

---

## Phase 1 — Embeddings & Vector Search

*Topics: [01-embeddings](topics/01-embeddings), [02-vector-search-pgvector](topics/02-vector-search-pgvector), [03-repository-pattern-drizzle](topics/03-repository-pattern-drizzle)*

**Step 1.1 — Embed two sentences, compare them by hand**
- Call the Gemini embeddings API (`text-embedding-004`) on a similar sentence pair and an unrelated pair
- Print the raw vectors, write the cosine similarity formula yourself (no library)
- Confirm the similar pair scores higher
- Output: `src/step1-embeddings.ts` (done)

**Step 1.2 — Stand up Postgres + pgvector**
- Create a free Neon or Supabase Postgres instance
- Run `CREATE EXTENSION vector;`
- Create one table: `chunks (id, content text, embedding vector(768))`
- Insert 3-4 sentences with their embeddings, then run one `SELECT ... ORDER BY embedding <=> '[...]' LIMIT 2` by hand
- Output: a working Postgres instance + one manual query proving `<=>` matches your hand-written cosine math

**Step 1.3 — Wrap it in a repository**
- Set up Drizzle, point it at your Postgres instance
- Write `insertChunk(content, embedding)` and `searchSimilar(queryEmbedding, limit)` as typed functions
- Output: `src/repositories/chunks.repository.ts` — nothing else touches SQL directly from here on

**Milestone:** you can insert and semantically search vectors through typed TypeScript functions.

---

## Phase 2 — RAG (Retrieval-Augmented Generation)

*Topics: [04-pdf-parsing](topics/04-pdf-parsing), [05-rag](topics/05-rag), [06-conversation-memory](topics/06-conversation-memory)*

**Step 2.1 — Parse a real PDF**
- Add a Multer upload endpoint that accepts a `.pdf`, reads it into a buffer
- Run `pdf-parse` on it, log the extracted text length
- Test on 2-3 different real PDFs (typed/exported, not scanned — `pdf-parse` needs a real text layer)
- Output: PDF in, plain text out — nothing else yet

**Step 2.2 — `POST /upload`, the full pipeline**
- Chunk the extracted text (paragraph or ~500 words — don't overthink it)
- Embed each chunk, store via `insertChunk`, tagged with a `documentId`
- Output: a working `/upload` endpoint; a document becomes searchable chunks

**Step 2.3 — `POST /chat`, single-turn**
- Endpoint takes `documentId` + `message`
- Embed the message → `searchSimilar()` filtered to that document → top 2-3 chunks
- Stuff into a prompt: `Answer using only this context: {chunks}\nQuestion: {message}` → call the LLM → return JSON
- Output: a chatbot that answers from the PDF, but forgets everything after each request

**Step 2.4 — Give it memory**
- Add a `chat_messages` table (`id, sessionId, documentId, role, content, createdAt`)
- On each `/chat` call: save the user message, pull the last 6-10 messages for that session, build the prompt as `[system: RAG context] + [history] + [new message]`, save the assistant's reply too
- Test with a vague follow-up ("what about the next part?") and confirm it resolves correctly
- Output: `/chat` now feels like a conversation, not a search box

**Milestone:** upload a PDF, ask it questions across multiple turns, get grounded answers that remember context.

---

## Phase 3 — Streaming

*Topic: [07-streaming-sse](topics/07-streaming-sse)*

**Step 3.1 — SSE mechanics, isolated**
- Build a throwaway `/tick` endpoint that streams "tick 1, tick 2..." once a second with `res.write()`
- Get comfortable with headers, keeping the connection open, and how `EventSource` consumes it client-side
- Output: a disposable endpoint, deleted once it's understood

**Step 3.2 — Stream the real chat reply**
- Build `GET /chat-stream?sessionId=...&documentId=...&message=...`
- Same logic as `/chat` (including pulling history), but write each piece of the LLM's streamed response to the client as it arrives
- Still save the complete reply to `chat_messages` once the stream finishes
- Output: open the URL in a browser tab, watch words appear one at a time

**Milestone:** the chat reply streams instead of arriving all at once, and history still works on the next turn.

---

## Phase 4 — Quiz Generation

*Topic: [08-structured-output-zod](topics/08-structured-output-zod)*

**Step 4.1 — Structured output with Zod**
- Define a `QuizQuestion` Zod schema (question, 4 options, correct index) and a `Quiz` schema (array of 5)
- Write a standalone script: pull a few chunks, prompt the LLM to return JSON matching the schema, parse with `Quiz.parse(...)`
- Run it 3-4 times, notice occasional shape mismatches Zod catches
- Output: a script proving you can force reliable JSON out of an LLM

**Step 4.2 — `POST /quiz`**
- Takes a `documentId`, pulls several stored chunks (broad coverage, not narrow relevance)
- Runs the Step 4.1 prompt+schema, returns the validated quiz
- Add one retry: if `Quiz.parse()` throws, retry the LLM call once before failing
- Output: a working quiz-generation endpoint with a real production habit (validate → retry) built in

**Step 4.3 — `POST /quiz/check`** *(optional, closes the loop)*
- Takes `{questionIndex, chosenIndex}` against a generated quiz, returns correct/incorrect
- Output: the quiz feature feels complete end to end

**Milestone:** DocMind can generate a quiz from the PDF and grade an answer against it.

---

## Phase 5 — Tie It Together

**Step 5.1 — Write it in your own words**
- Answer, without looking anything up: what's an embedding, why store vectors in a DB, what RAG actually solves, how "memory" works under the hood, why stream, why validate LLM output with Zod
- If any answer feels shaky, that's the concept to revisit

**Step 5.2 — Push a clean README**
- One paragraph on the 5 endpoints, an ASCII diagram of both data flows, how to run it locally
- Output: a presentable, explainable project

**Milestone: you're job-ready here.** Everything below is deeper — go apply/interview before continuing.

---

## Phase 6 — Background Jobs

*Topic: [09-background-jobs-bullmq](topics/09-background-jobs-bullmq)*

**Step 6.1 — Redis + BullMQ concepts**
- Set up a free Upstash Redis instance, connect BullMQ to it
- Understand queue vs job vs worker, and why "nobody is waiting" work shouldn't block a request

**Step 6.2 — Move PDF ingestion into a job**
- `/upload` now just saves the file and enqueues an `ingest-pdf` job, returns immediately with `documentId` + status `processing`
- A separate `worker.ts` process does parse → chunk → embed → store, updates status to `ready`
- Add `GET /documents/:id/status` to poll ingestion state
- Output: the offline/online split — ingestion is offline, chat is online

**Milestone:** large PDF uploads no longer block the request.

---

## Phase 7 — Agents & Tool Calling

*Topic: [10-agents-tool-calling](topics/10-agents-tool-calling)*

**Step 7.1 — Structured output as a routing decision**
- Before `/chat` runs RAG, have the LLM classify the message into `document_question` / `smalltalk` / `quiz_request` (Zod-forced)
- Route based on that — smalltalk skips vector search entirely

**Step 7.2 — Vector-based intent routing**
- Embed each intent's description once at startup, store the 3 vectors
- On each message, embed it and cosine-match against those 3 instead of calling the LLM every time
- Output: "intent routing IS vector search" — same math as Phase 1, applied to routing

**Step 7.3 — Tool calling**
- Give the `document_question` path a real tool: `searchDocument(documentId, query)` that the LLM can choose to call instead of you always running RAG manually
- Understand the Kind A (LLM may call, read-only) vs Kind B (LLM never calls, code-only) distinction

**Step 7.4 — Kind-B tool: confirmed quiz creation**
- Split `/quiz`: the agent proposes scope ("5 questions covering chapters 1-2, sound good?"), only after user confirmation does code call the real `createQuiz()` function
- Output: "AI decides, code acts," made literal

**Milestone:** the chatbot routes intelligently and can call tools instead of always following one fixed path.

---

## Phase 8 — Multi-Step Workflows (Suspend/Resume)

*Topic: [11-workflows-suspend-resume](topics/11-workflows-suspend-resume)*

**Step 8.1 — The concept**
- Build the mental model: a workflow = a state machine with named steps + a status (`ACTIVE`, `SUSPENDED`, `COMPLETED`, `FAILED`)
- "Suspend" = pause mid-way, save state to the DB, wait for the next message to continue

**Step 8.2 — Build it by hand**
- Turn quiz creation into a 2-step workflow with a `workflow_runs` table (`id, sessionId, currentStep, state jsonb, status`)
- Step 1 `proposeScope`: ask which chapters to cover → save state → `SUSPENDED`
- Step 2 `resume`: load state on next message, confirm, call `createQuiz()` → `COMPLETED`

**Step 8.3 — *(Optional)* Reimplement with LangGraph.js**
- Rebuild Step 8.2's workflow using LangGraph.js, keep both versions (`/hand-rolled` and `/langgraph`)
- Output: "built from scratch to understand the mechanics, then reimplemented with a framework" — a genuinely strong interview story

**Milestone:** a real multi-turn workflow that survives being interrupted and resumed.

---

## Phase 9 — Testing & Observability

*Topic: [12-testing-observability](topics/12-testing-observability)*

**Step 9.1 — Test the LLM boundary**
- Mock the LLM client at the boundary; never call a real LLM in a unit test
- Write Vitest tests for intent-routing, quiz schema validation, and workflow state transitions, all with a fixed fake LLM response

**Step 9.2 — Basic observability**
- Wrap every LLM call with a structured log: `{ prompt length, response length, duration, model }`
- *(Optional)* try Langfuse's free tier for proper tracing

**Milestone:** you can prove the deterministic parts of the system work without ever hitting a real LLM in CI.

---

## Phase 10 — Deploy for Free

*Topic: [13-deployment](topics/13-deployment)*

**Step 10.1 — Deploy the API + worker**
- Deploy the API as a Render free web service, the BullMQ worker as a Render free background worker
- Point both at your existing Neon/Supabase Postgres and Upstash Redis

**Step 10.2 — Confirm the full flow live**
- Upload → background ingest → chat with memory → streamed reply → quiz workflow with suspend/resume, all working end to end on the deployed URL

**Milestone:** DocMind is live, and every phase above is provably working outside your machine.

---

## Phase 11 — Production Web-Layer Gaps

*Topics: [14-graphql-subscriptions](topics/14-graphql-subscriptions), [15-auth-jwt](topics/15-auth-jwt), [16-idempotency-multi-tenancy](topics/16-idempotency-multi-tenancy)*

These don't require rebuilding DocMind — reading + notes is enough to speak to them in an interview. Optional hands-on: add JWT auth to `/chat` as a side exercise.

**Step 11.1 — GraphQL + subscriptions**
- Learn schema/resolvers/subscriptions and how a subscription resolver (an async generator) maps onto SSE

**Step 11.2 — Auth (JWT)**
- Learn verification vs decoding, where it belongs in a request lifecycle, authentication vs authorization

**Step 11.3 — Idempotency & multi-tenancy**
- Learn the idempotency-key pattern (reject duplicate requests before they cause side effects)
- Learn tenant-scoped queries and why unscoped vector search can leak one tenant's data into another's answer

**Milestone:** you can explain the production concerns a real multi-tenant AI backend has to handle, even though DocMind itself doesn't need them.

---

## Phase 12 — Advanced Pass

*Topics: [advanced/](topics/advanced) — only after every phase above is done*

Retraces the same path one level deeper: prompt engineering, chunking strategy tradeoffs, token counting & cost, evaluation of RAG/LLM output, rate limiting & retries, LLM security (prompt injection, data leakage), and vendor abstraction. See [PROGRESS.md](PROGRESS.md) Part 3 for the exact order and which base topic each one revisits.

---

## How to use this file

- Each step names its output — don't move to the next step until that output actually exists and runs.
- Each phase names its topic folder — read the topic's `README.md` *before* building that phase, fill in its `NOTES.md` *after*.
- For "what do I do right now," check [PROGRESS.md](PROGRESS.md) — it's the single tracker; this file is the reference you come back to for the details of each step.
