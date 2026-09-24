# CLAUDE.md — DocMind (AI-Backend)

Context file for any new Claude session. Read this first, then skim the code. It is the *memory* of the project: what it is, how it's built, why decisions were made, and where work stopped. The *plan* (what's left to build) lives in [project_building_workthrough.md](project_building_workthrough.md) and [PROGRESS.md](PROGRESS.md) — don't duplicate it here.

Keep this file current: see "Keeping this file alive" at the bottom.

---

## 1. Who you're working with and how

- The owner is **Shiv** (GitHub: `sh1v-max`), a job-seeking developer who already knows Node, Express, MongoDB, JWT, Zod and TypeScript. This project exists to **genuinely understand how AI backends work** (embeddings, vector search, RAG, memory, streaming, structured output, queues, agents, workflows) — *not* to ship features. Every step is "learn the concept → build the smallest version → move on".
- **Explain the "why" briefly** whenever a piece of tech is unfamiliar (LangGraph, SSE, Drizzle, async generators, etc.). Shiv is learning by building; a working answer with no reasoning wastes the point.
- **Never run `git commit` or `git push` (or offer to).** Shiv does all commits and pushes personally. Reading git state (`status`, `log`, `diff`) is fine. Opening a PR is done by Shiv in the browser; `gh` is not installed on the main machine.
- Don't fill in `topics/*/NOTES.md` — those are Shiv's own words, written after finishing each topic. `topics/*/README.md` is the reading material to build against. **Exception:** `topics/08-structured-output-zod/NOTES.md` was written by Claude on 2026-09-23, at Shiv's explicit request after being asked to confirm (he was offered "don't write it" / "draft it, you edit" / "just write it" and picked the last one). The standing rule still applies to every other topic, this was a one-off override, not a new default. If asked to fill in another topic's NOTES.md, flag the same tension again rather than assuming the exception carries over.
- Everything stays **free-tier** (Gemini free tier, Neon/Supabase Postgres, Upstash Redis, Render). No card-required services.
- Don't over-build. If a step's output already exists and runs, move on; the roadmap says the same.

## 2. What DocMind is

Upload a PDF → chat with it (with memory) → the reply streams in live → generate a quiz from it → check quiz answers. Five endpoints in the original spec; it's grown a few helper endpoints for history. A separate React frontend exercises each endpoint the way a real client would (not just Postman).

Roadmap phases (details in the walkthrough): 1 Embeddings & vector search · 2 RAG (+ memory) · 3 Streaming · 4 Quiz/structured output · 5 Tie together · 6 Background jobs (BullMQ) · 7 Agents & tool calling · 8 Suspend/resume workflows · 9 Testing & observability · 10 Deploy · 11 Production web-layer reading (GraphQL, JWT, idempotency/multi-tenancy) · 12 Advanced pass.

## 3. Current state (as of 2026-09-23)

- **Done:** Phase 1 (embeddings, pgvector, Drizzle repositories), Phase 2 (PDF upload → chunk → embed → store; `/chat` RAG; conversation memory; session/document history + deletes; ChatGPT-style frontend), **all of Phase 3** — Steps 3.1, 3.2, 3.2F (SSE mechanics, streamed `/chat-stream`, frontend `EventSource`) and 3.3 (multi-document chat).
- **Step 4.1 done (2026-09-21, committed):** Zod quiz schema (`src/schemas/quiz.schema.ts`), `sampleChunks()` in `chunks.repository.ts`, optional `generationConfig` on `generateAnswer()`, and the `npm run step4` experiment script (plain prompt vs Gemini structured-output mode, plus a no-API "bad-reply gallery").
- **Step 4.2 done (2026-09-22):** `POST /quiz` — `src/services/quiz.service.ts` (`generateQuiz`, plus `buildQuizPrompt`/`checkQuizReply` moved here from the Step 4.1 script so both share one implementation) + `src/routes/quiz.routes.ts`, mounted in `app.ts`. Structured-output mode → `Quiz.safeParse` → **retry once** (max 2 attempts) → **shuffle options in code** (Fisher–Yates, remaps `correctIndex`) before returning. Rejects `documentId: 'all'` with 400 (a quiz needs one document, not a mix). Added a `quiz` log theme + `failed()` to `pipelineLogger.ts`. Tested live: happy path (5 shuffled, valid questions) + all 4 bad-input cases (missing/`'all'`/unknown/non-string documentId); `npm run step4` re-run after the refactor to confirm the shared functions still work. **Uncommitted when written** — check `git status`.
- **Step 4.2F done (2026-09-23):** frontend quiz UI — `types/quiz.ts`, `api/quiz.ts` (`generateQuiz`, not streamed), `hooks/useQuiz.ts` (`open/loading/error/quiz/filename`, `generate`/`regenerate`/`close`), `components/quiz/QuizModal.tsx` (an overlay: loading state, error state with retry, 5 questions × 4 radio-button options, a progress counter, regenerate). A "Generate quiz" button was added to `ChatView`'s header (`ClipboardText` icon), shown only when a single real document is active — hidden on the New Chat screen and on "All documents". Wired through `App.tsx` (`useQuiz()` + `handleGenerateQuiz`). New CSS in `App.css` (`.quiz-*` classes), including a mobile variant (icon-only button, full-screen modal). **Tested live in a headless browser:** button correctly hidden/shown across all three states, modal opened with a loading state then a real 5-question quiz, options selectable (progress counter updated), regenerate produced a fresh quiz and cleared selections, close worked, zero console errors — screenshot confirmed it visually matches the rest of the app (same colors/cards/radius as chat bubbles and source cards).
- **Step 4.3/4.3F done (2026-09-23):** grading, built **client-side, no `POST /quiz/check` endpoint** — deliberate, see §9. `QuizModal.tsx` gained a "Check answers" button, a `checked` state that locks the radios and colors each option (correct always green, a wrong pick red), and a score line. Found and fixed a real CSS bug while testing: the "selected" highlight was beating the "incorrect" color on specificity, so a wrong pick showed green *and* red at once — fixed by scoping the selected style to `:not(:disabled)`. Tested live: locked radios, correct score, colors verified via screenshot (caught the bug this way), cleared on regenerate, 0 console errors.
- **Phase 4 is now fully done (4.1, 4.2, 4.2F, 4.3, 4.3F)** — DocMind's whole loop (upload → chat → quiz → check) works end to end in the browser. **Next up:** Phase 5 (tie it together, write it up in your own words) or Phase 6 (background jobs / BullMQ). See [PROGRESS.md](PROGRESS.md) and the walkthrough.
- **Backend restructure done (2026-09-20):** the 449-line `src/index.ts` was split into `app.ts` + `config.ts` + `routes/` + `services/` + `utils/` (see §6), with **no behavior change**. Verified: `tsc --noEmit` clean; all 400/404 validation paths, `/chat` and `/chat-stream` happy paths (incl. history persistence, cleaned up afterwards), and the bad-API-key failure paths (503 for `/chat`, `event: error` frame for the stream, same terminal error block) behave as before. The frontend was not touched.
- **Git:** the checked-out branch is `zod-branch` (last commit when written: `ea2d6a5 "quiz frontend build"`, 2026-09-23). `Streaming-branch` was merged into `main` through PR #1; Step 3.3, all of Step 4.1, Step 4.2 (backend) and Step 4.2F (frontend) are committed. **Uncommitted when written:** Step 4.3/4.3F's grading changes to `QuizModal.tsx`/`App.css` (no new files — no endpoint was added) and the latest docs updates. Shiv commits everything himself — run `git status` to see what's pending.
- **Topic notes:** `topics/07-streaming-sse/NOTES.md` was written (short, in Shiv's voice) on 2026-09-21 at his request. READMEs now exist for topics 07, 08 (structured output) and 09 (BullMQ). NOTES.md for 08+ are still Shiv's to fill in.

## 4. Stack

| Layer | Choice |
|---|---|
| Runtime / lang | Node.js, TypeScript (`ts-node-dev`), CommonJS (`"type": "commonjs"`) |
| API | Express 5, `cors`, `multer` (memory storage), `express.json()` |
| DB | Postgres with **pgvector** (Neon), via **Drizzle ORM** + `pg` Pool |
| PDF | `pdf-parse` v2 (`new PDFParse(...)`, `getText()`) — needs a real text layer, no OCR |
| LLM | Gemini REST API, called with plain `fetch` (no SDK): `gemini-flash-lite-latest` for generation (`generateContent` and `streamGenerateContent?alt=sse`) |
| Embeddings | `gemini-embedding-001`, **3072 dimensions** |
| Validation | **Zod 4** (`zod` ^4.6) — validates LLM output (the quiz), same idea as validating request bodies |
| Frontend | React 19 + Vite 8 + TypeScript, `@phosphor-icons/react`, oxlint. No state library, no router |

⚠️ **Doc/code mismatch to remember:** the roadmap and walkthrough text still say `text-embedding-004` / 768 dimensions in Phase 1 (that's what Step 1.1/1.2 originally used). The **running code uses `gemini-embedding-001` and `vector(3072)`** ([schema.ts](src/db/schema.ts), [embeddings.service.ts](src/services/embeddings.service.ts)). Trust the code.

## 5. Running it

```bash
npm install                 # backend deps (repo root)
cp .env.example .env        # then fill in values
npm run dev                 # API on http://localhost:3000 (ts-node-dev --respawn --transpile-only)
cd frontend && npm install && npm run dev   # UI on http://localhost:5173
npx tsc --noEmit            # typecheck backend (dev script uses --transpile-only, so type errors don't stop it)
```

`.env` keys: `GEMINI_API_KEY`, `DATABASE_URL` (Neon Postgres connection string), `FRONTEND_URL` (CORS origin; defaults to `http://localhost:5173`). `.env` is gitignored and **copied between machines by hand**. The `package.json` scripts are `dev`, `step3`, `step4` and `test` (`step1`/`step2` were deleted from it; run those files directly with `npx ts-node src/stepN-….ts` if needed). The `stepN` files are standalone learning scripts, not part of the app. **`step2` and `step3` are destructive** (they DROP/DELETE the `chunks` table) — never re-run them against the live database; note `step3` is *still* an npm script and is worth removing. `step1` and `step4` are safe (step4 is read-only). **`package.json` must stay strict JSON** — a `//` comment in it breaks every npm command (`EJSONPARSE`).

Schema changes: `drizzle.config.ts` points at `src/db/schema.ts` (output `./drizzle`). There is no committed migrations folder in the repo right now; the tables were created against Neon directly, and equivalent SQL is kept in comments beside each table in `schema.ts`.

Tests: none yet (Phase 9).

## 6. Repository layout

```
src/
  index.ts                     ~7 lines: load dotenv, app.listen(). Nothing else — don't grow it
  app.ts                       builds the Express app (json, cors, health route, mounts the routers); no listen(), so tests can import it
  config.ts                    HISTORY_LIMIT, PORT, FRONTEND_URL, CONNECTION_ERROR_MESSAGE, ALL_DOCUMENTS ('all') + ALL_DOCUMENTS_LABEL
  routes/                      thin: read the request, call a service/repository, write the response
    documents.routes.ts        GET /documents, DELETE /documents/:id, POST /upload (multer lives here)
    sessions.routes.ts         GET /sessions, GET /sessions/:id/messages, DELETE /sessions/:id
    chat.routes.ts             POST /chat, GET /chat-stream (steps 6-7 differ per route, so they stay here)
    quiz.routes.ts             POST /quiz — thin, calls generateQuiz(); not streamed (a quiz needs the complete, validated JSON)
  services/
    chat.service.ts            buildChatPrompt() + prepareChat() = steps 1-5 of the chat pipeline, shared by both chat routes
    quiz.service.ts            generateQuiz(): sample -> prompt -> generate (structured mode) -> validate -> retry once -> shuffle options. Also buildQuizPrompt()/checkQuizReply(), shared with npm run step4
    ingestion.service.ts       ingestPdf(): parse -> chunk -> embed + store -> document row (steps 2-5 of upload)
    embeddings.service.ts      getEmbedding(text) -> number[3072]
    llm.service.ts             generateAnswer(prompt, generationConfig?) and streamAnswer(prompt) (async generator). generationConfig is how structured-output (JSON) mode is switched on
  repositories/
    chunks.repository.ts       insertChunk, sampleChunks (evenly spaced chunks of one document, for quizzes — no search), searchSimilar (cosine distance), deleteChunksByDocumentId
    documents.repository.ts    insertDocument, listDocuments, deleteDocument
    chatMessages.repository.ts insertMessage, getRecentMessages, getMessagesForSession, listSessions, deleteSession, deleteMessagesByDocumentId
  db/client.ts                 Pool + drizzle instance (the `db` every repository imports)
  db/schema.ts                 documents, chunks, chatMessages tables
  utils/
    errors.ts                  summarizeError(), withErrorHandling() (wraps /chat, /chat-stream and /quiz)
    chunkText.ts               ~500-word splitter
    pipelineLogger.ts          chalk-coloured step/timing/preview logging used by every route (themes: upload cyan, chat magenta, quiz blue); also failed() for "retries exhausted" style failures
  schemas/
    quiz.schema.ts             Zod QuizQuestion / Quiz (exactly 5 questions × exactly 4 options, correctIndex 0-3, options all different) + the same shape as Gemini's responseSchema
  step1-embeddings.ts, step2-pgvector.ts, step3-drizzle.ts   Phase 1 learning scripts (⚠️ step2 DROPs and step3 DELETEs the chunks table — never re-run against the live DB)
  step4-quiz-zod.ts            Step 4.1 experiment (`npm run step4 [documentId] [runs]`) — read-only, safe to re-run; spends a few Gemini calls
frontend/src/
  api/         client.ts, documents.ts, chat.ts (sendChatMessage + streamChatMessage), sessions.ts, quiz.ts (generateQuiz, not streamed)
  types/       document.ts, chat.ts, quiz.ts (QuizQuestion/Quiz, mirrors the backend schema)
  hooks/       useDocuments.ts, useSessions.ts, useChat.ts, useQuiz.ts (its own hook — a quiz isn't part of the conversation)
  utils/       format.ts, logger.ts   (tagged console logger: [DocMind:<scope>])
  components/  common/, sidebar/, chat/, documents/, quiz/ (QuizModal.tsx — overlay: radio buttons per question, "Check answers" grades client-side, no /quiz/check call)
  App.tsx      thin orchestrator
topics/        16 concept folders (README = reading, NOTES = Shiv's own notes) + advanced/ + OVERVIEW.md
```

Rules that matter: **nothing outside `repositories/` touches SQL/Drizzle directly** (routes/services call repositories; repositories call `db`), and **services never touch `req`/`res`** — `prepareChat()` returns `{ ok: false, status, error }` and the route sends the response. That's what lets the same service be reused by a background worker later.

Note: `/upload` and the read/delete routes are *not* wrapped in `withErrorHandling` (only `/chat` and `/chat-stream` are) — that's pre-existing behavior, kept as-is during the refactor. Also, a bad `GEMINI_API_KEY` currently produces the "check your internet connection" message, because `withErrorHandling` doesn't distinguish failure types yet.

## 7. API surface

| Method & path | What it does |
|---|---|
| `GET /` | health/hello |
| `POST /upload` | multipart PDF → parse → `chunkText` (~500 words) → embed each → `insertChunk` (tagged `documentId`) → insert `documents` row |
| `GET /documents` | list uploaded documents |
| `DELETE /documents/:documentId` | delete chunks + all chat messages for it + the document row |
| `POST /chat` | JSON `{ documentId?, message, sessionId? }` → 7-step pipeline (below) → `{ sessionId, answer, sources }`. `documentId` omitted/empty/`'all'` = search every document; each source is `{ content, distance, documentId, filename }` |
| `GET /chat-stream` | same pipeline, but SSE; query params `documentId?`, `message`, `sessionId` (a non-string/repeated `documentId` → 400) |
| `GET /sessions` | one summary per session (`sessionId, documentId, filename, title, lastMessage, lastMessageAt, messageCount`), newest first |
| `GET /sessions/:sessionId/messages` | full transcript, oldest first |
| `DELETE /sessions/:sessionId` | delete one conversation's messages (document untouched) |
| `POST /quiz` | JSON `{ documentId }` (required, must be a real document — `'all'` → 400) → `{ documentId, quiz }`, `quiz` = 5 validated `QuizQuestion`s with shuffled options. Not streamed |

Chat pipeline (both routes): embed question → `searchSimilar(top 3, one document or all — see §8)` → load last `HISTORY_LIMIT = 8` messages → save user message → `buildChatPrompt(context, history, message)` → generate → save assistant reply.

### `/chat-stream` SSE protocol (the frontend depends on this exactly)

| Event | Payload | When |
|---|---|---|
| `meta` (named) | `{ sessionId, sources }` | once, first |
| default (unnamed `data:`) | `{ text }` | per piece |
| `done` (named) | `{}` | after the full reply is saved |
| `error` (named) | `{ error }` | any failure |

Only the last-stage failures are special: a failed DB save of the assistant reply is logged but does **not** emit `error` (the user already has the answer).

## 8. Data model

- `documents(id text PK [uuid], filename, file_size_bytes, text_length, chunk_count, created_at)`
- `chunks(id serial PK, content, embedding vector(3072), document_id text)`
- `chat_messages(id serial PK, session_id, document_id NOT NULL, role 'user'|'assistant', content, created_at)`
- **There is no `sessions` table.** A session is just a `session_id` shared by a group of `chat_messages` rows; history is *derived* (`listSessions()` groups and reduces). A session's `title` is its first user message.
- **Scope (Step 3.3):** `chat_messages.document_id` holds either a real document id or the sentinel **`'all'`** (`ALL_DOCUMENTS` in `config.ts`) — chosen over making the column nullable so the live Neon table didn't need altering. A missing/empty `documentId` in a request also means "all". A session's scope is fixed by that value, so the frontend's scope dropdown starts a *new* chat when switched. `searchSimilar(embedding, limit, documentId?)` returns `{ content, distance, documentId, filename }` (`LEFT JOIN documents`); the all-mode branch lives in `prepareChat()` (`searchAll`).
- **Orphan chunks:** the live database has 8 groups of `chunks` rows with no matching `documents` row (test uploads from before Step 2.2, some are resume text). They're invisible in the UI. All-documents search skips them (`documents.id IS NOT NULL` in `searchSimilar`); single-document mode does not, so an old session pinned to an orphan id still works. They have **not** been deleted — cleanup would be `DELETE FROM chunks WHERE document_id NOT IN (SELECT id FROM documents)`, Shiv's call.
- **Known Step 3.3 tradeoff:** top-3 chunks are shared across all PDFs, and "meta" questions ("which documents do you have?") can't be answered by chunk search. Routing (Phase 7) is the real fix.

## 9. Decisions and gotchas worth remembering

**Streaming**
- `/chat-stream` is **GET** because the browser `EventSource` can only send GET; all inputs are query params.
- `streamAnswer()` is an `async function*`: it reads Gemini's byte stream with `getReader()` + `TextDecoder`, **normalizes `\r\n` → `\n` on the whole buffer** (Gemini terminates SSE lines with `\r\n`; normalizing per-chunk would miss a `\r\n` split across two reads), splits on the blank-line event boundary, and keeps the trailing partial event in the buffer for the next read. If streaming ever emits nothing, look here first.
- Gemini REST streaming is a *different method* (`streamGenerateContent?alt=sse`), not a `stream: true` flag.
- `EventSource` cannot read the body of a non-200 response — it only sees "connection error". So the stream route reports failures as an in-band `event: error` frame with status 200, not an HTTP error code. That's why `withErrorHandling(label, handler, { sse: true })` exists.
- Frontend: the `error` listener fires for both our own `event: error` frames (has `e.data`) and raw connection failures (no `e.data`) — handled as two cases.
- React: functions passed to `setMessages(prev => ...)` must be pure (StrictMode calls them twice in dev). The streaming bubble is always "the last message in `prev`", never a variable mutated inside the callback.
- UI keeps "Thinking…" until the assistant bubble has real text; the empty placeholder bubble (sources arrived, no text yet) is hidden.

**Errors**
- `withErrorHandling` wraps `/chat` and `/chat-stream`. Plain routes return `503 { error }` with a "check your internet connection" message; stream routes send an `event: error` frame.
- `summarizeError()` exists because Drizzle failed-query errors embed the SQL **and every bound parameter** — for vector search that's all 3072 embedding numbers, burying the real cause. It prints the first line, the `cause` chain (where `ECONNRESET` etc. live), and the first in-repo stack frame. Don't `console.error(err)` raw in routes.
- The prompt is built in one place, `buildChatPrompt()`, shared by `/chat` and `/chat-stream`. Change wording there, once.

**Persistence**
- Frontend stores only the active `sessionId` in `localStorage` (`docmind:activeSessionId`), never messages; on load it's cross-checked against `GET /sessions` and the transcript re-fetched. A refresh resumes the same conversation.

**Security hygiene**
- `.env` and `.history/` (VS Code Local History snapshots every saved file, including `.env`) are gitignored. A real secret leak happened through `.history` earlier — never track either, never print `.env` contents. Rotate the Gemini key / DB password if they're ever exposed.
**Structured output (Phase 4)**
- **Quiz grading (Step 4.3/4.3F) is client-side, no `POST /quiz/check`:** quizzes aren't persisted server-side (no `quizId`, no table), so the server has no independent copy of "the" quiz to check an answer against — a check endpoint here would just be comparing two numbers the client already has, with the client equally able to lie either way. `correctIndex` already ships in the `/quiz` response, so `QuizModal.tsx` grades itself: a `checked` state locks the radios (`disabled`) and colors each option. **CSS gotcha to remember:** the "you selected this" highlight (`.quiz-option:has(input:checked...)`) has higher specificity than a plain `.quiz-option--incorrect` class — without scoping it to `:not(:disabled)`, a wrong-but-selected answer shows green *and* red at once. If a future `:has()`-based state class stops applying once another class is added, check specificity/source order first, not the component logic.
- **Structured output (Step 4.1):** two separate jobs — *ask* for a shape (prompt, or Gemini `generationConfig: { responseMimeType: 'application/json', responseSchema }`, which takes an OpenAPI-style schema with **uppercase** types) and *verify* it (Zod `safeParse`). Never skip the verify half. With `gemini-flash-lite-latest` the model was valid 17/17 times in both modes, so Zod is insurance here; the script's "bad-reply gallery" is what shows it working. A quiz needs broad coverage of one document (`sampleChunks`), not a similarity search, and must not stream (half a JSON object is useless).
- **`POST /quiz` (Step 4.2):** `generateQuiz()` always uses structured-output mode (not the plain prompt — 4.1 showed both work, structured is the safer default), validates with `Quiz.safeParse`, and retries **once** (2 attempts total, then a clean `502` — never loop). **Valid ≠ good, so it's not left to the model:** the correct answer's position wasn't uniform (22/36/32/10% across 50 questions in 4.1's testing), so every validated quiz's options are **shuffled in code** (Fisher–Yates per question, `correctIndex` remapped to match) before the response goes out. `buildQuizPrompt`/`checkQuizReply` live in `quiz.service.ts`, not duplicated in the Step 4.1 script — it imports them.
**Environment gotchas**
- **Network gotcha (seen 2026-09-21):** if DB calls fail with `getaddrinfo ENOTFOUND ...neon.tech` while other sites work, the *current network's DNS resolver* is refusing that hostname (it happened on a hotspot: resolver `Query refused`, while 8.8.8.8 resolved it fine). Not a code bug — switch network or set DNS to 8.8.8.8/1.1.1.1. For a one-off test without changing system settings, preload a small shim that resolves `*.neon.tech` via `dns.Resolver` (kept out of the repo).

## 10. Code conventions in this repo

- Heavily commented on purpose — comments explain *why* and teach the concept, in a conversational tone. Match that density when adding code. Add a `Step X.Y —` marker comment on new step-related code (as existing code does).
- Routes log through `pipelineLogger` (`pipelineStart`, `step('chat', n, total, ...)`, `detail`, `timing`, `preview`, `pipelineEnd`) so a request can be followed in the terminal.
- Frontend logs through `utils/logger.ts` with a scope (`log.info('useChat', ...)`).
- Frontend: `api/` = fetch only, `hooks/` = state + async logic, `components/` = presentation, `App.tsx` = wiring.
- TypeScript strict; run `npx tsc --noEmit` after backend edits.
- **Logging is a feature — never lose it.** Refactors must preserve every `pipelineLogger` call, the `withErrorHandling` / `summarizeError` error block (cause chain + `where:` frame), the in-stream `console.error`s, and the frontend `[DocMind:<scope>]` logger. After any refactor, deliberately break things (wifi off, bad `documentId`, empty message, bad API key) and confirm the same error output appears. Errors currently go to the terminal only; writing full errors to a gitignored `logs/errors.log` (JSON lines, with `key=` redaction and long values clipped) was discussed and **deliberately deferred** — add it later when errors get complex, not before.
- **Structure rule:** new features get their own route + service file from the start (e.g. `routes/quiz.routes.ts` + `services/quiz.service.ts`); `index.ts`/`app.ts` don't grow. Split an existing file only when it passes ~200–250 lines or does two unrelated jobs — no speculative folders.

## 11. Doc map (which file is for what)

| File | Purpose | Who updates |
|---|---|---|
| `CLAUDE.md` (this) | Project memory for new Claude sessions | Claude, at the end of a work session |
| [project_building_workthrough.md](project_building_workthrough.md) | Phase-by-phase build order + implementation details of what was built | Claude, when a step is finished |
| [ai-backend-roadmap.md](ai-backend-roadmap.md) | The original learning plan with resources; done steps get ✅ + a "how it turned out" note | Claude, when a step is finished |
| [PROGRESS.md](PROGRESS.md) | The tracker — single source of truth for "what next" | Claude, when a topic finishes |
| [CODE_EXPLAINED.md](CODE_EXPLAINED.md) | Deep, line-linked explanation of every file and step (1.1 → 4.3F): why, what, how. Written for Shiv to re-learn from. Link line numbers can drift as code changes — function names are the reliable anchor | Claude, when a step is finished (add the new step's section) and after big refactors (re-check links) |
| [posts/](posts) | Shiv's daily "learning in public" record. `postN.md` = a source-notes file for that day's work, handed to another Claude chat that turns it into a LinkedIn post and a Twitter/X post. `posts/` holds `post1.md`–`post9.md`. **Format to follow (Shiv's own posts 1–7, now also 8–9), ~4–7 KB, no longer than posts 4–5:** (1) title `# AI Backend Learning Journey — Day N Context (for LinkedIn + Twitter)`; (2) `## Instructions for Claude` — use the `post-writer-sms` skill, tone (genuine, technical but accessible, no buzzwords), who Shiv is, "see post1–post(N-1) for continuity" with a one-line series recap, LinkedIn = longer/narrative vs Twitter = tight thread, and the strongest angle; (3) `## What I built today` — first-person narrative sections with the *why*, small code snippets, and "a real gotcha, not a hypothetical one"; (4) `## The bigger takeaway` (one thesis paragraph); (5) `## What's next`; then short extras Shiv's 1–7 lack but are worth keeping: `## Numbers you can quote`, `## Don't overclaim`, `## Hook ideas`. Do **not** write a bullet-fragment "notes" file (the first draft of post 8 was rejected as too long/timeline-style, the second as too thin — the narrative + instructions block is what makes the writer chat useful). Only write a new `postN.md` when Shiv asks; scope it to *that day's* work, don't mention which machine the work was on, and keep private data (resume text, keys, email) out | Claude, on request |
| [README.md](README.md) | Short intro, setup, two-machine git workflow | Occasionally |
| `topics/NN-*/README.md` / `NOTES.md` | Reading material / **Shiv's own notes (don't write)** | Shiv |

## 12. Two-machine workflow

Shiv sometimes works on two laptops. Git is the only thing that carries code; `.env` is copied manually. One branch per machine/task, `git pull --rebase` at the start of a session, push at the end, merge to `main` via PR, then `git fetch && git rebase origin/main` on the other branch. **This file is in the repo, so it syncs across laptops — the per-machine Claude auto-memory does not.** Anything a future session needs must be written here, not left in chat.

## 13. Work log (newest first — append an entry each session)

- **2026-09-23 (topic 08 notes)** — Wrote `posts/post10.md` (backend-focused per Shiv's request, kept frontend to one paragraph). Then flagged the standing "don't write NOTES.md" rule when asked to write topic 08's notes; Shiv explicitly chose to override it, so wrote `topics/08-structured-output-zod/NOTES.md` covering all of Phase 4 (ask vs verify, the schema, 17/17 real validity, the bad-reply gallery, the answer-position shuffle fix, sampleChunks vs searchSimilar, retry-once, and the no-check-endpoint decision) in first person, casual style. Recorded the exception in §1 so it isn't mistaken for a new default.
- **2026-09-23 (Step 4.3/4.3F)** — Quiz grading, built client-side (no `POST /quiz/check` — quizzes aren't stored server-side, so there's nothing independent to check an answer against; decided this deliberately with Shiv before building). Added a "Check answers" button, `checked` state, locked/disabled radios post-check, correct/incorrect coloring + icons, and a score line to `QuizModal.tsx`. Found and fixed a real bug by looking at a screenshot, not just reading code: the pre-existing "selected" CSS style beat the new "incorrect" color on specificity, showing green+red at once on a wrong pick — fixed with `:not(:disabled)`. Tested live in a headless browser both before and after the fix (locked radios, correct score count, colors correct post-fix, grading cleared on regenerate, 0 console errors). Updated the walkthrough, roadmap (added a "how it turned out" note explaining the no-endpoint decision), PROGRESS, and CODE_EXPLAINED.md (new §4.3/4.3F section). **Phase 4 is now fully done** — upload → chat → quiz → check all work end to end in the browser. Next: Phase 5 or Phase 6.
- **2026-09-23 (Step 4.2F)** — Frontend quiz UI: `types/quiz.ts`, `api/quiz.ts` (`generateQuiz`, not streamed), `hooks/useQuiz.ts`, `components/quiz/QuizModal.tsx` (loading/error/question states, radio buttons per question, regenerate). "Generate quiz" button added to `ChatView`'s header, shown only for a single real document (not New Chat, not "All documents"). New `.quiz-*` CSS in `App.css`, including a mobile variant. Tested live in a headless browser: button visibility correct in all three states, real 5-question quiz rendered and answerable, regenerate cleared selections, close worked, 0 console errors; screenshot confirmed visual consistency with the rest of the app. Phase 4's required steps (4.1, 4.2, 4.2F) are now all done. Next: optional Step 4.3/4.3F, or move to Phase 5/6.
- **2026-09-22 (Step 4.2)** — Built `POST /quiz`: `quiz.service.ts` (`generateQuiz`, plus `buildQuizPrompt`/`checkQuizReply` moved out of the Step 4.1 script so both share one implementation) + `quiz.routes.ts`, mounted in `app.ts`. Structured-output mode → `Quiz.safeParse` → retry once (max 2 attempts, then a clean 502) → **shuffle options in code** (Fisher–Yates, remaps `correctIndex`) — the fix Step 4.1's answer-position finding (22/36/32/10%) called for. Rejects `documentId: 'all'` (400) since a quiz needs one document's chunks in order. Added a `quiz` pipelineLogger theme (blue) and a `failed()` helper. Tested live on a spare port: happy path (5 shuffled, valid questions, full `[1/4]`-`[4/4]` log trace) and all 4 bad-input cases (missing/`'all'`/unknown/non-string documentId) returned the right status; re-ran `npm run step4` after the refactor to confirm the shared functions still work (gallery 10/10, a real run still valid). Updated the walkthrough, roadmap, PROGRESS (topic 08 now ✅). Next: Step 4.2F (Generate-quiz button + UI), then add this step's section to CODE_EXPLAINED.md.
- **2026-09-22 (posts)** — Compared Shiv's posts 1–7 with my first drafts of 8–9: 1–7's skeleton (instructions-for-the-writer block, narrative with the why, "bigger takeaway", "what's next") is better for the writer chat; my drafts lacked the instructions and story arc but had useful numbers / don't-overclaim / hook-ideas sections. Rewrote `post8.md` and `post9.md` as a hybrid and recorded the format in the §11 doc-map row.
- **2026-09-22** — Wrote `posts/post9.md` (short source notes, same format as post8). Fixed `package.json`: `//` comments Shiv added around `step1`/`step2` made npm fail with `EJSONPARSE`; removed those two lines (kept valid JSON). Audited CLAUDE.md and CODE_EXPLAINED.md against the code and fixed what had drifted: stale npm-script mentions, git/branch state, `config.ts` description, missing `zod`/`schemas/` in the file map, the `generationConfig` note, glossary. All 321 CODE_EXPLAINED links re-verified.
- **2026-09-21 (Step 4.1)** — Structured output with Zod. Installed `zod` (4.6.5); added `src/schemas/quiz.schema.ts`, `sampleChunks()`, optional `generationConfig` on `generateAnswer()`, `npm run step4` (plain vs structured-output mode, two-stage check `JSON.parse` → `Quiz.safeParse`, a no-API bad-reply gallery of 11 samples, and a correct-answer-position tally). Results: gallery caught 10/10 bad replies; real runs 17/17 valid in both modes; correct-answer positions 22/36/32/10% → shuffle in 4.2. Hit a DNS problem mid-step (network resolver refusing the Neon hostname; not a code bug — see §9). Wrote topic READMEs for 08 and 09 and a short 07 NOTES.md at Shiv's request; added the Step 4.1 section to CODE_EXPLAINED.md (321 links verified). Next: Step 4.2.
- **2026-09-20 (Step 3.3)** — Multi-document chat: `documentId` optional (omitted/`'all'` = every document), `searchSimilar` returns `documentId` + `filename`, `prepareChat` branches on `searchAll` (`[Source: file]`-labelled chunks + a citation instruction in `buildChatPrompt`), `listSessions` labels all-docs sessions "All documents"; frontend "All documents (N)" chip + "Searching in" header dropdown + filenames on sources. Found orphan chunks in the DB and excluded them from all-mode (see §8). Tested with real requests for every case and the real UI in a headless browser (no console errors); throwaway sessions deleted. Added the Step 3.3 section to CODE_EXPLAINED.md (298 links verified). Next: Phase 4 (Zod quiz).
- **2026-09-20 (earlier)** — Wrote [CODE_EXPLAINED.md](CODE_EXPLAINED.md): the full line-linked walkthrough of Steps 1.1–3.2 (all backend + frontend files, the SSE protocol, error/logging design, a request traced end to end, known limitations). All 276 line links were machine-checked against the files. Found while writing it: `npm run step2` (`DROP TABLE chunks`) and `npm run step3` (`DELETE FROM chunks`) would wipe the real chunks table — documented as "don't re-run". `format.ts` helpers and the non-streaming `sendChatMessage` are currently unused.
- **2026-09-20 (later)** — Split `index.ts` into routes/services/utils/app/config ahead of Step 3.3 (chat pipeline steps 1-5 now live once in `prepareChat()`; upload pipeline in `ingestPdf()`), kept all logging intact, smoke-tested every route and the failure paths. Decided: error logging stays terminal-only for now (file logging deferred); no more refactor passes — new features get their own route + service files. Next: Step 3.3.
- **2026-09-20** — Finished Phase 3 streaming: `/chat-stream`, `streamAnswer()`, shared `buildChatPrompt()`, `withErrorHandling()`/`summarizeError()`, frontend `EventSource` wrapper + streaming chat UI. Fixed Gemini `\r\n` parsing and a stream-response conflict (`0568597`). Deleted the throwaway `/tick` route. Updated walkthrough, roadmap, PROGRESS, README (added the two-machine workflow section). Discussed git workflow (rebase vs merge, one branch per laptop). Created this file. Next: Step 3.3.
- **2026-09-18** — Step 2.5: `GET /sessions`, `GET /sessions/:id/messages`, delete endpoints, ChatGPT-style frontend, `localStorage` session persistence, frontend folder restructure, tagged logger.
- **2026-09-17** — Step 2.4: `chat_messages` table + repository, `/chat` rewritten with memory, RAG notes.
- **Earlier** — Phase 1 and Steps 2.1–2.3 (embeddings, pgvector, Drizzle, PDF upload, RAG `/chat`, first frontend).

## 14. Keeping this file alive

At the end of every work session, before Shiv ends the chat:
1. Update **§3 Current state** (what's done, what's next, git/branch status).
2. Add a dated line to **§13 Work log**.
3. Add any new decision/gotcha to **§9**, any new route to **§7**, any schema change to **§8**.
4. Update the walkthrough / roadmap / PROGRESS if a step finished, and add that step's section to [CODE_EXPLAINED.md](CODE_EXPLAINED.md) (same format: why / what / how, with `[file:lines](path#Lx-Ly)` links — verify the links resolve).
5. Keep it factual and verifiable against the code — if this file and the code disagree, the code wins; fix the file.
