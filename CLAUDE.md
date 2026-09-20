# CLAUDE.md — DocMind (AI-Backend)

Context file for any new Claude session. Read this first, then skim the code. It is the *memory* of the project: what it is, how it's built, why decisions were made, and where work stopped. The *plan* (what's left to build) lives in [project_building_workthrough.md](project_building_workthrough.md) and [PROGRESS.md](PROGRESS.md) — don't duplicate it here.

Keep this file current: see "Keeping this file alive" at the bottom.

---

## 1. Who you're working with and how

- The owner is **Shiv** (GitHub: `sh1v-max`), a job-seeking developer who already knows Node, Express, MongoDB, JWT, Zod and TypeScript. This project exists to **genuinely understand how AI backends work** (embeddings, vector search, RAG, memory, streaming, structured output, queues, agents, workflows) — *not* to ship features. Every step is "learn the concept → build the smallest version → move on".
- **Explain the "why" briefly** whenever a piece of tech is unfamiliar (LangGraph, SSE, Drizzle, async generators, etc.). Shiv is learning by building; a working answer with no reasoning wastes the point.
- **Never run `git commit` or `git push` (or offer to).** Shiv does all commits and pushes personally. Reading git state (`status`, `log`, `diff`) is fine. Opening a PR is done by Shiv in the browser; `gh` is not installed on the main machine.
- Don't fill in `topics/*/NOTES.md` — those are Shiv's own words, written after finishing each topic. `topics/*/README.md` is the reading material to build against.
- Everything stays **free-tier** (Gemini free tier, Neon/Supabase Postgres, Upstash Redis, Render). No card-required services.
- Don't over-build. If a step's output already exists and runs, move on; the roadmap says the same.

## 2. What DocMind is

Upload a PDF → chat with it (with memory) → the reply streams in live → generate a quiz from it → check quiz answers. Five endpoints in the original spec; it's grown a few helper endpoints for history. A separate React frontend exercises each endpoint the way a real client would (not just Postman).

Roadmap phases (details in the walkthrough): 1 Embeddings & vector search · 2 RAG (+ memory) · 3 Streaming · 4 Quiz/structured output · 5 Tie together · 6 Background jobs (BullMQ) · 7 Agents & tool calling · 8 Suspend/resume workflows · 9 Testing & observability · 10 Deploy · 11 Production web-layer reading (GraphQL, JWT, idempotency/multi-tenancy) · 12 Advanced pass.

## 3. Current state (as of 2026-09-20)

- **Done:** Phase 1 (embeddings, pgvector, Drizzle repositories), Phase 2 (PDF upload → chunk → embed → store; `/chat` RAG; conversation memory; session/document history + deletes; ChatGPT-style frontend), **Phase 3 Steps 3.1, 3.2, 3.2F** (SSE mechanics, streamed `/chat-stream`, frontend `EventSource`).
- **Next up:** **Step 3.3 — multi-document chat** ("all PDFs" as default, one PDF as override). Full breakdown in the roadmap. Then Phase 4 (quiz + Zod). See [PROGRESS.md](PROGRESS.md) for the tracker.
- **Git:** working branch is `Streaming-branch` (branched from `main`, one commit ahead at last check: `0568597 gemini response conflict`). Shiv was opening a PR into `main`. The throwaway `/tick` route deletion and the docs updates were made **uncommitted** after that — Shiv commits them himself. Run `git status` to see what's pending.
- `topics/07-streaming-sse/NOTES.md` is still the empty template — Shiv fills it in himself.

## 4. Stack

| Layer | Choice |
|---|---|
| Runtime / lang | Node.js, TypeScript (`ts-node-dev`), CommonJS (`"type": "commonjs"`) |
| API | Express 5, `cors`, `multer` (memory storage), `express.json()` |
| DB | Postgres with **pgvector** (Neon), via **Drizzle ORM** + `pg` Pool |
| PDF | `pdf-parse` v2 (`new PDFParse(...)`, `getText()`) — needs a real text layer, no OCR |
| LLM | Gemini REST API, called with plain `fetch` (no SDK): `gemini-flash-lite-latest` for generation (`generateContent` and `streamGenerateContent?alt=sse`) |
| Embeddings | `gemini-embedding-001`, **3072 dimensions** |
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

`.env` keys: `GEMINI_API_KEY`, `DATABASE_URL` (Neon Postgres connection string), `FRONTEND_URL` (CORS origin; defaults to `http://localhost:5173`). `.env` is gitignored and **copied between machines by hand**. There are also `step1/2/3` scripts (`npm run step1`…) — the standalone Phase 1 learning scripts, not part of the app.

Schema changes: `drizzle.config.ts` points at `src/db/schema.ts` (output `./drizzle`). There is no committed migrations folder in the repo right now; the tables were created against Neon directly, and equivalent SQL is kept in comments beside each table in `schema.ts`.

Tests: none yet (Phase 9).

## 6. Repository layout

```
src/
  index.ts                     Express app: all routes, chunkText(), buildChatPrompt(), withErrorHandling()
  db/client.ts                 Pool + drizzle instance (the `db` every repository imports)
  db/schema.ts                 documents, chunks, chatMessages tables
  repositories/
    chunks.repository.ts       insertChunk, searchSimilar (cosine distance), deleteChunksByDocumentId
    documents.repository.ts    insertDocument, listDocuments, deleteDocument
    chatMessages.repository.ts insertMessage, getRecentMessages, getMessagesForSession, listSessions, deleteSession, deleteMessagesByDocumentId
  services/
    embeddings.service.ts      getEmbedding(text) -> number[3072]
    llm.service.ts             generateAnswer(prompt) and streamAnswer(prompt) (async generator)
  utils/pipelineLogger.ts      chalk-coloured step/timing/preview logging used by every route
  step1-embeddings.ts, step2-pgvector.ts, step3-drizzle.ts   Phase 1 learning scripts
frontend/src/
  api/         client.ts, documents.ts, chat.ts (sendChatMessage + streamChatMessage), sessions.ts
  types/       document.ts, chat.ts
  hooks/       useDocuments.ts, useSessions.ts, useChat.ts
  utils/       format.ts, logger.ts   (tagged console logger: [DocMind:<scope>])
  components/  common/, sidebar/, chat/, documents/
  App.tsx      thin orchestrator
topics/        16 concept folders (README = reading, NOTES = Shiv's own notes) + advanced/ + OVERVIEW.md
```

Rule that matters: **nothing outside `repositories/` touches SQL/Drizzle directly.** Routes call repositories; repositories call `db`.

## 7. API surface

| Method & path | What it does |
|---|---|
| `GET /` | health/hello |
| `POST /upload` | multipart PDF → parse → `chunkText` (~500 words) → embed each → `insertChunk` (tagged `documentId`) → insert `documents` row |
| `GET /documents` | list uploaded documents |
| `DELETE /documents/:documentId` | delete chunks + all chat messages for it + the document row |
| `POST /chat` | JSON `{ documentId, message, sessionId? }` → 7-step pipeline (below) → `{ sessionId, answer, sources }` |
| `GET /chat-stream` | same pipeline, but SSE; query params `documentId`, `message`, `sessionId` |
| `GET /sessions` | one summary per session (`sessionId, documentId, filename, title, lastMessage, lastMessageAt, messageCount`), newest first |
| `GET /sessions/:sessionId/messages` | full transcript, oldest first |
| `DELETE /sessions/:sessionId` | delete one conversation's messages (document untouched) |

Chat pipeline (both routes): embed question → `searchSimilar(top 3, scoped to documentId)` → load last `HISTORY_LIMIT = 8` messages → save user message → `buildChatPrompt(context, history, message)` → generate → save assistant reply.

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
- Forward-looking constraints for Step 3.3: `searchSimilar`'s `documentId` param is currently required, and `chat_messages.document_id` is `NOT NULL` — both need to loosen for "all documents" mode.

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

## 10. Code conventions in this repo

- Heavily commented on purpose — comments explain *why* and teach the concept, in a conversational tone. Match that density when adding code. Add a `Step X.Y —` marker comment on new step-related code (as existing code does).
- Routes log through `pipelineLogger` (`pipelineStart`, `step('chat', n, total, ...)`, `detail`, `timing`, `preview`, `pipelineEnd`) so a request can be followed in the terminal.
- Frontend logs through `utils/logger.ts` with a scope (`log.info('useChat', ...)`).
- Frontend: `api/` = fetch only, `hooks/` = state + async logic, `components/` = presentation, `App.tsx` = wiring.
- TypeScript strict; run `npx tsc --noEmit` after backend edits.

## 11. Doc map (which file is for what)

| File | Purpose | Who updates |
|---|---|---|
| `CLAUDE.md` (this) | Project memory for new Claude sessions | Claude, at the end of a work session |
| [project_building_workthrough.md](project_building_workthrough.md) | Phase-by-phase build order + implementation details of what was built | Claude, when a step is finished |
| [ai-backend-roadmap.md](ai-backend-roadmap.md) | The original learning plan with resources; done steps get ✅ + a "how it turned out" note | Claude, when a step is finished |
| [PROGRESS.md](PROGRESS.md) | The tracker — single source of truth for "what next" | Claude, when a topic finishes |
| [README.md](README.md) | Short intro, setup, two-machine git workflow | Occasionally |
| `topics/NN-*/README.md` / `NOTES.md` | Reading material / **Shiv's own notes (don't write)** | Shiv |

## 12. Two-machine workflow

Shiv sometimes works on two laptops. Git is the only thing that carries code; `.env` is copied manually. One branch per machine/task, `git pull --rebase` at the start of a session, push at the end, merge to `main` via PR, then `git fetch && git rebase origin/main` on the other branch. **This file is in the repo, so it syncs across laptops — the per-machine Claude auto-memory does not.** Anything a future session needs must be written here, not left in chat.

## 13. Work log (newest first — append an entry each session)

- **2026-09-20** — Finished Phase 3 streaming: `/chat-stream`, `streamAnswer()`, shared `buildChatPrompt()`, `withErrorHandling()`/`summarizeError()`, frontend `EventSource` wrapper + streaming chat UI. Fixed Gemini `\r\n` parsing and a stream-response conflict (`0568597`). Deleted the throwaway `/tick` route. Updated walkthrough, roadmap, PROGRESS, README (added the two-machine workflow section). Discussed git workflow (rebase vs merge, one branch per laptop). Created this file. Next: Step 3.3.
- **2026-09-18** — Step 2.5: `GET /sessions`, `GET /sessions/:id/messages`, delete endpoints, ChatGPT-style frontend, `localStorage` session persistence, frontend folder restructure, tagged logger.
- **2026-09-17** — Step 2.4: `chat_messages` table + repository, `/chat` rewritten with memory, RAG notes.
- **Earlier** — Phase 1 and Steps 2.1–2.3 (embeddings, pgvector, Drizzle, PDF upload, RAG `/chat`, first frontend).

## 14. Keeping this file alive

At the end of every work session, before Shiv ends the chat:
1. Update **§3 Current state** (what's done, what's next, git/branch status).
2. Add a dated line to **§13 Work log**.
3. Add any new decision/gotcha to **§9**, any new route to **§7**, any schema change to **§8**.
4. Update the walkthrough / roadmap / PROGRESS if a step finished.
5. Keep it factual and verifiable against the code — if this file and the code disagree, the code wins; fix the file.
