# Project Build Walkthrough — DocMind

The actual build order, phase by phase, step by step. This is the "what do I physically build, in what order" document — for concepts and theory, see [topics/](topics/); for what to do *right now*, see [PROGRESS.md](PROGRESS.md). This file is the map between them: each step here names the topic it teaches and the code it produces.

Building **DocMind**: upload a PDF → chat with it (with memory) → stream the reply → generate a quiz from it. Five endpoints, nothing more, until it's genuinely understood.

**Frontend, built alongside the backend:** starting from Phase 2, every endpoint also gets a minimal React UI, built in the same step as the endpoint itself — not bolted on at the end. The point isn't a polished product; it's testing each endpoint the way a real client actually would (form submissions, `fetch`/`EventSource` calls, rendered responses) instead of only through Postman. Frontend steps are marked with an **F** (e.g. Step 2.1F) so they're easy to distinguish from the backend step they pair with. Lives in a separate `frontend/` folder (Vite + React), talking to the Express API over HTTP — kept deliberately simple, no state library, no routing beyond what's needed to exercise each endpoint.

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
- Output: PDF in, plain text out — nothing else yet *(done — tested via Postman before the frontend existed)*

**Step 2.1F — Frontend scaffold + upload UI**
- Scaffold a React app with Vite in `frontend/`
- Build one page: a file input + submit button that POSTs to `/upload` as `multipart/form-data`, renders the JSON response (filename, text length, preview)
- Output: the first real client talking to the API — proves `/upload` works the way an actual browser would call it, not just `curl`/Postman

**Step 2.2 — `POST /upload`, the full pipeline**
- Chunk the extracted text (paragraph or ~500 words — don't overthink it)
- Embed each chunk, store via `insertChunk`, tagged with a `documentId`
- Output: a working `/upload` endpoint; a document becomes searchable chunks

**Step 2.2F — Frontend: show ingestion result**
- Update the upload UI to display the returned `documentId` and chunk count, and keep it visible/selectable for the next steps (chat needs a `documentId` to target)
- Output: the frontend now carries state from upload → chat, the way a real app would

**Step 2.3 — `POST /chat`, single-turn**
- Endpoint takes `documentId` + `message`
- Embed the message → `searchSimilar()` filtered to that document → top 2-3 chunks
- Stuff into a prompt: `Answer using only this context: {chunks}\nQuestion: {message}` → call the LLM → return JSON
- Output: a chatbot that answers from the PDF, but forgets everything after each request

**Step 2.3F — Frontend: chat UI**
- A simple message list + input box, POSTs each message to `/chat` with the selected `documentId`, appends the reply to the list
- Output: DocMind now has a real, clickable chat interface, even though it's still single-turn underneath

**Step 2.4 — Give it memory** *(done)*
- Added a `chat_messages` table (`id, sessionId, documentId, role, content, createdAt`)
- `/chat` rewritten as a 7-step pipeline: embed → search → **load history** (last `HISTORY_LIMIT = 8` messages for the session) → save user message → build layered prompt (`RAG context` + `history` + `new question`) → generate → **save assistant reply**
- Tested with a real vague follow-up ("what's the first stage?" after discussing "3 pipelines") — confirmed it resolves correctly using history, verified directly in Neon's `chat_messages` table
- Output: `/chat` now feels like a conversation, not a search box

**Step 2.4F — Frontend: session tracking** *(done)*
- Frontend generates one `sessionId` per document (`crypto.randomUUID()`, on first message), reused for every message in that document's thread, sent along with every `/chat` request
- **Known gap at the time, since fixed in Step 2.5 below:** `sessionId` and visible messages only lived in React state — refreshing the tab started a brand-new session, orphaning the old conversation (data survived in Postgres, just unreachable from the UI).

**Milestone:** upload a PDF through the browser, ask it questions across multiple turns in a real chat UI, get grounded answers that remember context — confirmed working end to end.

---

**Step 2.5 — Backend: expose + delete session/document history** *(done)*
- No new table — a "session" is just a `sessionId` value shared by a group of `chat_messages` rows, so history is *derived*, not stored separately
- `GET /sessions` — `listSessions()` in `chatMessages.repository.ts` groups all `chat_messages` by `sessionId` and reduces each group to one summary: `{ sessionId, documentId, filename, title, lastMessage, lastMessageAt, messageCount }`. `title` is the session's first user message — same trick ChatGPT uses to name a thread from what you first typed. Sorted newest-activity-first.
- `GET /sessions/:sessionId/messages` — `getMessagesForSession()`, the full transcript for one session, oldest-first
- `DELETE /documents/:documentId` — deletes the document's chunks, every chat message tied to it (across all its sessions), then the document row itself — no orphaned rows left pointing at a dead `documentId`
- `DELETE /sessions/:sessionId` — deletes just that conversation's messages, document untouched
- Output: the persistence gap from Step 2.4F is closed, and documents/conversations can be removed on request instead of only accumulating

**Step 2.5F — Frontend: rebuilt around real chat history + a proper folder structure** *(done)*
- Redesigned the UI into a ChatGPT-style layout: a collapsible left sidebar with a "New chat" button and a history list (grouped Today / Yesterday / Previous 7 days / Older), and a "continue with a document you've uploaded before" chip row on the New Chat screen — replacing the earlier three-pane layout that showed uploaded PDFs as the "history"
- **Persistence, for real this time:** only the active `sessionId` is written to `localStorage` (`docmind:activeSessionId`) — never the messages themselves. On load, that id is cross-checked against `GET /sessions` (to recover which document it belongs to) and `GET /sessions/:id/messages` is used to rehydrate the transcript. A refresh now resumes the exact same conversation instead of losing it.
- Delete buttons (hover-revealed trash icon) on history items and document chips, calling the new `DELETE` endpoints, with a native `confirm()` before anything destructive happens; deleting the currently-open document/session resets the view back to New Chat instead of showing a dead conversation
- Split the old single `App.tsx` (500+ lines) into a real structure:
  ```
  frontend/src/
    api/            client.ts, documents.ts, chat.ts, sessions.ts   — all fetch calls
    types/          document.ts, chat.ts                             — shared interfaces
    hooks/          useDocuments.ts, useSessions.ts, useChat.ts       — state + async logic
    utils/          format.ts, logger.ts
    components/
      common/       IconButton.tsx
      sidebar/      Sidebar.tsx, HistoryList.tsx
      chat/         ChatView.tsx, ChatPanel.tsx, ChatTurn.tsx, ChatSources.tsx, ChatInputForm.tsx, NewChatScreen.tsx
      documents/    UploadDropzone.tsx
    App.tsx         thin orchestrator — wires hooks to components
  ```
- Added a tagged console logger (`utils/logger.ts`) — every API call and every hook action logs as `[DocMind:<scope>] ...` (color-coded info/warn/error), so the whole upload → chat → session flow can be traced live in devtools instead of guessing where something broke
- Output: DocMind now looks and behaves like a real chat app — new conversations, browsable/persisted history, and cleanup — on a frontend codebase organized the way a real project would be, not one giant component file

---

## Phase 3 — Streaming

*Topic: [07-streaming-sse](topics/07-streaming-sse)*

**Step 3.1 — SSE mechanics, isolated** *(done)*
- Built a throwaway `GET /tick` endpoint that streams "tick 1 … tick 5" once a second with `res.write()`: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, each event written as `data: ...\n\n` (the blank line is what ends one event)
- `req.on('close', ...)` clears the interval if the client disconnects early — otherwise it keeps writing to a dead connection forever
- Output: the SSE mechanics understood in isolation. `/tick` was deleted from `src/index.ts` once understood — it was scaffolding, not part of DocMind.

**Step 3.2 — Stream the real chat reply** *(done)*
- `GET /chat-stream?sessionId=...&documentId=...&message=...` — **GET, not POST**, because the browser's `EventSource` can only send GET requests, so everything travels as query params instead of a JSON body
- Same 7-step pipeline as `/chat` (embed → search → load history → save user message → build prompt → generate → save assistant reply). To avoid maintaining the prompt twice, it was extracted into a shared `buildChatPrompt(context, history, message)` helper used by both routes
- **`streamAnswer()`** in `llm.service.ts` (an `async function*` — it `yield`s pieces instead of returning once) calls Gemini's `streamGenerateContent?alt=sse`. It reads raw bytes with `res.body.getReader()`, decodes with `TextDecoder`, normalizes Gemini's `\r\n` line endings to `\n` (on the whole buffer, so a `\r\n` split across two network chunks is still caught), splits on the blank-line event boundary, keeps the trailing partial event in the buffer for the next read, and yields the `text` out of each `data: {...}` payload
- The route's own SSE event protocol, which the frontend depends on:
  | Event | Payload | When |
  |---|---|---|
  | `meta` (named) | `{ sessionId, sources }` | once, first — so the client learns the session id and gets the sources before any text |
  | default (unnamed `data:`) | `{ text }` | once per piece of the answer |
  | `done` (named) | `{}` | after the full reply is saved |
  | `error` (named) | `{ error }` | if anything fails mid-stream |
- Saving the assistant reply happens *after* the last chunk, in its own `try/catch` — the user already has the full answer by then, so a failed DB write is logged, not turned into an error event
- **Error handling added along the way:** every chat step talks to Gemini or Neon and can fail on a weak connection, which used to surface as a bare `500`. Added `withErrorHandling(label, handler, { sse })`, wrapped around `/chat` and `/chat-stream`: it logs the real cause to the terminal and returns a clear message. A plain route answers `503 { error }`; for the stream route (`sse: true`) the error goes out as a real `event: error` frame instead, because `EventSource` can't read the body of a non-200 response — it only sees "connection error". `summarizeError()` prints just the first line of the message, the chain of `cause`s (where the real reason like `ECONNRESET` lives) and the first stack frame in our own code — Drizzle's failed-query errors otherwise dump the SQL plus all 3072 bound embedding numbers into the log
- Output: open the URL in a browser tab, watch the words appear one at a time

**Step 3.2F — Frontend: streaming chat** *(done)*
- `streamChatMessage()` in `api/chat.ts` opens an `EventSource` and routes the four events to `onMeta` / `onChunk` / `onDone` / `onError` handlers, and returns a cleanup function that closes the connection. The native `error` event fires both for our own `event: error` frames (has `e.data`) and for plain connection failures (no `e.data`), so it's handled as two separate cases with different messages
- `useChat.sendMessage()` now awaits a Promise wrapped around those handlers. `onMeta` sets the active session (first message of a new thread) and adds an *empty* assistant bubble with its sources already attached; each chunk then grows the last message in place. On error, an empty placeholder is replaced by the error bubble rather than left blank above it
- One React detail worth remembering: the functions passed to `setMessages(prev => ...)` must be pure — in dev, StrictMode calls them twice with the same `prev`. So "the bubble being streamed into" is always derived as *the last message in `prev`*, never from a variable mutated inside the callback
- `ChatPanel` keeps showing the "Thinking…" bubble until the assistant bubble has real text (retrieval + first token can take a moment), hides the empty placeholder so it doesn't render as a blank bubble, and auto-scrolls as the reply grows (`auto` while streaming, `smooth` otherwise), not just when a new message is added
- Output: the chat UI shows the reply typing out word by word, the actual DocMind experience

**Step 3.3 — Multi-document chat: "all PDFs" by default, one PDF as the override** *(done — line-linked explanation in [CODE_EXPLAINED.md](CODE_EXPLAINED.md#step-33--multi-document-chat))*
- **Backend:** `documentId` is now optional everywhere. **Omitted / empty / `'all'` = search every document**; a real id = that one PDF. The change lives in one place, `prepareChat()` in `chat.service.ts`, so `/chat` and `/chat-stream` both got it for free
- `searchSimilar(embedding, limit, documentId?)` — no `documentId` skips the filter. It now returns `{ content, distance, documentId, filename }` (a `LEFT JOIN documents`), so sources say which PDF each chunk came from. In all-documents mode it only searches chunks whose `documents` row exists (`documents.id IS NOT NULL`), because older "orphan" chunks (test uploads from before Step 2.2) have no row, aren't visible in the UI, and would otherwise show up in answers as an "unknown document"
- **No schema change:** an all-documents session stores the sentinel `'all'` in the existing `NOT NULL` `chat_messages.document_id` column (`ALL_DOCUMENTS` in `config.ts`) instead of making it nullable — avoids altering the live table. `listSessions()` labels such a session "All documents"
- **Prompt:** `buildChatPrompt(..., multiDocument)` — in all-mode each chunk is prefixed `[Source: filename]` and the model is told to name the document it used; the single-document prompt is unchanged
- **Frontend:** an "All documents (N)" chip on the New Chat screen (only when there's more than one document) and a **"Searching in [All documents ▾]"** dropdown in the chat header; source cards show their filename. A conversation's scope is fixed when it starts, so switching the dropdown starts a *new* chat (the old one stays in history)
- **Known tradeoff:** the top 3 chunks are shared across all PDFs, and "meta" questions like "which documents do you have?" can't be answered by chunk search — the model only sees the nearest 3 chunks, often from one file. Routing (Phase 7) is the real fix

**Milestone:** the chat reply streams instead of arriving all at once, visibly in the browser, and history still works on the next turn. *(Reached — Steps 3.1, 3.2, 3.2F and 3.3 all done; Phase 3 is complete.)*

---

## Phase 4 — Quiz Generation

*Topic: [08-structured-output-zod](topics/08-structured-output-zod)*

**Step 4.1 — Structured output with Zod** *(done — line-linked explanation in [CODE_EXPLAINED.md](CODE_EXPLAINED.md#step-41--structured-output-with-zod); run with `npm run step4`)*
- `src/schemas/quiz.schema.ts`: `QuizQuestion` (question; **exactly 4** options; `correctIndex` a whole number 0–3; a `.refine()` rule that all 4 options differ) and `Quiz` (exactly 5 questions). `z.infer` gives the TypeScript type from the same schema. It also holds `quizResponseSchema`, the same shape in Gemini's structured-output format
- `sampleChunks(documentId, count)` in `chunks.repository.ts`: chunks **evenly spaced across a document** in reading order — no search, because a quiz has no question and wants broad coverage. `generateAnswer(prompt, generationConfig?)` gained an optional config so it can switch on Gemini's JSON mode
- `src/step4-quiz-zod.ts`: asks for the same quiz two ways (plain "respond with ONLY JSON" vs structured-output mode), several runs each, and checks every reply in two stages — `JSON.parse`, then `Quiz.safeParse` — reporting exactly why any reply fails. Also a **gallery of 11 hand-made replies** (10 wrong in realistic ways) run through the same checker with no API calls, so what Zod catches is visible every time
- **Result:** the gallery caught all 10 bad replies with precise reasons. Real runs were **17/17 valid in both modes** — this model almost never goes off-shape, so Zod is insurance rather than something that visibly saves you here. Also found: across 50 questions the correct answer landed at position 0/1/2/3 in 22%/36%/32%/10% — *valid isn't the same as good*, so Step 4.2 should shuffle options in code
- Output: a script proving you can force reliable JSON out of an LLM — and check it

**Step 4.2 — `POST /quiz`** *(done — line-linked explanation in [CODE_EXPLAINED.md](CODE_EXPLAINED.md#step-42--post-quiz))*
- `src/services/quiz.service.ts`: `buildQuizPrompt()` and `checkQuizReply()` moved here from the Step 4.1 script (one implementation, shared by the script and the real endpoint), plus new `generateQuiz(documentId)` — samples 5 chunks (`sampleChunks`, same as 4.1), builds the prompt, calls Gemini in **structured-output mode**, validates with `Quiz.safeParse`
- **Retry:** one real attempt + one retry (`MAX_ATTEMPTS = 2`) — if both fail, a clean `502` instead of looping or crashing
- **Shuffle:** every validated quiz's options are shuffled per question (Fisher–Yates) and `correctIndex` remapped, because Step 4.1 found the model's own placement wasn't uniform (22/36/32/10% across positions 0–3) — corrected in code, not left to the model
- **Validation:** `documentId` required (400 if missing/not a string); rejects the `'all'` sentinel with 400 (a quiz needs one document's chunks in reading order, not a mix); unknown/empty document → 404
- `src/routes/quiz.routes.ts`: thin — `POST /quiz` calls `generateQuiz`, mounted in `app.ts`. Not streamed on purpose (half a JSON object is useless)
- Added a `quiz` pipeline color (blue) and a `failed()` logger (distinct from `rejected`/`notFound`) to `pipelineLogger.ts`
- **Tested live:** happy path (5 valid, shuffled questions, all logged `[1/4]`–`[4/4]`, attempt `1/2` succeeded both times tried); all four bad-input cases (missing, `'all'`, unknown id, non-string) returned the right status; `npm run step4` re-run after the refactor to confirm sharing the functions didn't break the experiment script (gallery still 10/10, a real run still produced a valid quiz)
- Output: a working quiz-generation endpoint with real production habits (validate → retry → shuffle) built in

**Step 4.2F — Frontend: quiz UI** *(done — line-linked explanation in [CODE_EXPLAINED.md](CODE_EXPLAINED.md#step-42f--frontend-quiz-ui))*
- A **"Generate quiz"** button in the chat header, next to the "Searching in" dropdown — shown only when a single real document is active (hidden on the New Chat screen and on "All documents", since a quiz needs one document's chunks in order)
- Clicking it opens an overlay modal: a loading state while `POST /quiz` runs (10–30s), then each question rendered with its 4 options as selectable radio buttons, or a clean error with a "Try again" button if generation failed
- A **"Regenerate"** button gets a fresh quiz for the same document (clears previous selections); closing and reopening starts over
- New files: `types/quiz.ts`, `api/quiz.ts` (not streamed — same reasoning as the backend: a partial quiz can't be rendered), `hooks/useQuiz.ts` (its own hook — a quiz isn't part of the conversation), `components/quiz/QuizModal.tsx`
- Output: quizzes are visible and answerable in the real UI, not just JSON in a response — verified in a real browser (button hidden/shown correctly, 5 questions × 4 options rendered, answers selectable, regenerate resets selections, closes cleanly, zero console errors)

**Step 4.3 + 4.3F — Grading, done together, client-side** *(done — line-linked explanation in [CODE_EXPLAINED.md](CODE_EXPLAINED.md#step-43--43f--checking-answers))*
- **No `POST /quiz/check` was built, on purpose.** `correctIndex` already travels down in the `/quiz` response the browser holds — the server has no separate stored copy of the quiz to check against (no `quizId`, nothing persisted), so a round trip would just be the server comparing two numbers the client already has, with the client fully able to lie about them either way. A trustworthy check needs server-stored quizzes, which is a bigger change than this optional step is meant to be — see the "how it turned out" note in [ai-backend-roadmap.md](ai-backend-roadmap.md) Step 4.3.
- Instead, `QuizModal.tsx` grades entirely in its own state: a **"Check answers"** button locks the radios (`disabled`) and marks every option — the correct one always green (even if unpicked), a wrong pick red — plus a `"N of 5 correct"` score in the footer
- **Regenerate clears grading too** (same effect that already reset picks on a new quiz now also resets `checked`)
- **A real CSS bug found and fixed while testing:** the "you selected this" green highlight (`:has(input:checked)`) has higher specificity than the plain `.quiz-option--incorrect` class, so a wrong-but-selected answer showed green *and* a red ✕ icon at the same time — confusing. Fixed by scoping the selected-highlight to `:has(input:checked:not(:disabled))`, so it steps aside once grading locks the radios and only the correct/incorrect colors apply. Caught by actually looking at a screenshot, not just reading the code.
- Output: DocMind's full loop — upload, chat, quiz, check — all usable end to end in the browser, verified live (locked radios after checking, correct score count, colors correct after the fix, cleared on regenerate, 0 console errors)

**Milestone:** DocMind can generate a quiz from the PDF and grade an answer against it, all through the React UI. *(Reached — 2026-09-23.)*

---

## Phase 5 — Tie It Together

**Step 5.1 — Write it in your own words**
- Answer, without looking anything up: what's an embedding, why store vectors in a DB, what RAG actually solves, how "memory" works under the hood, why stream, why validate LLM output with Zod
- If any answer feels shaky, that's the concept to revisit

**Step 5.2 — Push a clean README**
- One paragraph on the 5 endpoints, an ASCII diagram of both data flows, how to run it locally (backend + frontend)
- Output: a presentable, explainable project — one you can actually click through in a browser, not just curl

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
- Steps marked **F** are frontend — build them right after their paired backend step, using the same endpoint you just finished. There's no separate `topics/` entry for these — the frontend isn't a new AI-backend concept, just the client exercising what you already built.
- For "what do I do right now," check [PROGRESS.md](PROGRESS.md) — it's the single tracker; this file is the reference you come back to for the details of each step.
