# AI Backend Basics — Simple Learn & Build Path
### Project: **DocMind** — upload a PDF, chat with it, generate a quiz from it

> Goal: actually *understand* how AI backends work — not impress anyone with features. One PDF, one chatbot that remembers the conversation, one quiz. That's it. Everything fancy from the bigger plan is stripped out.
> Method: learn one concept → build the smallest possible version of it → move on.
> You already know: Node.js, Express, MongoDB, JWT, Zod, TypeScript — so none of that is "new" here.

---

## What you're building (and nothing more)

A single Express server with 5 endpoints:
1. `POST /upload` — upload a real PDF, it gets parsed, chunked, embedded, and stored
2. `POST /chat` — send a message in an ongoing conversation about the PDF, get a reply that remembers earlier turns
3. `GET /chat-stream` — same thing, but the reply streams in word by word
4. `POST /quiz` — generate a small multiple-choice quiz from the PDF's content
5. `POST /quiz/check` — check an answer against a generated quiz

No auth, no queues, no multi-step agents, no deployment pressure. Just enough to genuinely understand: what an embedding is, what a vector database does, what "RAG" actually means, what "streaming" actually means, how a chatbot keeps track of a conversation, and how to make an LLM return reliable structured data (for the quiz). Once these click, everything else in the bigger plan becomes much easier to pick up.

---

## Phase 1 — Embeddings & Vector Search (2 days, ~10 hrs)

**Step 1.1 — What is an embedding, really? (3h)**
- Watch: [pgvector Tutorial – DataCamp article](https://www.datacamp.com/tutorial/pgvector-tutorial) (read only, 20 min) + [18 Months of Pgvector Learnings in 47 Minutes (YouTube)](https://www.youtube.com/watch?v=Ua6LDIOVN1s)
- The one thing to actually understand: a sentence gets turned into a list of numbers (e.g. 768 numbers) such that similar-meaning sentences end up with similar numbers. That's it. Everything else is built on this one fact.
- Get your free API key first: [Google AI Studio](https://aistudio.google.com/) — no card required. Docs for the embeddings call: [Gemini API docs – Embeddings](https://ai.google.dev/gemini-api/docs/embeddings)
- Build: a plain Node script, no server yet. Call the embeddings API (`text-embedding-004`) on two sentences, print the two arrays of numbers, and write the cosine similarity formula yourself (don't import a library for this one — you need to type it out to understand it):
  ```
  cosine_similarity(a, b) = dot(a,b) / (|a| * |b|)
  ```
  Try one pair of similar sentences and one pair of unrelated ones. Confirm the similar pair scores higher.

**Step 1.2 — Postgres + pgvector, the smallest possible setup (3h)**
- Use a free [Neon](https://neon.tech) or [Supabase](https://supabase.com) Postgres (has pgvector built in, no local install pain)
- Reference: [pgvector GitHub repo](https://github.com/pgvector/pgvector) for the operators (`<=>` cosine, `<->` Euclidean, `<#>` inner product) and indexing (HNSW/IVFFlat) when you're ready to go deeper than the basics
- Run: `CREATE EXTENSION vector;`
- Create ONE table: `chunks (id, content text, embedding vector(768))`
- Build: insert 3-4 sentences with their embeddings (using your Step 1.1 script) directly via SQL or a tiny insert script. Then run one query by hand:
  ```sql
  SELECT content FROM chunks ORDER BY embedding <=> '[...]' LIMIT 2;
  ```
- The `<=>` operator is doing the exact cosine math you wrote by hand in 1.1 — just faster, inside the database. That connection is the whole point of this step.

**Step 1.3 — Wrap it in a repository function (2h)**
- Learn just enough Drizzle to not hand-write raw SQL everywhere: [Learn Drizzle ORM in 13 mins (YouTube)](https://www.youtube.com/watch?v=hIYNOiZXQ7Y), full docs at [orm.drizzle.team](https://orm.drizzle.team/docs/overview) if you want more depth ([full course here](https://www.youtube.com/watch?v=vyU5mJGCJMw))
- Build: `insertChunk(content, embedding)` and `searchSimilar(queryEmbedding, limit)` as two typed functions in `chunks.repository.ts`. Nothing else touches SQL directly.

---

## Phase 2 — RAG, the actual thing (2-3 days, ~11 hrs)

**Step 2.1 — Parse a real PDF (3h)**
- Learn: skim [pdf-parse on npm](https://www.npmjs.com/package/pdf-parse) (v2, TypeScript-native) — the API is basically `const { text } = await parser.getText()`
- Build: a Multer (or Fastify's built-in) file-upload endpoint that accepts a `.pdf`, reads it into a buffer, runs `pdf-parse` on it, and logs the extracted text length. Don't touch embeddings yet — just get "PDF in, plain text out" working and confirm it on 2-3 different real PDFs (some PDFs extract messier than others — seeing that firsthand matters).
- Note: `pdf-parse` only reads PDFs that have a real text layer (typed documents, exported PDFs). Scanned/photographed PDFs won't work without OCR — don't test with those, use a normal typed PDF or export one from Google Docs.

**Step 2.2 — POST /upload, full pipeline (3h)**
- Build: chunk the extracted text (split by paragraph or every ~500 words — don't overthink chunking strategy yet), embed each chunk, store via your repository from 1.3, tagged with a `documentId` so multiple PDFs don't get mixed together in search results.

**Step 2.3 — POST /chat, single-turn first (4h)**
- Learn: [How to Build a RAG Chatbot with Node.js, Gemini, and pgvector – freeCodeCamp](https://www.freecodecamp.org/news/how-to-build-rag-chatbot-nodejs-gemini-pgvector/) — read the "retrieval + generation" section closely, skip their PDF/file-upload complexity. Also useful: [RAG Pipeline: Complete Node.js Implementation Guide](https://dev.to/surajrkhonde/rag-pipeline-complete-nodejs-implementation-guide-1n54) for chunking strategy detail
- Docs for the actual text-generation call: [Gemini API docs – Text generation](https://ai.google.dev/gemini-api/docs/text-generation)
- Build: endpoint takes a `documentId` + a message → embeds the message → `searchSimilar()` filtered to that document → takes top 2-3 chunks → stuffs them into a prompt like:
  ```
  Answer using only this context: {chunks}
  Question: {message}
  ```
  → calls the LLM → returns the answer as JSON.
- **This is the whole idea of RAG.** Once this works, say it back to yourself in one sentence: "instead of the model guessing from memory, I hand it the relevant text right before asking." That sentence is worth more than any framework. It's still single-turn at this point — no memory of earlier messages yet, that's the next step.

**Step 2.4 — Give it memory: real conversation (4h)**
- The thing that makes something feel like a "chatbot" instead of a search box is that it remembers what you just said. Right now if you ask "summarize chapter 2" then follow up with "what about chapter 3?", the model has no idea what "what about" refers to.
- Build: a `chat_messages` table (`id, sessionId, documentId, role, content, createdAt`). On every `/chat` call:
  1. Save the incoming user message
  2. Pull the last 6-10 messages for that `sessionId` from the DB
  3. Build the prompt as: `[system: use this context: {RAG chunks}] + [last N messages] + [new user message]`
  4. Call the LLM, save its reply as an `assistant` message too, return it
- Test it by asking a question, then a vague follow-up ("what about the next part?") — confirm the model actually understands the follow-up now because it can see the earlier turn.
- One gotcha worth knowing: as conversations get long, you can't keep sending the *entire* history forever (cost + context limits) — for this simple project just cap it at the last N messages. Real systems summarize older messages instead of dropping them, but that's beyond what you need right now.

---

## Phase 3 — Streaming (1 day, ~5 hrs)

**Step 3.1 — SSE basics, isolated (2h)**
- Watch: [Crash Course: SSE with Express.js & EventSource (YouTube)](https://www.youtube.com/watch?v=ieUsuDsQY0o)
- Build: a throwaway `/tick` endpoint that streams "tick 1, tick 2, tick 3..." one per second using `res.write()`. Don't touch your real project yet — just get comfortable with the mechanics (headers, `res.write`, keeping the connection open).

**Step 3.2 — Stream the real chat reply (3h)**
- Learn: [Gemini API docs – Text generation & streaming](https://ai.google.dev/gemini-api/docs/text-generation) — the same page, look for `stream: true` — it returns pieces of the answer as they're generated instead of the whole thing at once
- Build: `GET /chat-stream?sessionId=...&documentId=...&message=...` — same logic as `/chat` (including pulling history), but instead of waiting for the full reply, write each streamed piece to the response as it arrives using the SSE format you just learned. Still save the complete reply to `chat_messages` once the stream finishes, so history stays intact for the next turn.
- Test it by opening the URL directly in a browser tab and watching the words appear.

---

## Phase 4 — Quiz Generation (1-2 days, ~7 hrs)

This is the one genuinely "AI backend" skill in this whole simple project: forcing an LLM to return **reliable structured data** instead of free-form text — the same core idea used for any AI feature that has to plug into a database or UI, not just a chat bubble.

**Step 4.1 — Structured output with Zod (3h)**
- You already know Zod for validating API request bodies — this is the exact same tool, applied to LLM output instead of user input. Docs: [Zod official docs](https://zod.dev/) (just as a refresher if needed)
- Learn: [Gemini API docs – Structured output](https://ai.google.dev/gemini-api/docs/structured-output) — how to force a response to match a schema
- Define a schema for one quiz question:
  ```ts
  const QuizQuestion = z.object({
    question: z.string(),
    options: z.array(z.string()).length(4),
    correctIndex: z.number().min(0).max(3),
  });
  const Quiz = z.array(QuizQuestion).length(5);
  ```
- Build: a standalone script that pulls a few chunks from your DB, prompts the LLM to "generate 5 multiple-choice questions based on this content, respond only in this JSON shape," parses the response with `Quiz.parse(...)`, and logs it. Try it 3-4 times — notice the LLM occasionally returns something slightly off-shape, and Zod catching that (rather than silently accepting garbage) is the entire point of this step.

**Step 4.2 — POST /quiz endpoint (3h)**
- Build: takes a `documentId` → pulls a handful of stored chunks for that document (not a search, just grab several — you want broad coverage of the doc for a quiz, not narrow relevance like `/chat`) → runs the Step 4.1 prompt+schema → returns the validated quiz as JSON.
- Add basic retry logic: if `Quiz.parse()` throws (bad shape from the LLM), retry the LLM call once before giving up. This one small habit — validate, and retry on failure, rather than trusting the model blindly — is a real production pattern worth being able to explain in an interview.

**Step 4.3 — (Optional) simple quiz-taking response check (1h)**
- Build: a tiny `POST /quiz/check` that takes `{questionIndex, chosenIndex}` against a quiz you generated and returns correct/incorrect. This isn't really "AI" — it's just closing the loop so the feature feels complete end to end.

---

## Phase 5 — Tie it together and understand it (1 day, ~4 hrs)

**Step 5.1 — Write it out in your own words (2h)**
- In a `NOTES.md`, answer these without looking anything up:
  - What is an embedding, in one sentence?
  - Why do we store vectors in a database instead of just keeping text?
  - What does RAG actually solve that a plain LLM call doesn't?
  - How does the chatbot "remember" earlier messages — what's actually happening under the hood?
  - Why stream instead of just waiting for the full response?
  - Why validate the LLM's quiz output with Zod instead of trusting it directly?
- If any answer feels shaky, that's the concept to re-read, not move past.

**Step 5.2 — Push a clean README (2h)**
- One paragraph explaining the 5 endpoints, a tiny diagram (even ASCII arrows: `PDF → text → chunks → embeddings → pgvector` and `message → history + RAG chunks → LLM → reply → saved to history`), and how to run it locally.

---

## Total time: ~38 hours over 8-9 days — still very doable alongside job hunting

---

## If you want to go further later
Once this genuinely makes sense — not before — the natural next additions are: background jobs for PDF ingestion so uploads don't block the request (BullMQ), tool calling (letting the LLM decide to search instead of you always doing it), and multi-step workflows (e.g. quiz generation that pauses to let the admin pick topics first). The full version of all of that is below — come back to it once DocMind feels boring and obvious to you, not confusing.

---
---

# Part 2 — The Full Learning Path

Everything in Part 1 gets you fluent in the core four concepts. This part is the complete depth version — the same ideas, but built to production-shape, with the concepts that actually separate a fresher from someone who's genuinely done AI-backend work: background job queues, agents that can call tools, multi-step workflows with suspend/resume, testing, and observability. Do this once DocMind (Part 1) is done and genuinely feels easy — not before, or you'll be learning six things at once and understanding none of them well.

**Everything below stays free too** — same rule as Part 1. Wherever a service is named, the free tier is specified. No credit card required anywhere in this plan.

> **Cost check for every new tool introduced below:**
> - Redis → **Upstash** free tier (no card)
> - Deployment (API + background worker) → **Render** free tier web service + free background worker (spins down when idle, which is fine for a portfolio project)
> - Everything else (BullMQ, LangGraph.js, Vitest/Jest, Zod, Drizzle) → open-source npm packages, always free
> - LLM + embeddings → keep using **Gemini free tier**, same as Part 1

---

## Phase A — Background Jobs (2 days, ~8 hrs)

Right now `/upload` blocks the HTTP request while it parses, chunks, and embeds the whole PDF — fine for a 3-page PDF, painful for a 50-page one. This phase fixes that the way real systems do it.

**Step A.1 — Redis + BullMQ concepts (3h)**
- Learn: [How to Build a Job Queue in Node.js with BullMQ and Redis](https://oneuptime.com/blog/post/2026-01-06-nodejs-job-queue-bullmq-redis/view) + [Building a Scalable Queue System with BullMQ & Redis (YouTube)](https://www.youtube.com/watch?v=vFI_Nf2PWFQ). Docs: [docs.bullmq.io](https://docs.bullmq.io/)
- Understand: queue vs job vs worker, why "nobody is waiting" work (embedding a big PDF) shouldn't block a request, retries/backoff when a job fails
- Set up: free [Upstash](https://upstash.com) Redis instance (no card needed), connect BullMQ to it

**Step A.2 — Move PDF ingestion into a job (5h)**
- Build: `POST /upload` now just saves the file and enqueues an `ingest-pdf` job, returning immediately with a `documentId` and status `processing`. A separate `worker.ts` process picks up the job, does the parse → chunk → embed → store pipeline, and updates the document's status to `ready` when done.
- Add a `GET /documents/:id/status` endpoint so the frontend (or you, testing with curl) can poll whether ingestion finished.
- This is the OFFLINE/ONLINE split — a genuinely real architectural pattern. Name it exactly like that in interviews: "ingestion is offline work, nobody's waiting on it, so it runs on a queue; chat is online work, a human is waiting, so it runs inline and streams."

---

## Phase B — Agents & Tool Calling (3 days, ~14 hrs)

This is where your chatbot stops being "always do RAG search" and starts genuinely deciding what to do.

**Step B.1 — Structured output as a routing decision (3h)**
- You already built structured output for the quiz (Zod-validated JSON). Reuse the exact same pattern for intent classification.
- Build: before your `/chat` endpoint does RAG search, have the LLM first classify the incoming message into one of: `document_question`, `smalltalk`, `quiz_request` — forced into a Zod schema `{ intent: "document_question" | "smalltalk" | "quiz_request" }`. Route based on that instead of always doing the same RAG flow. Smalltalk ("hey", "thanks") shouldn't trigger a vector search at all — notice how much better that feels than treating every message the same way.

**Step B.2 — Vector-based intent routing (close the loop with Phase 1) (3h)**
- Instead of classifying with a raw LLM call every time (slower, costs a call), do it the way real systems do: embed each intent's *description* once at startup ("a question about the uploaded document's content", "casual greeting or thanks", "a request to generate a quiz"), store those 3 vectors, and on each message just embed the message and cosine-match against these 3 — same `<=>` operator from Phase 1, just applied to routing instead of document search.
- This is genuinely satisfying once it clicks: **intent routing IS vector search.** Say that sentence out loud when it works.

**Step B.3 — Tool calling (5h)**
- Learn: [LLM Tool Calling Explained (YouTube)](https://www.youtube.com/watch?v=Gk4wo9yTioA) + [The Anatomy of Tool Calling in LLMs: A Deep Dive](https://martinuke0.github.io/posts/2026-01-07-the-anatomy-of-tool-calling-in-llms-a-deep-dive/) + [LLM Function Calling and Tool Use Guide 2026](https://baeseokjae.github.io/posts/llm-function-calling-tool-use-guide-2026/) + [Gemini API docs – Function calling](https://ai.google.dev/gemini-api/docs/function-calling) (free tier)
- Understand the **two kinds of tools** — a real design idea worth explaining in interviews:
  - **Kind A** — tools the LLM can *choose* to call (e.g. "search this document") — read-only, safe to let the model decide on its own
  - **Kind B** — deterministic functions the LLM *never* calls directly (e.g. "save quiz to DB") — only your own code calls these, after explicit confirmation
- Build: give your `document_question` path a real tool — `searchDocument(documentId, query)` — that the LLM can call instead of you manually running the RAG search every time. Watch it decide when to call it vs. answer from the conversation history alone.

**Step B.4 — Kind-B tool: quiz creation as a confirmed action (3h)**
- Build: instead of `/quiz` always generating and returning a quiz immediately, split it: the agent proposes a quiz topic/scope back to the user ("I'll make 5 questions covering chapters 1-2, sound good?"), and only after the user confirms does your code call the actual `createQuiz()` function — a Kind-B tool the LLM never touches directly. This is "AI decides, code acts," made literal.

---

## Phase C — Multi-Step Workflows with Suspend/Resume (3 days, ~14 hrs — the hardest, most valuable phase)

**Step C.1 — The concept (2h)**
- There's no single perfect free tutorial for this exact pattern (it's mostly framework-specific — Mastra, LangGraph, Temporal each implement a version), so build the mental model from first principles first:
  - A workflow = a small state machine with named steps and a status column: `ACTIVE`, `SUSPENDED`, `COMPLETED`, `FAILED`
  - "Suspend" = the workflow pauses mid-way, saves its current step + accumulated state to the DB, and waits for the next user message to continue
- Read: [LangGraph docs – persistence & human-in-the-loop](https://langchain-ai.github.io/langgraph/concepts/persistence/) for the concept — even without using LangGraph, the mental model transfers directly. Broader context: [LangChain.js docs](https://js.langchain.com/docs/introduction/)

**Step C.2 — Build it by hand first (8h)**
- Build: turn quiz creation (from B.4) into a real 2-step workflow using a `workflow_runs` table (`id, sessionId, currentStep, state jsonb, status`):
  1. **proposeScope** step — agent asks which chapters/topics to cover → save state, status = `SUSPENDED`
  2. On the next message: **resume** — load the saved state, confirm, call the Kind-B `createQuiz()` tool → status = `COMPLETED`
- This single feature, hand-built, teaches you more about real agentic-system design than any framework tutorial — because you're forced to understand exactly what "state" needs to persist and why.

**Step C.3 — Optional: reimplement with LangGraph.js (4h)**
- Learn: [LangGraph.js docs](https://langchain-ai.github.io/langgraphjs/) (free, open-source, no cost)
- Build: reimplement C.2's workflow using LangGraph.js instead of your hand-rolled version, keep both in your repo as `/hand-rolled` and `/langgraph` folders. "I built it from scratch to understand the mechanics, then reimplemented with a framework" is a genuinely strong interview story — it shows you understand what the framework is doing for you, not just how to import it.

---

## Phase D — Testing & Observability (2 days, ~8 hrs)

**Step D.1 — Testing the LLM boundary (5h)**
- Core idea: never call a real LLM in a unit test — it's slow, costs nothing here but is still flaky/non-deterministic. Mock the LLM client at the boundary; test everything deterministic (your state transitions, your repository functions, your Zod validation) with real inputs.
- Learn: [Vitest docs](https://vitest.dev/) (fast, modern, works well with TypeScript) — search "mocking API calls Vitest" for the specific mocking pattern
- Build: unit tests for your intent-routing logic, your quiz schema validation, and your workflow state transitions from Phase C, all with the LLM call mocked to a fixed fake response. Free — Vitest/Jest are just npm packages.

**Step D.2 — Basic observability (3h)**
- You don't need a paid tracing service — even a simple structured `console.log` wrapping every LLM call with `{ prompt length, response length, duration, model }` is enough to demonstrate you understand *why* this matters for AI systems specifically (debugging hallucinations, watching for slow calls, catching runaway costs) — different from normal API logging.
- If you want a proper free option later: [Langfuse](https://langfuse.com/docs) has a generous free tier and self-host option, but it's not required to learn the concept.

---

## Phase E — Deploy for Free (1 day, ~5 hrs)

**Step E.1 — Deploy the API + worker (5h)**
- Use **[Render](https://render.com/docs)'s free tier**: one free web service for your API, one free [background worker](https://render.com/docs/background-workers) for your BullMQ worker process (Step A.2). Free tier services spin down after inactivity and take a few seconds to wake up — totally fine for a portfolio project, just mention it if a recruiter tests it and it's slow to respond the first time.
- Database: your existing free [Neon](https://neon.tech)/[Supabase](https://supabase.com) Postgres. Redis: your existing free [Upstash](https://upstash.com) instance.
- Confirm the full flow works live: upload → background ingest → chat with memory → streamed reply → quiz workflow with suspend/resume.

---

## Total time for Part 2: ~49 hours over 11 days on top of Part 1

**Combined total (Part 1 + Part 2): ~87 hours over roughly 19-20 days at 5 hrs/day** — comfortably inside your 20-30 day window, entirely free, and covering genuinely everything from the original repo's teaching plan, just built by you from first principles instead of read off someone else's codebase.
