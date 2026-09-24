# DocMind — Code Explained (Step 1.1 → Step 4.3F)

A file-by-file, line-linked walkthrough of everything built so far: **why** each piece exists, **what** it does, and **how** it's implemented. Every `[file:lines]` link jumps to the exact code (Ctrl+Click in VS Code).

How this relates to the other docs:
- [project_building_workthrough.md](project_building_workthrough.md) = the *build order* (what step comes next).
- [PROGRESS.md](PROGRESS.md) = the *tracker*.
- **This file** = the *code explained*. Read it when you want to understand (or re-learn) how something actually works.
- Line numbers were checked when this was written. If a file has been edited since, the link may be a few lines off — the function names are the reliable anchor.

---

## Table of contents

0. [The big picture](#0-the-big-picture)
1. [Project foundation (config files)](#1-project-foundation)
2. [Phase 1 — Embeddings & vector search](#phase-1--embeddings--vector-search)
   - [Step 1.1 — Embeddings + cosine similarity](#step-11--embeddings--cosine-similarity)
   - [Step 1.2 — Postgres + pgvector](#step-12--postgres--pgvector)
   - [Step 1.3 — Drizzle + the repository pattern](#step-13--drizzle--the-repository-pattern)
3. [Phase 2 — RAG, memory, history](#phase-2--rag-memory-history)
   - [Step 2.1 — Parse a PDF](#step-21--parse-a-pdf)
   - [Step 2.1F / 2.2F — Frontend scaffold + upload UI](#step-21f--22f--frontend-scaffold--upload-ui)
   - [Step 2.2 — `POST /upload`, the full pipeline](#step-22--post-upload-the-full-pipeline)
   - [Step 2.3 — `POST /chat`, single turn](#step-23--post-chat-single-turn)
   - [Step 2.3F — Chat UI](#step-23f--chat-ui)
   - [Step 2.4 — Memory](#step-24--memory)
   - [Step 2.5 — History + deletes](#step-25--history--deletes)
4. [Phase 3 — Streaming](#phase-3--streaming)
   - [Step 3.1 — SSE mechanics (`/tick`, now deleted)](#step-31--sse-mechanics-tick-now-deleted)
   - [Step 3.2 — Streaming the real chat reply](#step-32--streaming-the-real-chat-reply)
   - [Step 3.2F — Streaming in the frontend](#step-32f--streaming-in-the-frontend)
   - [Step 3.3 — Multi-document chat](#step-33--multi-document-chat)
   - **Phase 4 — Quiz generation:** [Step 4.1 — Structured output with Zod](#step-41--structured-output-with-zod) · [Step 4.2 — `POST /quiz`](#step-42--post-quiz) · [Step 4.2F — Frontend: quiz UI](#step-42f--frontend-quiz-ui) · [Step 4.3 + 4.3F — checking answers](#step-43--43f--checking-answers)
5. [Cross-cutting: errors, logging, and the backend restructure](#5-cross-cutting-errors-logging-and-the-backend-restructure)
6. [One chat message, end to end](#6-one-chat-message-end-to-end)
7. [Known limitations (honest list)](#7-known-limitations-honest-list)
8. [Glossary](#8-glossary)

---

## 0. The big picture

DocMind has two data flows. Everything in this file is a piece of one of them.

**Flow A — ingestion ("upload a PDF")**

```
PDF file ──► multer (into memory) ──► pdf-parse ──► plain text
   ──► chunkText (~500 words each) ──► for each chunk: getEmbedding() ──► 3072 numbers
   ──► insertChunk() ──► Postgres `chunks` table (pgvector)
   ──► insertDocument() ──► `documents` table (one row per PDF)
```

**Flow B — chat ("ask the PDF a question")**

```
question ──► getEmbedding() ──► searchSimilar() (top 3 nearest chunks, cosine distance)
   ──► getRecentMessages() (last 8 messages of this session = memory)
   ──► insertMessage(user)
   ──► buildChatPrompt(chunks + history + question) ──► Gemini
   ──► answer (all at once = /chat, or piece by piece = /chat-stream)
   ──► insertMessage(assistant) ──► back to the browser
```

**Who talks to whom**

```
Browser (React, :5173) ──HTTP──► Express API (:3000) ──► Gemini API   (embeddings + generation)
                                        └────────────► Neon Postgres (documents, chunks, chat_messages)
```

**File map** (backend `src/`, frontend `frontend/src/`)

| Area | Files |
|---|---|
| Learning scripts | [step1-embeddings.ts](src/step1-embeddings.ts), [step2-pgvector.ts](src/step2-pgvector.ts), [step3-drizzle.ts](src/step3-drizzle.ts) (Phase 1) · [step4-quiz-zod.ts](src/step4-quiz-zod.ts) (Phase 4) |
| Server bootstrap | [index.ts](src/index.ts), [app.ts](src/app.ts), [config.ts](src/config.ts) |
| Routes (HTTP layer) | [documents.routes.ts](src/routes/documents.routes.ts), [sessions.routes.ts](src/routes/sessions.routes.ts), [chat.routes.ts](src/routes/chat.routes.ts) |
| Services (the actual work) | [chat.service.ts](src/services/chat.service.ts), [ingestion.service.ts](src/services/ingestion.service.ts), [embeddings.service.ts](src/services/embeddings.service.ts), [llm.service.ts](src/services/llm.service.ts) |
| Repositories (all SQL lives here) | [chunks.repository.ts](src/repositories/chunks.repository.ts), [documents.repository.ts](src/repositories/documents.repository.ts), [chatMessages.repository.ts](src/repositories/chatMessages.repository.ts) |
| Database | [db/client.ts](src/db/client.ts), [db/schema.ts](src/db/schema.ts) |
| Utils | [utils/chunkText.ts](src/utils/chunkText.ts), [utils/errors.ts](src/utils/errors.ts), [utils/pipelineLogger.ts](src/utils/pipelineLogger.ts) |
| Schemas (Phase 4) | [schemas/quiz.schema.ts](src/schemas/quiz.schema.ts) — the Zod shape of a quiz |
| Frontend API layer | [api/client.ts](frontend/src/api/client.ts), [api/documents.ts](frontend/src/api/documents.ts), [api/chat.ts](frontend/src/api/chat.ts), [api/sessions.ts](frontend/src/api/sessions.ts) |
| Frontend state (hooks) | [useDocuments.ts](frontend/src/hooks/useDocuments.ts), [useSessions.ts](frontend/src/hooks/useSessions.ts), [useChat.ts](frontend/src/hooks/useChat.ts) |
| Frontend UI | [App.tsx](frontend/src/App.tsx) + `components/` (sidebar, chat, documents, common) |

**The layering rule** (this is why the code is split the way it is):

```
route  →  service  →  repository  →  db
(HTTP)    (the work)   (SQL)          (Postgres)
```
- A **route** only reads the request and writes the response.
- A **service** does the real work and never touches `req`/`res`.
- A **repository** is the only place SQL/Drizzle appears.
- The frontend mirrors it: `api/` (fetch only) → `hooks/` (state + logic) → `components/` (pixels).

---

## 1. Project foundation

Before any step, the project needed a place to live.

### [package.json](package.json)
- `"type": "commonjs"` — Node loads files with `require`. TypeScript `import` statements are compiled to `require` calls, and **import order = load order** (this matters for `dotenv`, see below).
- `npm run dev` = `ts-node-dev --respawn --transpile-only src/index.ts`. `ts-node-dev` runs TypeScript directly and **restarts the server on every file save** (`--respawn`). `--transpile-only` skips type-checking to make restarts fast — the price is that **type errors don't stop the server**, so run `npx tsc --noEmit` yourself to catch them.
- The npm scripts are now `dev`, `step3`, `step4` and `test`. `step1` and `step2` were **removed** from `package.json` (`step2` is destructive) — run those files directly with `npx ts-node src/step1-embeddings.ts` if you ever need them. Also: `package.json` must be strict JSON — a `//` comment in it makes *every* npm command fail with `EJSONPARSE`.
- Dependencies, each with one job: `express` (HTTP server), `cors` (allow the browser at :5173 to call :3000), `multer` (file uploads), `pdf-parse` (PDF → text), `pg` (Postgres driver), `drizzle-orm` (typed queries), `dotenv` (load `.env`), `chalk` (coloured terminal logs), `zod` (checks that the LLM's output has the right shape — Phase 4). `drizzle-kit` is the CLI for Drizzle (configured in [drizzle.config.ts](drizzle.config.ts)).

### [tsconfig.json](tsconfig.json)
`"strict": true` — TypeScript's strictest checking (no implicit `any`, null-safety). It's why you see things like `documentId: unknown` followed by a `typeof documentId !== 'string'` check in [chat.service.ts:80-93](src/services/chat.service.ts#L80-L93).

### `.env` (never committed) and [.env.example](.env.example)
Three keys: `GEMINI_API_KEY`, `DATABASE_URL` (Neon connection string), `FRONTEND_URL` (allowed CORS origin). `.env.example` is the committed template with no real values. The frontend has its own `frontend/.env` with `VITE_API_URL` (read at [client.ts:3](frontend/src/api/client.ts#L3)).

### [.gitignore](.gitignore)
Ignores `node_modules/`, `dist/`, `.env`, and **`.history`** (the VS Code Local History extension snapshots every saved file — including `.env` — so it must never be tracked; a real secret leak happened this way, per the comment in the file).

### [drizzle.config.ts](drizzle.config.ts)
Tells `drizzle-kit` where the schema is (`./src/db/schema.ts`) and which database to use. There's no `drizzle/` migrations folder in the repo, so schema changes were applied to Neon outside git — the equivalent SQL is kept in comments beside each table in the schema file.

### Why `import 'dotenv/config'` appears first
[index.ts:1](src/index.ts#L1), [config.ts:1](src/config.ts#L1) and [db/client.ts:1](src/db/client.ts#L1) all import `dotenv/config` at the very top. It reads `.env` into `process.env`. Files like [embeddings.service.ts:1](src/services/embeddings.service.ts#L1) read `process.env.GEMINI_API_KEY` **the moment they're loaded** — so `.env` must already be loaded by then. Because imports run in order, putting dotenv first guarantees it.

---

# Phase 1 — Embeddings & vector search

**The whole phase in one paragraph:** a computer can't compare the *meaning* of two sentences directly, but it can compare two lists of numbers. An **embedding** model turns a sentence into a list of numbers (a *vector*) such that similar meanings get similar numbers. A **vector database** stores those lists and can quickly find the ones closest to a query. That's the engine under RAG.

---

## Step 1.1 — Embeddings + cosine similarity

**Script:** [src/step1-embeddings.ts](src/step1-embeddings.ts) — run with `npx ts-node src/step1-embeddings.ts` (no longer an npm script).

### Why we need it
Everything later (search, chat, memory-aware retrieval) rests on one fact: *similar text → similar vectors*. This step proves it by hand, with no database and no libraries, so it's not magic later.

### What it does
Embeds four sentences (two similar, two unrelated), computes how "close" each pair is, and prints which pair scored higher.

### How it works

**Calling the embedding API — [step1-embeddings.ts:11-27](src/step1-embeddings.ts#L11-L27)**
- [L7-9](src/step1-embeddings.ts#L7-L9): the API key from `.env` and the endpoint for Gemini's `gemini-embedding-001` model.
- [L12-18](src/step1-embeddings.ts#L12-L18): a plain `fetch` POST (no SDK). The body shape `{ content: { parts: [{ text }] } }` is Gemini's format.
- [L20-22](src/step1-embeddings.ts#L20-L22): if the HTTP status isn't 2xx, throw with the status and body — so a bad key shows up as a readable error instead of a mysterious `undefined` later.
- [L26](src/step1-embeddings.ts#L26): the answer lives at `data.embedding.values` — an array of **3072 numbers**. (The original plan text says `text-embedding-004` / 768 numbers; the code uses `gemini-embedding-001` / 3072. Trust the code.)

**Cosine similarity, written by hand — [step1-embeddings.ts:32-44](src/step1-embeddings.ts#L32-L44)**
```
cosine_similarity(a, b) = dot(a, b) / (|a| × |b|)
```
- [L37-41](src/step1-embeddings.ts#L37-L41): one loop computes three sums at once — `dot` (Σ aᵢ·bᵢ), `magA` (Σ aᵢ²), `magB` (Σ bᵢ²).
- [L43](src/step1-embeddings.ts#L43): `dot / (√magA × √magB)`.
- What it measures: the **angle** between the two vectors, ignoring their length. `1` = pointing the same way (same meaning), `0` = unrelated, `-1` = opposite. It was written by hand on purpose — typing the formula is what makes it click.

**The experiment — [step1-embeddings.ts:46-81](src/step1-embeddings.ts#L46-L81)**
- [L47-55](src/step1-embeddings.ts#L47-L55): `similarPair` ("cat sat on the mat" / "kitten resting on the rug") and `unrelatedPair` ("cat…" / "stock market crashed").
- [L59-60](src/step1-embeddings.ts#L59-L60): `Promise.all` embeds both sentences of a pair *in parallel*.
- [L66-80](src/step1-embeddings.ts#L66-L80): scores both pairs and prints ✅ if the similar pair scored higher.

### What you should see
A length of 3072, the first 5 numbers of one vector, two scores, and "✅ Confirmed". Exact numbers depend on the model; what matters is *similar > unrelated*.

### Takeaway
An embedding is just an array of numbers where **distance ≈ difference in meaning**. Nothing else in the project is more fundamental.

---

## Step 1.2 — Postgres + pgvector

**Script:** [src/step2-pgvector.ts](src/step2-pgvector.ts) — run with `npx ts-node src/step2-pgvector.ts` (no longer an npm script, because it is destructive — see the warning below).

### Why we need it
Step 1.1 compared two vectors in JavaScript. A real system has *thousands* of stored vectors and needs "give me the closest 3 to this one". Looping in JS over everything doesn't scale, so we let a **database** do the math. **pgvector** is a Postgres extension that adds a `vector` column type and distance operators. Hosted for free on **Neon**.

### What it does
Creates a table, embeds 10 sentences and stores them, then asks: *"what's closest to 'a cat napping on a blanket'?"* — expecting the two cat sentences back.

### How it works
- [L35](src/step2-pgvector.ts#L35): `new Pool(...)` — a connection pool from the `pg` driver, using `DATABASE_URL`.
- [L38](src/step2-pgvector.ts#L38): `CREATE EXTENSION IF NOT EXISTS vector;` — turns on pgvector in the database. Needed once.
- [L39-46](src/step2-pgvector.ts#L39-L46): `DROP TABLE IF EXISTS chunks;` then `CREATE TABLE chunks (id, content, embedding VECTOR(3072))`. `VECTOR(3072)` = "a vector of exactly 3072 numbers" — it must match the embedding model's output size.
- [L30-32](src/step2-pgvector.ts#L30-L32): `toVectorLiteral` — pgvector wants vectors as text like `'[0.1,0.2,…]'`, so this joins the array with commas inside brackets.
- [L62-69](src/step2-pgvector.ts#L62-L69): for each sentence → embed → `INSERT … VALUES ($1, $2)`. The `$1/$2` are **parameterized query** placeholders: the driver sends values separately from the SQL, which prevents SQL injection.
- [L73-79](src/step2-pgvector.ts#L73-L79): the search query:
  ```sql
  SELECT content, embedding <=> $1 AS distance
  FROM chunks ORDER BY embedding <=> $1 LIMIT 2
  ```
  `<=>` is pgvector's **cosine distance** operator (`distance = 1 − similarity`, so **smaller = more similar**). This is the exact math from Step 1.1, run inside the database. `ORDER BY … LIMIT 2` = "two nearest".

### Other pgvector operators (for reference)
`<=>` cosine distance · `<->` Euclidean (straight-line) distance · `<#>` negative inner product.

### ⚠️ Warning: don't re-run this script now
[L39](src/step2-pgvector.ts#L39) `DROP TABLE IF EXISTS chunks` would **destroy your real chunks table** (and recreate it *without* the `document_id` column the app now needs). It was a Phase 1 learning script, safe only when the table held throwaway data.

### Takeaway
The database computes the same cosine math you wrote by hand, just fast and at scale. Without an index it still compares against every row (fine for thousands of rows; for millions see [topics/02-vector-search-pgvector/INDEXING-AT-SCALE.md](topics/02-vector-search-pgvector/INDEXING-AT-SCALE.md)).

---

## Step 1.3 — Drizzle + the repository pattern

**Files:** [db/client.ts](src/db/client.ts), [db/schema.ts](src/db/schema.ts), [services/embeddings.service.ts](src/services/embeddings.service.ts), [repositories/chunks.repository.ts](src/repositories/chunks.repository.ts), script [step3-drizzle.ts](src/step3-drizzle.ts).

### Why we need it
Step 1.2 scattered raw SQL strings and a copy-pasted `getEmbedding` through the script. In a real app that becomes unmaintainable and un-type-checked. The fix:
1. **Drizzle ORM** — describe tables in TypeScript so queries are type-checked and autocompleted.
2. **Repository pattern** — put *all* database access behind a few named functions (`insertChunk`, `searchSimilar`). Nothing else in the app writes SQL. If the database changes, only repositories change.
3. **One shared `getEmbedding`** — a single file instead of one copy per script.

### How it works

**[db/client.ts](src/db/client.ts) — the connection**
- [L8](src/db/client.ts#L8): a `Pool` from `pg` (same as Step 1.2).
- [L10](src/db/client.ts#L10): `export const db = drizzle(pool, { schema })` — wraps the pool with Drizzle. **Every repository imports this one `db` object.**

**[db/schema.ts](src/db/schema.ts) — tables as TypeScript** (the `chunks` table is the Phase 1 one; the others came later)
- `chunks`: [L27-36](src/db/schema.ts#L27-L36) — `id` (serial primary key), `content` (text), `embedding` (`vector('embedding', { dimensions: 3072 })` at [L33](src/db/schema.ts#L33)), and `documentId` (which PDF this chunk came from, added in Step 2.2).
- `documents`: [L16-23](src/db/schema.ts#L16-L23) — Step 2.2. `chat_messages`: [L45-54](src/db/schema.ts#L45-L54) — Step 2.4.
- Every other file imports these definitions, so a typo in a column name is a compile error, not a runtime surprise.

**[services/embeddings.service.ts](src/services/embeddings.service.ts) — the shared embedder**
[getEmbedding at L5-20](src/services/embeddings.service.ts#L5-L20) is Step 1.1's function, moved to one place. Used by the upload pipeline, the chat pipeline, and step3.

**[repositories/chunks.repository.ts](src/repositories/chunks.repository.ts)**
- `insertChunk(content, embedding, documentId)` — [L6-14](src/repositories/chunks.repository.ts#L6-L14): `db.insert(chunks).values(...)`. The SQL equivalent is in the comment at [L15-16](src/repositories/chunks.repository.ts#L15-L16).
- `searchSimilar(queryEmbedding, limit, documentId?)` — [L56-86](src/repositories/chunks.repository.ts#L56-L86):
  - [L62](src/repositories/chunks.repository.ts#L62): `cosineDistance(chunks.embedding, queryEmbedding)` builds the same `<=>` expression as a reusable value; `.mapWith(Number)` makes sure the result comes back as a JS number.
  - [L66-85](src/repositories/chunks.repository.ts#L66-L85): `select content + distance (+ documentId, filename since Step 3.3) → where documentId matches → order by distance → limit`. It returns `SimilarChunk[]`, nearest first.
  - The `where documentId = …` filter is what keeps one PDF's answers from mixing in another PDF's text (Step 2.2 added it). Step 3.3 made `documentId` **optional** — see [Step 3.3](#step-33--multi-document-chat).
- `deleteChunksByDocumentId` — [L39-41](src/repositories/chunks.repository.ts#L39-L41): used when a document is deleted (Step 2.5).

**[step3-drizzle.ts](src/step3-drizzle.ts) — proof it works**
Same experiment as Step 1.2 but through `insertChunk()` / `searchSimilar()` ([L34-41](src/step3-drizzle.ts#L34-L41)) — the caller never writes SQL. ⚠️ [L18](src/step3-drizzle.ts#L18) runs `DELETE FROM chunks` — **it wipes every chunk in the table, including your real PDFs'**. Don't re-run it against the live database.

### Takeaway
Routes and services say *what* they want (`searchSimilar(embedding, 3, docId)`); the repository knows *how* (SQL). That separation is the whole point of the pattern.

---

# Phase 2 — RAG, memory, history

**RAG in one sentence:** instead of the model guessing from its training memory, we **retrieve** the relevant text from the user's PDF and hand it to the model right before asking the question. That's why the pipeline is *embed the question → find nearest chunks → put them in the prompt → generate*.

---

## Step 2.1 — Parse a PDF

**Where it lives now:** [documents.routes.ts:11](src/routes/documents.routes.ts#L11) (multer), [documents.routes.ts:29-52](src/routes/documents.routes.ts#L29-L52) (`POST /upload`), and [ingestion.service.ts:17-25](src/services/ingestion.service.ts#L17-L25) (the parsing). Originally all of this was in `index.ts`; the backend restructure ([§5](#5-cross-cutting-errors-logging-and-the-backend-restructure)) moved it without changing behavior.

### Why we need it
Users upload a **file**, but everything so far works on **text**. We need "PDF in → plain text out" before we can chunk or embed anything.

### How it works
- **Multer** ([documents.routes.ts:11](src/routes/documents.routes.ts#L11)): `multer({ storage: multer.memoryStorage() })`. Multer is Express middleware for `multipart/form-data` (file uploads). `memoryStorage()` keeps the uploaded file **in RAM** as a `Buffer` instead of writing it to disk — simplest option for parsing straight away.
- **The route** ([L29](src/routes/documents.routes.ts#L29)): `upload.single('file')` says "expect one file in the form field named `file`" and puts it on `req.file` (`buffer`, `originalname`, `size`, `mimetype`).
- **Validation** ([L33-43](src/routes/documents.routes.ts#L33-L43)): no file → `400`; `mimetype !== 'application/pdf'` → `400`. Note the mimetype comes from the *client's* request header, so it's a convenience check, not a security guarantee.
- **Parsing** ([ingestion.service.ts:19-25](src/services/ingestion.service.ts#L19-L25)): `new PDFParse({ data: file.buffer })` then `await parser.getText()` → `result.text`. `pdf-parse` only reads PDFs with a real **text layer** (typed/exported); scanned images would need OCR.
- **Cleanup** ([ingestion.service.ts:62-64](src/services/ingestion.service.ts#L62-L64)): `finally { await parser.destroy() }` frees the parser even if something above threw.

### Takeaway
Multer turns an HTTP file upload into a `Buffer`; `pdf-parse` turns the buffer into a string. That string is the raw material for everything after.

---

## Step 2.1F / 2.2F — Frontend scaffold + upload UI

**Why a frontend at all:** to test each endpoint the way a real client would (real `FormData`, real `EventSource`, real CORS) instead of only via Postman. It's built alongside the backend, kept deliberately simple: Vite + React + TypeScript, no router, no state library.

### Entry and wiring
- [main.tsx:6-10](frontend/src/main.tsx#L6-L10): mounts `<App />` inside `<StrictMode>`. StrictMode (dev only) intentionally runs some things **twice** to expose impure code — this is why the streaming state updater in [useChat.ts:125-133](frontend/src/hooks/useChat.ts#L125-L133) must be a pure function.
- [vite.config.ts](frontend/vite.config.ts): just the React plugin. Vite serves the app on `localhost:5173`.

### CORS — why the backend needs [app.ts:17-21](src/app.ts#L17-L21)
The page is served from `:5173` and calls the API on `:3000`. Those are **different origins**, and browsers block cross-origin requests unless the server says it's OK. `cors({ origin: FRONTEND_URL })` sends the allow header for exactly the frontend's origin ([config.ts:21](src/config.ts#L21), defaulting to `http://localhost:5173`).

### The API layer — `frontend/src/api/` (fetch and nothing else)
- [client.ts](frontend/src/api/client.ts): [L3](frontend/src/api/client.ts#L3) `API_URL` (from `VITE_API_URL`, falling back to `http://localhost:3000`); [L5-14](frontend/src/api/client.ts#L5-L14) `parseJsonOrThrow(res)` — parses the JSON, and if the status isn't OK, logs it and throws an `ApiError` carrying the server's `error` message. Every API function shares it, so error handling is written once.
- [documents.ts](frontend/src/api/documents.ts):
  - `uploadDocument(file)` — [L30-52](frontend/src/api/documents.ts#L30-L52): builds a `FormData` ([L33-34](frontend/src/api/documents.ts#L33-L34)) and POSTs it. **It deliberately sets no `Content-Type` header** — the browser sets `multipart/form-data` *with the boundary string* itself; setting it manually breaks the upload.
  - `fetchDocuments()` — [L14-28](frontend/src/api/documents.ts#L14-L28): `GET /documents`, and renames the server's `id` to the frontend's `documentId`.
  - `deleteDocument()` — [L54-58](frontend/src/api/documents.ts#L54-L58) (Step 2.5).

### Types — [types/document.ts](frontend/src/types/document.ts)
`UploadedDocument` ([L1-8](frontend/src/types/document.ts#L1-L8)) and `UploadStatus = 'idle' | 'uploading' | 'error'` ([L10](frontend/src/types/document.ts#L10)).

### State — [hooks/useDocuments.ts](frontend/src/hooks/useDocuments.ts)
- [L7-9](frontend/src/hooks/useDocuments.ts#L7-L9): `documents`, `status`, `error`.
- [L14-24](frontend/src/hooks/useDocuments.ts#L14-L24): on mount, load documents that **already exist on the server** (so a PDF uploaded via Postman or another tab still shows up).
- `uploadFile` — [L26-51](frontend/src/hooks/useDocuments.ts#L26-L51): checks `file.type` is a PDF ([L29-34](frontend/src/hooks/useDocuments.ts#L29-L34)), sets `status: 'uploading'`, calls the API, prepends the new doc to state, or sets an error.
- `deleteDocument` — [L53-64](frontend/src/hooks/useDocuments.ts#L53-L64).

### UI — [components/documents/UploadDropzone.tsx](frontend/src/components/documents/UploadDropzone.tsx)
A drag-and-drop box that's also click-to-browse. [L11-13](frontend/src/components/documents/UploadDropzone.tsx#L11-L13) tracks dragging and a hidden `<input type="file" accept="application/pdf">`; [handleDrop L15-20](frontend/src/components/documents/UploadDropzone.tsx#L15-L20) grabs the dropped file; [L46-50](frontend/src/components/documents/UploadDropzone.tsx#L46-L50) resets the input value so picking the *same* file twice still fires; while `busy` it shows a spinner and "Extracting text…" ([L53-57](frontend/src/components/documents/UploadDropzone.tsx#L53-L57)). It calls `onFileSelected` and knows nothing about APIs — presentation only.

### Small shared pieces
- [utils/logger.ts](frontend/src/utils/logger.ts): the tagged console logger (see [§5](#frontend-logger)).
- [utils/format.ts](frontend/src/utils/format.ts): `formatFileSize` and `formatRelativeTime` — **currently unused** (left over from an earlier UI; safe to delete or reuse).
- [components/common/IconButton.tsx:8-18](frontend/src/components/common/IconButton.tsx#L8-L18): a reusable icon-only button; `mobileOnly` adds a class that hides it on desktop.

---

## Step 2.2 — `POST /upload`, the full pipeline

**Files:** [ingestion.service.ts](src/services/ingestion.service.ts), [chunkText.ts](src/utils/chunkText.ts), [documents.repository.ts](src/repositories/documents.repository.ts), [documents.routes.ts](src/routes/documents.routes.ts), [pipelineLogger.ts](src/utils/pipelineLogger.ts).

### Why we need it
Step 2.1 gave us one big string. To search it we need to (a) cut it into **chunks** small enough to embed and to fit in a prompt, (b) embed each chunk, (c) store the vectors, and (d) remember which chunks belong to which PDF.

### What it does
`POST /upload` turns a PDF into searchable chunks in the database, and returns `{ documentId, filename, fileSizeBytes, textLength, chunkCount, createdAt }`.

### How it works — `ingestPdf()` at [ingestion.service.ts:17-65](src/services/ingestion.service.ts#L17-L65)

| Step | Code | What happens |
|---|---|---|
| 1 | [documents.routes.ts:45](src/routes/documents.routes.ts#L45) | log "File received" (route checks come first) |
| 2 | [ingestion.service.ts:22-25](src/services/ingestion.service.ts#L22-L25) | extract text with `parser.getText()` |
| 3 | [ingestion.service.ts:27-30](src/services/ingestion.service.ts#L27-L30) | `chunkText(text)`; generate `documentId = randomUUID()` |
| 4 | [ingestion.service.ts:32-42](src/services/ingestion.service.ts#L32-L42) | for each chunk: `getEmbedding` → `insertChunk(chunk, embedding, documentId)` |
| 5 | [ingestion.service.ts:44-52](src/services/ingestion.service.ts#L44-L52) | `insertDocument(...)` writes the metadata row |

- **`chunkText`** — [chunkText.ts:3-12](src/utils/chunkText.ts#L3-L12): split the text on whitespace into words, then group **500 words per chunk** and join them back with spaces. Deliberately simple. Honest limitation: it ignores paragraph/sentence boundaries and flattens newlines. Better chunking is a later topic ([topics/advanced/02-chunking-strategy](topics/advanced/02-chunking-strategy/NOTES.md)).
- **Why chunk at all?** (1) An embedding of a whole book is too vague to match a specific question; a ~500-word piece has a focused meaning. (2) Only the top few chunks go into the prompt, keeping it small and cheap.
- **`documentId`** is a UUID made per upload. It's stored on every chunk (`chunks.document_id`) so a search can be limited to one PDF.
- **The loop is sequential** ([L34-42](src/services/ingestion.service.ts#L34-L42)): one embedding API call per chunk, one after another. Simple and easy to log, but slow for big PDFs — Phase 6 (background jobs) is the fix.
- **`documents` table** — [schema.ts:16-23](src/db/schema.ts#L16-L23): one row per PDF (`id`, `filename`, `fileSizeBytes`, `textLength`, `chunkCount`, `createdAt`). It exists so "what documents exist?" doesn't have to be reverse-engineered from chunk rows.
- **`insertDocument`** — [documents.repository.ts:5-17](src/repositories/documents.repository.ts#L5-L17): `.insert(...).values(...).returning()` gives back the saved row (that's where `createdAt` comes from).
- **`listDocuments`** — [L21-23](src/repositories/documents.repository.ts#L21-L23) newest first; served by `GET /documents` at [documents.routes.ts:13-16](src/routes/documents.routes.ts#L13-L16).

### The logger you see in the terminal — [utils/pipelineLogger.ts](src/utils/pipelineLogger.ts)
Every route prints a readable trace. Helpers: `pipelineStart` ([L18-22](src/utils/pipelineLogger.ts#L18-L22)) header line · `step(pipeline, n, total, label)` ([L30-33](src/utils/pipelineLogger.ts#L30-L33)) `[3/5] …` · `detail` ([L35-37](src/utils/pipelineLogger.ts#L35-L37)) indented grey line · `timing` ([L39-41](src/utils/pipelineLogger.ts#L39-L41)) `done in Nms` · `preview` ([L43-47](src/utils/pipelineLogger.ts#L43-L47)) shows the first ~80 chars of some text · `rejected` / `notFound` ([L49-55](src/utils/pipelineLogger.ts#L49-L55)) red failure lines · `pipelineEnd` ([L24-28](src/utils/pipelineLogger.ts#L24-L28)) total time. Uploads are **cyan**, chats **magenta** ([L11-14](src/utils/pipelineLogger.ts#L11-L14)) so mixed traffic is easy to read; `chalk.level = 1` ([L6](src/utils/pipelineLogger.ts#L6)) forces colour even when output is piped.

### Takeaway
Upload is an *offline* pipeline (nobody needs the result instantly), which is why Phase 6 will move it to a background queue. Chat is *online*: a human is waiting.

---

## Step 2.3 — `POST /chat`, single turn

**Files:** [chat.routes.ts:11-37](src/routes/chat.routes.ts#L11-L37), [chat.service.ts](src/services/chat.service.ts), [llm.service.ts:10-29](src/services/llm.service.ts#L10-L29), [chunks.repository.ts:56-86](src/repositories/chunks.repository.ts#L56-L86).

### Why we need it
This is RAG itself: answer a question **from the PDF**, not from the model's memory.

### What it does
`POST /chat` with `{ documentId, message, sessionId? }` returns `{ sessionId, answer, sources }`, where `sources` are the chunks that were used (with their distances) so the UI can show where the answer came from.

### How it works
The route is thin ([chat.routes.ts:11-37](src/routes/chat.routes.ts#L11-L37)); the shared pipeline is `prepareChat()` in [chat.service.ts:74-165](src/services/chat.service.ts#L74-L165):

1. **Validate** — [L80-93](src/services/chat.service.ts#L80-L93): `message` must be a non-empty string; `documentId` is a real id **or omitted/`'all'`** (search everything — see [Step 3.3](#step-33--multi-document-chat)); a non-string `documentId` is a `400`. They arrive typed `unknown` because they're raw request input; the `typeof` checks narrow them. Failure → returns `{ ok: false, status: 400, error }` (the *service never touches `res`* — the route sends the response).
2. **Embed the question** — [L100-103](src/services/chat.service.ts#L100-L103): the **same model** that embedded the chunks (a question can only be compared to chunks embedded the same way).
3. **Search** — [L105-115](src/services/chat.service.ts#L105-L115): `searchSimilar(questionEmbedding, 3, documentId)` — top **3** nearest chunks of this document (or, since Step 3.3, of every document when the scope is `'all'`).
4. **No chunks?** — [L117-128](src/services/chat.service.ts#L117-L128): the `documentId` doesn't exist (or, in all-documents mode, nothing has been uploaded) → `404`.
5. *(steps 4–5 of the pipeline — history and prompt — are covered next, in Step 2.4)*
6. **Generate** — [chat.routes.ts:21-25](src/routes/chat.routes.ts#L21-L25): `generateAnswer(prompt)`.
7. **Save + respond** — [L27-36](src/routes/chat.routes.ts#L27-L36).

**The prompt — [buildChatPrompt, chat.service.ts:15-49](src/services/chat.service.ts#L15-L49)**
It tells the model to (a) use **only** the supplied context, no outside knowledge, no guessing; (b) answer naturally, not "Based on the provided context…"; (c) say so briefly if the answer isn't in the context; (d) use the conversation history to resolve follow-ups like "the first one". Then the layout is `Context:` (the chunks joined by blank lines) + optional `Conversation so far:` + `New question:`. Prompt wording lives in this **one** function, shared by `/chat` and `/chat-stream`.

**Calling Gemini — [generateAnswer, llm.service.ts:10-29](src/services/llm.service.ts#L10-L29)**
- [L2-3](src/services/llm.service.ts#L2-L3): the `gemini-flash-lite-latest:generateContent` endpoint.
- [L14-21](src/services/llm.service.ts#L14-L21): POST with body `{ contents: [{ parts: [{ text: prompt }] }] }`.
- [L23-25](src/services/llm.service.ts#L23-L25): non-OK status → throw with the API's error body.
- [L28](src/services/llm.service.ts#L28): the reply text is at `data.candidates[0].content.parts[0].text`.
- *Added in Step 4.1:* an optional `generationConfig` parameter ([L11-12](src/services/llm.service.ts#L11-L12), spread into the body at [L19](src/services/llm.service.ts#L19)) that switches on Gemini's JSON / structured-output mode. Chat never passes it, so chat behaves exactly as described above.

### Takeaway
"Instead of the model guessing from memory, I hand it the relevant text right before asking." That sentence *is* RAG. At this point the bot answers from the PDF but forgets everything after each request.

---

## Step 2.3F — Chat UI

**Files:** [components/chat/](frontend/src/components/chat) — `ChatPanel`, `ChatTurn`, `ChatSources`, `ChatInputForm`, `ChatView`, `NewChatScreen`.

- [ChatInputForm.tsx:11-40](frontend/src/components/chat/ChatInputForm.tsx#L11-L40): a controlled text input + send button. [L12-17](frontend/src/components/chat/ChatInputForm.tsx#L12-L17) prevents the page reload, trims, ignores empty messages, then calls `onSubmit`. The button is disabled while `disabled` (a reply is in flight) or the box is empty ([L33](frontend/src/components/chat/ChatInputForm.tsx#L33)).
- [ChatTurn.tsx:8-22](frontend/src/components/chat/ChatTurn.tsx#L8-L22): one message bubble. The CSS class comes from `message.role` (`user`/`assistant`) and gets an error style if `isError` ([L11-15](frontend/src/components/chat/ChatTurn.tsx#L11-L15)). If the message has `sources`, it renders `ChatSources` under it.
- [ChatSources.tsx:8-31](frontend/src/components/chat/ChatSources.tsx#L8-L31): a collapsible `<details>` listing the source chunks — each shows its `distance` and the first 220 characters. This is how you *see* what the model was given.
- [ChatPanel.tsx:15-57](frontend/src/components/chat/ChatPanel.tsx#L15-L57): the message list + input. Auto-scrolls to the bottom with a ref ([L16](frontend/src/components/chat/ChatPanel.tsx#L16), [L23-27](frontend/src/components/chat/ChatPanel.tsx#L23-L27)), shows a "Thinking…" bubble while waiting ([L44-49](frontend/src/components/chat/ChatPanel.tsx#L44-L49)). (Its streaming-specific logic is in [Step 3.2F](#step-32f--streaming-in-the-frontend).)
- [ChatView.tsx:28-108](frontend/src/components/chat/ChatView.tsx#L28-L108): the right-hand pane. Header shows the active document's filename ([L53-80](frontend/src/components/chat/ChatView.tsx#L53-L80)); body is one of three states: **restoring** spinner ([L83-86](frontend/src/components/chat/ChatView.tsx#L83-L86)), **`ChatPanel`** if a document is active ([L87-94](frontend/src/components/chat/ChatView.tsx#L87-L94)), otherwise **`NewChatScreen`** ([L95-105](frontend/src/components/chat/ChatView.tsx#L95-L105)).
- [NewChatScreen.tsx:15-79](frontend/src/components/chat/NewChatScreen.tsx#L15-L79): the landing screen — the upload dropzone ([L31](frontend/src/components/chat/NewChatScreen.tsx#L31)), an error banner ([L33-38](frontend/src/components/chat/NewChatScreen.tsx#L33-L38)), and "continue with a document you've uploaded before" chips with a delete button on each ([L40-76](frontend/src/components/chat/NewChatScreen.tsx#L40-L76)); `e.stopPropagation()` at [L64](frontend/src/components/chat/NewChatScreen.tsx#L64) stops a delete click from also selecting the chip.
- [types/chat.ts](frontend/src/types/chat.ts): `ChatSource` ([L1-8](frontend/src/types/chat.ts#L1-L8)), `ChatMessage` ([L10-15](frontend/src/types/chat.ts#L10-L15), with optional `isError`/`sources`), `SessionSummary` ([L17-25](frontend/src/types/chat.ts#L17-L25)).
- [api/chat.ts `sendChatMessage`, L11-28](frontend/src/api/chat.ts#L11-L28): the original non-streaming call (`POST /chat`, JSON body). **The UI no longer uses it** (it uses the streaming call since Step 3.2F), but it's kept as the simple reference implementation.

---

## Step 2.4 — Memory

**Files:** [schema.ts:45-54](src/db/schema.ts#L45-L54), [chatMessages.repository.ts](src/repositories/chatMessages.repository.ts), [chat.service.ts:136-151](src/services/chat.service.ts#L136-L151), [config.ts:7](src/config.ts#L7), [useChat.ts:109-110](frontend/src/hooks/useChat.ts#L109-L110).

### Why we need it
Without memory, "what about the next part?" means nothing — each request is independent. A chatbot feels like a chatbot because it remembers what you just said.

### The idea
The LLM itself remembers nothing. "Memory" = **we store every message, and replay the last few into each new prompt**.

### How it works
- **The table** — [schema.ts:45-54](src/db/schema.ts#L45-L54): `chat_messages(id, session_id, document_id, role, content, created_at)`. `session_id` groups messages into one conversation; `role` is `'user'` or `'assistant'`.
- **Saving** — `insertMessage(sessionId, documentId, role, content)` — [chatMessages.repository.ts:17-24](src/repositories/chatMessages.repository.ts#L17-L24).
- **Loading** — `getRecentMessages(sessionId, limit)` — [L30-42](src/repositories/chatMessages.repository.ts#L30-L42): selects the newest `limit` rows (`ORDER BY created_at DESC LIMIT n`), then **`.reverse()`** ([L41](src/repositories/chatMessages.repository.ts#L41)) so they read oldest-first, the order a conversation needs.
- **The limit** — [`HISTORY_LIMIT = 8`, config.ts:7](src/config.ts#L7). You can't send unlimited history forever (cost + context-window limits), so it caps at the last 8. Real systems summarize older messages instead of dropping them (later topic).
- **In the pipeline** — [chat.service.ts:136-151](src/services/chat.service.ts#L136-L151):
  1. [L137](src/services/chat.service.ts#L137) load history **first**.
  2. [L143](src/services/chat.service.ts#L143) *then* save the new user message.
  3. [L147-151](src/services/chat.service.ts#L147-L151) build the prompt.
  The order matters: history is loaded *before* the new message is saved, so the question isn't duplicated in the prompt (it's added separately as `New question:`), yet the *next* turn's history will include it.
- **Assistant reply saved** after generation — [chat.routes.ts:27-28](src/routes/chat.routes.ts#L27-L28).
- **Where `sessionId` comes from** — the frontend makes one with `crypto.randomUUID()` for a new thread ([useChat.ts:109-110](frontend/src/hooks/useChat.ts#L109-L110)) and reuses it for every message in that thread; the server falls back to its own `randomUUID()` if none is sent ([chat.routes.ts:14](src/routes/chat.routes.ts#L14)).

### Verified how
A real vague follow-up ("what's the first stage?" after discussing "3 pipelines") resolved correctly, and the rows were checked directly in Neon's `chat_messages` table.

---

## Step 2.5 — History + deletes

**Files:** [chatMessages.repository.ts:5-13, 65-127](src/repositories/chatMessages.repository.ts), [sessions.routes.ts](src/routes/sessions.routes.ts), [documents.routes.ts:18-27](src/routes/documents.routes.ts#L18-L27), and most of the frontend.

### Why we need it
Step 2.4's frontend kept the `sessionId` only in React state, so **refreshing the tab started a new session** and orphaned the old conversation (the data was safe in Postgres, just unreachable). Also, nothing could be deleted.

### Backend

**There is no `sessions` table.** A session is just a `session_id` shared by a group of `chat_messages` rows, so the session list is **derived** from the messages.

- **`listSessions()`** — [chatMessages.repository.ts:71-114](src/repositories/chatMessages.repository.ts#L71-L114):
  1. [L72-81](src/repositories/chatMessages.repository.ts#L72-L81): read all messages, oldest first.
  2. [L83-84](src/repositories/chatMessages.repository.ts#L83-L84): read documents to build a `documentId → filename` map.
  3. [L86-109](src/repositories/chatMessages.repository.ts#L86-L109): walk the messages, one `Map` entry per `sessionId`. The **first** message seen creates the summary — its content becomes the `title` ([L101-103](src/repositories/chatMessages.repository.ts#L101-L103), the ChatGPT trick of naming a thread after your first message); every later message updates `lastMessage`, `lastMessageAt` and `messageCount`.
  4. [L116-118](src/repositories/chatMessages.repository.ts#L116-L118): sort newest-activity-first.
  Returns a `SessionSummary` ([L6-14](src/repositories/chatMessages.repository.ts#L6-L14)).
- **`getMessagesForSession()`** — [L52-64](src/repositories/chatMessages.repository.ts#L52-L64): the full transcript, oldest first.
- **Routes** — [sessions.routes.ts](src/routes/sessions.routes.ts): `GET /sessions` ([L10-13](src/routes/sessions.routes.ts#L10-L13)), `GET /sessions/:sessionId/messages` ([L15-18](src/routes/sessions.routes.ts#L15-L18)), `DELETE /sessions/:sessionId` ([L20-23](src/routes/sessions.routes.ts#L20-L23)).
- **`deleteSession`** — [repository L122-124](src/repositories/chatMessages.repository.ts#L122-L124): deletes that conversation's messages; the document stays.
- **`DELETE /documents/:documentId`** — [documents.routes.ts:21-27](src/routes/documents.routes.ts#L21-L27): deletes the chunks ([`deleteChunksByDocumentId`](src/repositories/chunks.repository.ts#L39-L41)), then every chat message for it ([`deleteMessagesByDocumentId`, L131-133](src/repositories/chatMessages.repository.ts#L131-L133)), then the document row ([`deleteDocument`](src/repositories/documents.repository.ts#L28-L30)) — so no rows are left pointing at a dead `document_id`.

### Frontend

**Sessions API + hook**
- [api/sessions.ts](frontend/src/api/sessions.ts): `fetchSessions` ([L5-11](frontend/src/api/sessions.ts#L5-L11)), `fetchSessionMessages` ([L13-19](frontend/src/api/sessions.ts#L13-L19)), `deleteSession` ([L21-25](frontend/src/api/sessions.ts#L21-L25)).
- [hooks/useSessions.ts](frontend/src/hooks/useSessions.ts): holds `sessions`; `refresh` ([L9-19](frontend/src/hooks/useSessions.ts#L9-L19), wrapped in `useCallback` so its identity is stable) reloads the list; [L21-24](frontend/src/hooks/useSessions.ts#L21-L24) loads it on mount; `deleteSession` ([L26-37](frontend/src/hooks/useSessions.ts#L26-L37)) removes it from state on success.

**The heart: [hooks/useChat.ts](frontend/src/hooks/useChat.ts)** (chat state + the persistence trick)
- State — [L15-20](frontend/src/hooks/useChat.ts#L15-L20): active session id, active document, messages, input text, loading flag, and `restoring`.
- **Persistence, done right** — only the **active session id** goes into `localStorage` under `docmind:activeSessionId` ([L7](frontend/src/hooks/useChat.ts#L7)) — *never the messages*. On load ([L25-60](frontend/src/hooks/useChat.ts#L25-L60)): read the saved id → fetch `/sessions` **and** the transcript in parallel ([L34](frontend/src/hooks/useChat.ts#L34)) → cross-check the id against `/sessions` to recover which document it belongs to ([L36-42](frontend/src/hooks/useChat.ts#L36-L42); if it's gone, drop the stale id) → restore state ([L49-54](frontend/src/hooks/useChat.ts#L49-L54)). The source of truth stays the database; the browser just remembers *which* conversation was open.
- `startNewChat` ([L62-69](frontend/src/hooks/useChat.ts#L62-L69)), `resetToWelcome` ([L71-77](frontend/src/hooks/useChat.ts#L71-L77)), `openSession` ([L79-96](frontend/src/hooks/useChat.ts#L79-L96)) — the three ways the active conversation changes.

**Layout**
- [App.tsx](frontend/src/App.tsx) is a **thin orchestrator**: it calls the three hooks ([L14-28](frontend/src/App.tsx#L14-L28)), holds sidebar open/collapsed flags ([L33-34](frontend/src/App.tsx#L33-L34)), defines handlers that connect them — `handleUpload` ([L36-45](frontend/src/App.tsx#L36-L45)), `handlePickDocument` ([L47-51](frontend/src/App.tsx#L47-L51)), `handleSelectSession` ([L72-76](frontend/src/App.tsx#L72-L76)), `handleNewChat` ([L78-82](frontend/src/App.tsx#L78-L82)) — and renders `<Sidebar>` + `<ChatView>` ([L119-156](frontend/src/App.tsx#L119-L156)).
- **Deleting with a confirm step** — `handleDeleteDocument` ([L84-104](frontend/src/App.tsx#L84-L104)) and `handleDeleteSession` ([L106-117](frontend/src/App.tsx#L106-L117)) use `window.confirm` first; if the deleted item was the open one, they call `resetToWelcome()` (so you never stare at a dead conversation); deleting a document also calls `refreshSessions()` ([L101](frontend/src/App.tsx#L101)) because its sessions vanished server-side.
- [components/sidebar/Sidebar.tsx:18-65](frontend/src/components/sidebar/Sidebar.tsx#L18-L65): brand + collapse toggle + "New chat" button + the history list; collapsed mode hides the labels/list ([L37](frontend/src/components/sidebar/Sidebar.tsx#L37), [L53](frontend/src/components/sidebar/Sidebar.tsx#L53), [L56-63](frontend/src/components/sidebar/Sidebar.tsx#L56-L63)).
- [components/sidebar/HistoryList.tsx](frontend/src/components/sidebar/HistoryList.tsx): [`groupLabel` L11-22](frontend/src/components/sidebar/HistoryList.tsx#L11-L22) buckets a date into *Today / Yesterday / Previous 7 days / Older* by comparing calendar days; [L39-45](frontend/src/components/sidebar/HistoryList.tsx#L39-L45) groups the sessions; each item has a select button and a hover-revealed trash button ([L55-80](frontend/src/components/sidebar/HistoryList.tsx#L55-L80)); empty state at [L30-37](frontend/src/components/sidebar/HistoryList.tsx#L30-L37).
- The old single 500+-line `App.tsx` was split into `api/`, `types/`, `hooks/`, `utils/`, `components/` — the layers in the [big-picture section](#0-the-big-picture).

### Takeaway
Persistence via **"remember the pointer, re-fetch the data"** — a refresh resumes the exact conversation, and the database remains the single source of truth.

---

# Phase 3 — Streaming

**Why stream:** an LLM produces its answer word by word. Waiting for the *whole* answer before showing anything feels slow; showing words as they're generated feels instant. Streaming = send each piece as it's ready.

---

## Step 3.1 — SSE mechanics (`/tick`, now deleted)

### Why we need it
Before mixing streaming with the whole chat pipeline, learn the *transport* in isolation. This step built a throwaway endpoint, then it was deleted. To see the original code: `git show dfb1061:src/index.ts` (the commit that added it) and look for `/tick`. It was:

```ts
app.get('/tick', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  let count = 0
  const interval = setInterval(() => {
    count++
    res.write(`data: tick ${count}\n\n`)
    if (count >= 5) { clearInterval(interval); res.end() }
  }, 1000)

  req.on('close', () => clearInterval(interval))
})
```

### What is SSE (Server-Sent Events)?
A tiny protocol on top of ordinary HTTP: the server keeps the response **open** and writes text events into it over time. The browser reads them with the built-in **`EventSource`** API. It's one-directional (server → browser), which is exactly what "stream an answer" needs — simpler than WebSockets, and it works through normal HTTP.

### The pieces
- **Headers**: `Content-Type: text/event-stream` tells the browser "this is an event stream, don't wait for it to end"; `Cache-Control: no-cache` stops buffering/caching; `Connection: keep-alive` keeps the connection open.
- **`res.write(...)` vs `res.json(...)`**: `res.json` sends everything and ends the response. `res.write` sends a piece and **leaves the response open**. `res.end()` closes it.
- **Event format**: each event is lines of `field: value`, ended by a **blank line** (`\n\n`). The blank line is what separates events.
  ```
  data: tick 1

  data: tick 2

  ```
  A named event adds an `event:` line: `event: done\ndata: {}\n\n`. An event with no name is the default "message" event.
- **`req.on('close', …)`**: if the browser disconnects early, stop the timer; otherwise it would keep writing to a dead connection forever.

### Takeaway
Streaming is nothing more than "write pieces into a response that stays open, in the `data:…\n\n` format". Step 3.2 applies exactly this to the chat reply.

---

## Step 3.2 — Streaming the real chat reply

**Files:** [chat.routes.ts:42-101](src/routes/chat.routes.ts#L42-L101) (`GET /chat-stream`), [llm.service.ts:31-80](src/services/llm.service.ts#L31-L80) (`streamAnswer`), [utils/errors.ts](src/utils/errors.ts), shared [chat.service.ts](src/services/chat.service.ts).

### Why GET, not POST?
The browser's `EventSource` can **only send GET requests**. So `/chat-stream` takes `documentId`, `message`, `sessionId` as **query parameters** ([chat.routes.ts:44-46](src/routes/chat.routes.ts#L44-L46)) instead of a JSON body. (Trade-off: the message ends up in the URL — see [§7](#7-known-limitations-honest-list).)

### Part 1 — `streamAnswer()`: reading Gemini's stream — [llm.service.ts:36-80](src/services/llm.service.ts#L36-L80)

It's an **async generator** (`async function*`): instead of returning one value, it **`yield`s many** values over time, and the caller loops over them with `for await`.

- [L4-5](src/services/llm.service.ts#L4-L5): a different Gemini method, `streamGenerateContent` (there's no `stream: true` flag on `generateContent`).
- [L37-43](src/services/llm.service.ts#L37-L43): POST with `?alt=sse` — that switches Gemini's reply to real SSE (`data: {json}\n\n`).
- [L45-47](src/services/llm.service.ts#L45-L47): check `res.ok` and that a body exists.
- [L49-51](src/services/llm.service.ts#L49-L51): `res.body.getReader()` gives raw byte chunks as they arrive; `TextDecoder` turns bytes into text; `buffer` accumulates text.
- [L53-79](src/services/llm.service.ts#L53-L79): the read loop.
  - [L55-56](src/services/llm.service.ts#L55-L56): `reader.read()` → `{ done, value }`; stop when `done`.
  - [L62](src/services/llm.service.ts#L62): decode the bytes (`{ stream: true }` handles multi-byte characters split across chunks) and **normalize `\r\n` → `\n`**. Gemini ends SSE lines with `\r\n`, so without this the blank-line split below would never match. It's done on the *whole buffer* so a `\r\n` split across two network chunks is still caught. *(This was a real bug that was fixed.)*
  - [L68-69](src/services/llm.service.ts#L68-L69): split on `\n\n` (event boundary). `events.pop()` takes the **last piece back into `buffer`** — it may be a *partial* event; network chunks don't end neatly on event boundaries.
  - [L71-78](src/services/llm.service.ts#L71-L78): for each complete event: skip anything not starting with `data: `, `JSON.parse` the rest, pull `candidates[0].content.parts[0].text`, and `yield text`.

### Part 2 — the route: writing our own SSE — [chat.routes.ts:42-101](src/routes/chat.routes.ts#L42-L101)

Same 7-step pipeline as `/chat`, but steps 6–7 differ.

1. **Steps 1–5** via the shared `prepareChat()` ([L50-51](src/routes/chat.routes.ts#L50-L51)). If it says `ok: false`, send a normal JSON `400/404` — **this must happen *before* `writeHead`**, because once SSE headers are sent, the status code can no longer change.
2. **Open the stream** — [L57-61](src/routes/chat.routes.ts#L57-L61): `res.writeHead(200, { 'Content-Type': 'text/event-stream', … })`.
3. **First event: `meta`** — [L62-67](src/routes/chat.routes.ts#L62-L67): sends `{ sessionId, sources }` *before any text*. The frontend needs the `sessionId` immediately (for a new thread) and can show the sources while the answer is still typing.
4. **Stream the pieces** — [L69-77](src/routes/chat.routes.ts#L69-L77): `for await (const piece of streamAnswer(prompt))` → append to `fullAnswer` and `res.write('data: {"text": piece}\n\n')`. We keep `fullAnswer` so we can save the *complete* reply afterwards.
5. **Save the reply** — [L88-95](src/routes/chat.routes.ts#L88-L95): `insertMessage(..., 'assistant', fullAnswer)` in its own `try/catch`. The user already has the full answer by now, so a failed save is **logged but not sent as an error**.
6. **Finish** — [L97-98](src/routes/chat.routes.ts#L97-L98): `event: done` then `res.end()`.

**The event protocol** (the frontend depends on this exactly):

| Event | Payload | When |
|---|---|---|
| `meta` (named) | `{ sessionId, sources }` | once, first |
| *(unnamed `data:`)* | `{ text }` | once per piece |
| `done` (named) | `{}` | after the reply is saved |
| `error` (named) | `{ error }` | on failure |

What the wire looks like:
```
event: meta
data: {"sessionId":"…","sources":[{"content":"…","distance":0.31}, …]}

data: {"text":"RAG is a "}

data: {"text":"technique that…"}

event: done
data: {}
```

### Part 3 — three places errors can happen
1. **Before the stream opens** (embedding/search/DB fails): [`withErrorHandling(..., { sse: true })`, errors.ts:36-64](src/utils/errors.ts#L36-L64) catches it. Because `EventSource` **can't read the body of a non-200 response** (it only sees "connection error"), the handler sends a real `event: error` frame with status 200 ([L50-56](src/utils/errors.ts#L50-L56)).
2. **Mid-stream** (Gemini drops): the `catch` at [chat.routes.ts:78-83](src/routes/chat.routes.ts#L78-L83) writes an `event: error` frame, ends, and logs.
3. **Saving the reply fails**: logged only, stream still ends with `done` ([L91-95](src/routes/chat.routes.ts#L91-L95)).

### Takeaway
SSE = headers + `res.write` in the `data:…\n\n` format. The two subtle parts are *parsing Gemini's byte stream correctly* (buffering partial events, `\r\n`) and *reporting errors in-band* (since a stream can't change its status code after it starts).

---

## Step 3.2F — Streaming in the frontend

**Files:** [api/chat.ts:30-90](frontend/src/api/chat.ts#L30-L90), [hooks/useChat.ts:98-175](frontend/src/hooks/useChat.ts#L98-L175), [ChatPanel.tsx](frontend/src/components/chat/ChatPanel.tsx).

### `streamChatMessage()` — the `EventSource` wrapper, [api/chat.ts:40-90](frontend/src/api/chat.ts#L40-L90)
- [L46-49](frontend/src/api/chat.ts#L46-L49): builds the URL with `URLSearchParams` (which also URL-encodes the message safely).
- [L53](frontend/src/api/chat.ts#L53): `new EventSource(url)` opens the connection.
- Four listeners map SSE events to callbacks (`StreamHandlers`, [L30-35](frontend/src/api/chat.ts#L30-L35)):
  - `meta` → [L55-59](frontend/src/api/chat.ts#L55-L59) → `onMeta`
  - default `message` → [L61-64](frontend/src/api/chat.ts#L61-L64) (`source.onmessage`) → `onChunk(text)`
  - `done` → [L66-70](frontend/src/api/chat.ts#L66-L70) → `onDone`, then `source.close()`
  - `error` → [L76-87](frontend/src/api/chat.ts#L76-L87). The native `error` event fires both for our own `event: error` frames (**has `e.data`**) and for plain connection failures (**no `e.data`**) — the code handles the two cases with different messages.
- **Why `source.close()` matters (it's easy to miss):** `EventSource` **automatically reconnects** when a connection ends. If we didn't close on `done`/`error`, the browser would re-issue the GET and **send the same question again**. Closing stops that.
- [L89](frontend/src/api/chat.ts#L89): returns a cleanup function that closes the connection.

### `sendMessage()` — [useChat.ts:98-175](frontend/src/hooks/useChat.ts#L98-L175)
- [L99-106](frontend/src/hooks/useChat.ts#L99-L106): ignore empty messages, no active document, or a reply already in flight.
- [L108-110](frontend/src/hooks/useChat.ts#L108-L110): `isNewSession` and the `sessionId` (existing, or a fresh `crypto.randomUUID()`).
- [L117-119](frontend/src/hooks/useChat.ts#L117-L119): **optimistically** show the user's message right away, clear the input, set loading.
- [L125-133](frontend/src/hooks/useChat.ts#L125-L133) `appendToAssistantBubble`: grows the last assistant message by each piece. **It's written as a pure function of `prev`** — "the bubble being streamed into is the last message in the array" — never a variable mutated inside the callback. In dev, React StrictMode calls state updaters twice with the same input to catch impure code; a mutated variable would double-append text.
- [L135-174](frontend/src/hooks/useChat.ts#L135-L174): wraps the callback-style stream in a `Promise` so `await sendMessage()` completes when the stream ends.
  - `onMeta` ([L137-150](frontend/src/hooks/useChat.ts#L137-L150)): for a new thread, save the session id (state + `localStorage`); add an **empty** assistant bubble with its `sources` already attached.
  - `onChunk` ([L151](frontend/src/hooks/useChat.ts#L151)): append text.
  - `onDone` ([L152-157](frontend/src/hooks/useChat.ts#L152-L157)): refresh the sidebar list (`onMessageSent` = `refreshSessions`), stop loading, resolve.
  - `onError` ([L158-172](frontend/src/hooks/useChat.ts#L158-L172)): stop loading; if the empty placeholder is still the last message, **replace** it with the error bubble instead of leaving a blank bubble above it.

### `ChatPanel` polish — [ChatPanel.tsx](frontend/src/components/chat/ChatPanel.tsx)
- [L21](frontend/src/components/chat/ChatPanel.tsx#L21) `streamingStarted`: true once the assistant bubble has real text. Until then (retrieval + first token) the "Thinking…" bubble stays ([L44](frontend/src/components/chat/ChatPanel.tsx#L44)).
- [L35-41](frontend/src/components/chat/ChatPanel.tsx#L35-L41): the empty placeholder is **not rendered**, so you never see a blank bubble beside "Thinking…".
- [L23-27](frontend/src/components/chat/ChatPanel.tsx#L23-L27): auto-scroll follows the reply as it *grows* (depends on the last message's length, not just the count), using instant scroll while streaming and smooth otherwise.

### Result
The reply types out word by word in the chat bubble, sources appear immediately, the sidebar updates when it finishes, and history still works on the next turn.

---

## Step 3.3 — Multi-document chat

**Files:** [config.ts:13-14](src/config.ts#L13-L14), [chunks.repository.ts:45-86](src/repositories/chunks.repository.ts#L45-L86), [chat.service.ts](src/services/chat.service.ts), [chatMessages.repository.ts:95-100](src/repositories/chatMessages.repository.ts#L95-L100), and on the frontend [types/document.ts](frontend/src/types/document.ts), [NewChatScreen.tsx](frontend/src/components/chat/NewChatScreen.tsx), [ChatView.tsx](frontend/src/components/chat/ChatView.tsx), [ChatSources.tsx](frontend/src/components/chat/ChatSources.tsx), [App.tsx](frontend/src/App.tsx).

### Why we need it
Until now every chat was pinned to **one** PDF. But a natural question is often about *all* your documents ("how do chunking and embeddings relate?" spans two guides). So the default becomes "search everything", and picking one PDF is the override.

### The design in one paragraph
`documentId` becomes optional. **Omitted, empty, or the sentinel `'all'` = search every document; a real id = search just that one.** The scope string is also what gets saved on the chat messages, so a session remembers which mode it was started in. No database change was needed (see below), and no new endpoint.

### Backend

- **The sentinel** — [config.ts:13-14](src/config.ts#L13-L14): `ALL_DOCUMENTS = 'all'` and a display label. Why a sentinel string instead of `NULL`? `chat_messages.document_id` is `NOT NULL`; making it nullable means altering the live Neon table. Storing `'all'` in the existing column needs no schema change at all.
- **`searchSimilar` — [chunks.repository.ts:56-86](src/repositories/chunks.repository.ts#L56-L86)**:
  - [`documentId?`](src/repositories/chunks.repository.ts#L56-L60) is now optional.
  - It returns [`SimilarChunk`](src/repositories/chunks.repository.ts#L47-L52) = `{ content, distance, documentId, filename }`. To get the filename it does a [`LEFT JOIN documents`](src/repositories/chunks.repository.ts#L76) — *why the source document's name matters:* so the answer and the UI can say **which PDF** each piece came from.
  - [The `where`](src/repositories/chunks.repository.ts#L83): a real `documentId` → `chunks.document_id = …`; otherwise → `documents.id IS NOT NULL`, i.e. **only chunks whose document exists in the `documents` table**. That last condition matters: older "orphan" chunks (test uploads from before Step 2.2, no `documents` row) would otherwise leak into answers as an "unknown document". Single-document mode is left untouched so an old session pinned to an orphan id still works.
- **`prepareChat` — [chat.service.ts:74-165](src/services/chat.service.ts#L74-L165)** (the *one* place the change lives, thanks to the earlier restructure):
  - [L80-88](src/services/chat.service.ts#L80-L88): absent/empty `documentId` → `ALL_DOCUMENTS`; a non-string (e.g. `?documentId=a&documentId=b` arrives as an array) → `400`. `searchAll` is the boolean the rest of the function branches on.
  - [L105-115](src/services/chat.service.ts#L105-L115): logs "across ALL documents" vs "scoped to this documentId", and passes `undefined` to `searchSimilar` for all-mode.
  - [L117-128](src/services/chat.service.ts#L117-L128): the 404 message differs ("No documents have been uploaded yet").
  - [L147-151](src/services/chat.service.ts#L147-L151): in all-mode each chunk is prefixed `[Source: filename]` before being joined into the context.
  - [L153-164](src/services/chat.service.ts#L153-L164): `sources` now include `documentId` and `filename`. Because `/chat-stream`'s `meta` event just forwards `prep.sources`, **the streaming route needed no change**.
- **The prompt — [buildChatPrompt, chat.service.ts:15-49](src/services/chat.service.ts#L15-L49)**: a new `multiDocument` flag. When true, the intro says the context comes from the user's *documents* (each labelled), and an extra instruction tells the model to **name the document it used** ("According to rag_guide.pdf, …"). With it false the prompt is exactly what it was before.
- **Session labels — [chatMessages.repository.ts:95-100](src/repositories/chatMessages.repository.ts#L95-L100)**: `listSessions()` labels an all-documents session "All documents" (there's no single file to look up).
- The routes, `insertMessage`, `getRecentMessages` and the SSE protocol are **unchanged**.

### Frontend

- **Constants — [types/document.ts:15-16](frontend/src/types/document.ts#L15-L16):** `ALL_DOCUMENTS = 'all'` (must match the backend) and its label.
- **`ChatSource` type — [types/chat.ts:1-8](frontend/src/types/chat.ts#L1-L8)**: gains `documentId` and `filename`.
- **Sources show their file — [ChatSources.tsx:21-24](frontend/src/components/chat/ChatSources.tsx#L21-L24)**: a filename label next to the distance.
- **Default choice on the landing screen — [NewChatScreen.tsx:44-53](frontend/src/components/chat/NewChatScreen.tsx#L44-L53)**: an "All documents (N)" chip, tinted as the default, shown only when there is more than one document to search. It calls `onPickAll`.
- **The scope toggle — [ChatView.tsx:54-74](frontend/src/components/chat/ChatView.tsx#L54-L74)**: with 2+ documents the header shows **"Searching in [All documents ▾]"**, a `<select>` of *All documents* plus each PDF. `value` is the active scope's `documentId`; changing it calls `onChangeScope`.
- **The handlers — [App.tsx:53-70](frontend/src/App.tsx#L53-L70)**: `handlePickAll` starts a new chat with `ALL_DOCUMENTS`; `handleChangeScope` starts a new chat for whichever scope was chosen. **Switching scope starts a *new* conversation on purpose**: a session's scope is fixed by the `documentId` its messages were saved with, so changing it mid-thread would make one conversation mix two scopes. The old one stays in the sidebar history.
- **No streaming/hook changes**: `useChat`/`streamChatMessage` already send `documentId` as a string, and `'all'` is just another string; a restored "All documents" session comes back from `/sessions` with the right label.
- Small wording changes: the empty-chat hint and the input placeholder no longer say "this document".

### Verified
Real requests against your data: single-document answers unchanged; omitted and `'all'` `documentId` both search everything; sources carry filenames; a cross-document question ("how do chunking and embeddings relate?") pulled chunks from `rag_guide.pdf` and `chunking_guide.pdf`; array `documentId` → 400; unknown id → 404; an old session pinned to an orphan id still answers; all test conversations deleted afterwards. In a real browser: the "All documents (5)" chip, the dropdown, filenames on sources, and scope switching all worked with no console errors.

### Takeaway
Adding this feature took *one function change plus a flag*, because the pipeline was already in one place. The honest tradeoff of "search everything" is dilution — the top 3 chunks are shared across all PDFs, so a vague or "meta" question can be answered from just one of them. Citing the source file per chunk is the mitigation, not a full fix.

---

# Phase 4 — Quiz generation (structured output)

**The whole phase in one paragraph:** so far the LLM has returned *prose* for a human to read. A quiz has to be *data* — five questions, four options each, one marked correct — that code can turn into a UI. LLMs are good at text and only *usually* right about exact shapes, so the rule is: **never use model output until it has been checked.** Zod, the tool you already use to validate request bodies, does the checking here — the model is just another untrusted client.

---

## Step 4.1 — Structured output with Zod

**Files:** [schemas/quiz.schema.ts](src/schemas/quiz.schema.ts), [step4-quiz-zod.ts](src/step4-quiz-zod.ts) (run with `npm run step4`), [chunks.repository.ts `sampleChunks`](src/repositories/chunks.repository.ts#L23-L34), [llm.service.ts `generateAnswer`](src/services/llm.service.ts#L10-L29). Reading material: [topics/08-structured-output-zod/README.md](topics/08-structured-output-zod/README.md).

### Why we need it
A chat reply can be slightly off and nobody is hurt. A quiz that comes back with 3 options, or with `correctIndex: "2"` (a string), or wrapped in ` ```json ` fences, crashes the UI far away from the real cause. Step 4.1 builds the safety net *first*, in a throwaway script, before any endpoint exists.

### What it does
Asks Gemini for a 5-question quiz about one stored PDF, in **two ways, several times each** — a plain "respond with ONLY JSON" prompt, and Gemini's structured-output mode — runs every reply through the same checker, and reports which passed and, for failures, exactly why.

### How it works

**The schema — [schemas/quiz.schema.ts](src/schemas/quiz.schema.ts)** (in its own file so Step 4.2's endpoint can reuse it)
- [L10-23](src/schemas/quiz.schema.ts#L10-L23) `QuizQuestion`: `question` is a non-empty string; `options` is an array with **exactly 4** entries ([L14](src/schemas/quiz.schema.ts#L14)); `correctIndex` is a **whole number from 0 to 3** ([L16](src/schemas/quiz.schema.ts#L16)) — so the string `"2"`, `1.5` and `4` are all rejected.
- [L18-23](src/schemas/quiz.schema.ts#L18-L23) `.refine(...)`: a **custom rule** the basic types can't express — all four options must be different. Without it, four identical options would pass the shape check and still be a useless question.
- [L25](src/schemas/quiz.schema.ts#L25) `Quiz` = an array of exactly 5 questions.
- [L29-30](src/schemas/quiz.schema.ts#L29-L30): `z.infer` gives the **TypeScript type from the same schema**, so the runtime check and the compile-time type can never drift apart.
- [L36-54](src/schemas/quiz.schema.ts#L36-L54) `quizResponseSchema`: the same shape written the way *Gemini's* structured-output mode wants it (an OpenAPI-style schema with uppercase types like `'ARRAY'`). It **asks** the model to follow the shape; Zod is what **verifies** it. They're two separate jobs, and the second is not optional.

**Picking chunks — [`sampleChunks`, chunks.repository.ts:23-34](src/repositories/chunks.repository.ts#L23-L34)**
Chat asks "which chunks are most relevant to this *question*?" A quiz has no question, so it needs **broad coverage** instead: this function loads a document's chunks in order (ids are serial, so id order = page order) and picks `count` **evenly spaced** ones (`0, 2, 4, 6` out of 8, for example). It's a new repository function, so SQL still lives only in repositories.

**Asking Gemini — [`generateAnswer`, llm.service.ts:10-29](src/services/llm.service.ts#L10-L29)**
It gained one optional parameter, [`generationConfig`](src/services/llm.service.ts#L11-L12), spread into the request body only when given ([L19](src/services/llm.service.ts#L19)). Chat leaves it out (unchanged behavior); the quiz passes `{ responseMimeType: 'application/json', responseSchema }` to switch on structured-output mode.

**The checker — [`checkQuiz`, step4-quiz-zod.ts:37-63](src/step4-quiz-zod.ts#L37-L63)** — the two-stage check every LLM response should go through:
1. **Is it JSON at all?** `JSON.parse`. If that fails, it also tries stripping ` ``` ` fences, purely to *tell you* whether that common habit was the cause.
2. **Is it the right JSON?** [`Quiz.safeParse`, L54](src/step4-quiz-zod.ts#L54) — `safeParse` never throws; it returns `{ success, data }` or `{ success: false, error }`, so the code can branch (retry, or report). On failure, Zod lists **every problem with the exact path**, like `0.options: expected array to have exactly 4 items`.

**The experiment — [`main`, step4-quiz-zod.ts:60-137](src/step4-quiz-zod.ts#L60-L137)**
- Picks your newest document (or the id you pass), samples 5 chunks ([L110](src/step4-quiz-zod.ts#L110)), and builds one prompt used for both modes ([`buildQuizPrompt`, L22](src/step4-quiz-zod.ts#L22)).
- [L114-120](src/step4-quiz-zod.ts#L114-L120): the two modes — plain (no config) vs structured (with the response schema).
- [L133](src/step4-quiz-zod.ts#L133): each run calls the model; an API error is counted as a failure rather than crashing the script.
- [L114](src/step4-quiz-zod.ts#L114): a pass/fail summary per mode.

**The bad-reply gallery — [`showBadReplyGallery`, step4-quiz-zod.ts:68-98](src/step4-quiz-zod.ts#L68-L98)**
Modern models rarely slip, so waiting for a real failure teaches slowly. Instead, 11 hand-made replies — one good, ten wrong in the ways real models go wrong (fenced JSON, a chatty sentence before the JSON, only 3 questions, 3 options, `"2"` as a string, index out of range, `1.5`, duplicate options, a missing field, an object instead of an array) — go through the same checker, with **no API calls**. Each shows which check caught it and why.

**Valid ≠ good — [the answer-position tally, step4-quiz-zod.ts:121-127](src/step4-quiz-zod.ts#L121-L127)**
Zod proves the *shape*, not the *sense*. So the script also counts where the model puts the correct answer across every valid quiz.

### Run it
`npm run step4` — optionally `npm run step4 -- <documentId> <runs-per-mode>`. (Don't confuse it with the Phase 1 `step2`/`step3` scripts — those wipe the chunks table; `step4` only *reads*.)

### What actually happened
- The gallery caught **all 10 bad replies**, each with a precise reason.
- Real runs: across three runs of the script, **every reply was valid in both modes — 17/17 plain and 17/17 structured**. This model almost never goes off-shape, so structured mode wasn't needed to get valid output here. That's a real finding, not a failure of the experiment: Zod is **insurance**, and you only see its value on the day the model slips.
- In the last run (50 questions), the correct answer landed at position 0/1/2/3 in **22% / 36% / 32% / 10%** of them — not stuck on the first option, but position 3 is under-used. A quiz with a predictable answer position is a weaker quiz, so Step 4.2 should **shuffle the options in code** (and remap `correctIndex`) after validating. Code, not the model, controls anything that must be reliable.

### Takeaway
Two separate jobs: **ask** for the shape (prompt, or the API's structured-output mode) and **verify** it (Zod). Trust nothing until it has passed the second one. Next, Step 4.2 turns this script into `POST /quiz`, adding the validate → retry-once habit.

---

## Step 4.2 — `POST /quiz`

**Files:** [services/quiz.service.ts](src/services/quiz.service.ts), [routes/quiz.routes.ts](src/routes/quiz.routes.ts), [app.ts:7](src/app.ts#L7) + [L34](src/app.ts#L34), [utils/pipelineLogger.ts:14](src/utils/pipelineLogger.ts#L14) + [L61-63](src/utils/pipelineLogger.ts#L61-L63).

### Why we need it
Step 4.1 proved the approach in a throwaway script. A real feature needs it as an endpoint the frontend can call, with the two production habits the topic README calls for: retry once instead of trusting a single reply, and don't leave "where the correct answer sits" up to the model's own habits — Step 4.1 measured that habit wasn't uniform.

### What it does
`POST /quiz` with `{ documentId }` returns `{ documentId, quiz }` — a validated 5-question quiz whose options have been shuffled so the correct answer's position is unpredictable.

### How it works

**`generateQuiz()` — [quiz.service.ts:96-159](src/services/quiz.service.ts#L96-L159)**
Mirrors `prepareChat()`'s shape: takes raw request input (`documentId: unknown`), never touches `req`/`res`, and returns `{ ok: false, status, error }` or `{ ok: true, ... }`.
1. **Validate** — [L99-102](src/services/quiz.service.ts#L99-L102): missing/non-string `documentId` → `400`. [L107-110](src/services/quiz.service.ts#L107-L110): the sentinel `'all'` is explicitly rejected → `400` — *why*: `sampleChunks` reads one document's chunks in reading order, and there's no single reading order across every PDF, so "all documents" has no sensible quiz to build.
2. **Sample** — [L117](src/services/quiz.service.ts#L117): `sampleChunks(documentId, CHUNKS_FOR_QUIZ)`, the same function and count (5, [L17](src/services/quiz.service.ts#L17)) as Step 4.1's script. Empty result → `404` ([L120-124](src/services/quiz.service.ts#L120-L124)).
3. **Prompt** — [L126](src/services/quiz.service.ts#L126): `buildQuizPrompt()`.
4. **Generate + validate + retry** — [L136-151](src/services/quiz.service.ts#L136-L151): a loop bounded by `MAX_ATTEMPTS = 2` ([L22](src/services/quiz.service.ts#L22)) — one real attempt plus one retry, never more. Each attempt calls `generateAnswer(prompt, generationConfig)` in **structured-output mode** ([L133](src/services/quiz.service.ts#L133): `{ responseMimeType: 'application/json', responseSchema: quizResponseSchema }` — chosen over the plain prompt because Step 4.1 showed it's at least as reliable), then `checkQuizReply(raw)`. The first valid reply shuffles and returns immediately ([L142-147](src/services/quiz.service.ts#L142-L147)); on failure the loop just tries again, logging the reason ([L149-150](src/services/quiz.service.ts#L149-L150)).
5. **Give up cleanly** — [L153-158](src/services/quiz.service.ts#L153-L158): if both attempts fail, `failed()` logs it and the function returns `{ ok: false, status: 502, error: '...' }` — a message a UI can show, not a crash. Step 4.1's real runs were 17/17 valid, so this path is rarely hit, but the code doesn't assume that.

**`buildQuizPrompt()` and `checkQuizReply()` — [quiz.service.ts:26-34](src/services/quiz.service.ts#L26-L34) and [L41-67](src/services/quiz.service.ts#L41-L67)**
Moved here from the Step 4.1 script, unchanged, so `npm run step4` and the real endpoint share one implementation instead of two copies — the same reasoning as `buildChatPrompt()` being shared by `/chat` and `/chat-stream`. [step4-quiz-zod.ts](src/step4-quiz-zod.ts) now imports them (see the Step 4.1 section above for what they do).

**Shuffling — [`shuffleQuiz`/`shuffleQuestion`, quiz.service.ts:71-87](src/services/quiz.service.ts#L71-L87)**
A Fisher–Yates shuffle per question: [L72-76](src/services/quiz.service.ts#L72-L76) builds an `order` array (`order[newPosition] = originalIndex`) and shuffles it in place, then [L78-82](src/services/quiz.service.ts#L78-L82) rebuilds `options` in that order and remaps `correctIndex` to `order.indexOf(q.correctIndex)` — wherever the originally-correct option ended up. *Why in code, not the prompt:* Step 4.1 measured the model's own placement across 50 questions — 22% / 36% / 32% / 10% for positions 0–3 — not uniform, and not something a prompt instruction can reliably fix. Zod proves the *shape* is right; this is the part of "make it good, not just valid" that has to live in code.

**The route — [quiz.routes.ts](src/routes/quiz.routes.ts)**
Thin, same shape as the other routes: [L11](src/routes/quiz.routes.ts#L11) `withErrorHandling('POST /quiz', ...)` catches real exceptions (network/DB) the same way `/chat` does; [L15-16](src/routes/quiz.routes.ts#L15-L16) calls `generateQuiz` and forwards its status/error unchanged; [L18](src/routes/quiz.routes.ts#L18) sends the quiz. **Deliberately not streamed** — unlike `/chat-stream`, half a JSON object is useless, so the client waits for the complete, checked result.

**Wiring** — [app.ts:7](src/app.ts#L7) imports `quizRouter`, [L34](src/app.ts#L34) mounts it, same pattern as the other three routers.

**A new log theme and a new helper — [pipelineLogger.ts:14](src/utils/pipelineLogger.ts#L14), [L61-63](src/utils/pipelineLogger.ts#L61-L63)**
`quiz` got its own color (`chalk.blueBright`), so its terminal trace is easy to tell apart from uploads (cyan) and chats (magenta). [`failed(reason)`](src/utils/pipelineLogger.ts#L61-L63) is a new red-line helper, deliberately distinct from `rejected()` (bad input) and `notFound()` (missing resource): "the request was valid, the work just never produced a usable result."

### What actually happened
Tested live on a spare port against real documents and Gemini:
- **Happy path:** a real 5-question quiz came back, options shuffled (correct answers landed at positions 2, 0, 1, 1, 3 across the five questions in one run — not clustered), a full `[1/4]`–`[4/4]` pipeline trace in the terminal, `attempt 1/2` succeeded both times it was tried.
- **All four bad-input cases** returned the right status: missing `documentId` → `400`, `documentId: 'all'` → `400`, an unknown id → `404`, a non-string (array) `documentId` → `400`.
- **Regression-checked the refactor:** re-ran `npm run step4` after moving `buildQuizPrompt`/`checkQuizReply` into `quiz.service.ts` — the bad-reply gallery still caught all 10 broken samples, and real runs still produced valid quizzes. One run hit a transient network `fetch failed` — not a shape problem, and a good reminder that a thrown network error (bubbles up, not retried by this loop) and an invalid-shape reply (retried) are handled differently on purpose.

### Takeaway
Two production habits from the Step 4.1 topic notes, both real code now: **retry once, then fail cleanly** (never trust one reply, never loop forever), and **don't leave "must be reliable" to the model** — shuffling in code is a direct, load-bearing response to a real measurement from Step 4.1, not a hypothetical improvement.

---

## Step 4.2F — Frontend: quiz UI

**Files:** [types/quiz.ts](frontend/src/types/quiz.ts), [api/quiz.ts](frontend/src/api/quiz.ts), [hooks/useQuiz.ts](frontend/src/hooks/useQuiz.ts), [components/quiz/QuizModal.tsx](frontend/src/components/quiz/QuizModal.tsx), and edits to [ChatView.tsx](frontend/src/components/chat/ChatView.tsx), [App.tsx](frontend/src/App.tsx), [App.css](frontend/src/App.css).

### Why we need it
Step 4.2 made a quiz exist as a JSON response. Nobody actually takes a quiz through Postman — this step is what turns it into something you can see and click through in the browser, the same way Step 2.3F turned `/chat`'s JSON into a real chat UI.

### What it does
A **"Generate quiz"** button appears in the chat header whenever a single real document is open. Clicking it opens an overlay showing a loading state, then the 5 questions with their 4 options each as selectable radio buttons — or a clean error with a retry button if generation failed.

### How it works

**The type — [types/quiz.ts](frontend/src/types/quiz.ts)**
`QuizQuestion` / `Quiz` mirror the backend's Zod shape exactly (`question`, `options: string[]`, `correctIndex`) — no validation on this side, since the backend already validated it with Zod before sending it; the frontend just needs the matching TypeScript shape.

**The API call — [`generateQuiz`, api/quiz.ts:13-26](frontend/src/api/quiz.ts#L13-L26)**
A plain `fetch` + `await`, the same shape as `sendChatMessage`. **Not streamed**, on purpose — same reasoning as the backend not streaming `/quiz`: a half-received quiz can't be validated or rendered, so there's nothing to gain from streaming it and it would only add complexity.

**The hook — [`useQuiz`, hooks/useQuiz.ts](frontend/src/hooks/useQuiz.ts)**
Deliberately its **own** hook, not folded into `useChat` — a quiz isn't a message in the conversation, it's a one-off request the button triggers, rendered in its own overlay on top of whatever chat happens to be open.
- State: `open` (is the modal showing), `loading`, `error`, `quiz`, plus `documentId`/`filename` kept around so `regenerate()` knows what to re-request.
- `generate(docId, docFilename)` ([L18-36](frontend/src/hooks/useQuiz.ts#L18-L36)): opens the modal immediately (`setOpen(true)`) and shows loading *before* the request even starts, so the button feels responsive; on success sets `quiz`, on failure sets `error` — same try/catch/finally shape as `useDocuments.uploadFile`.
- `regenerate()` ([L40-42](frontend/src/hooks/useQuiz.ts#L40-L42)): re-runs `generate()` for the same document — used by both the modal's "Try again" (after an error) and "Regenerate" (a fresh set of questions) buttons, since they're the same action from two different starting states.
- `close()` ([L44-46](frontend/src/hooks/useQuiz.ts#L44-L46)): just hides the modal; the last quiz/error is left in state rather than cleared, though nothing currently reopens without calling `generate()` again, which resets it anyway.

**The modal — [QuizModal.tsx](frontend/src/components/quiz/QuizModal.tsx)**
- [L30](frontend/src/components/quiz/QuizModal.tsx#L30): renders nothing at all when `open` is false — simplest possible way to keep an always-mounted component out of the way.
- Three body states, each gated on `loading`/`error`/`quiz` ([L46-88](frontend/src/components/quiz/QuizModal.tsx#L46-L88)): a spinner while waiting (with a "usually 10–30 seconds" hint, since a silent multi-second wait feels broken otherwise), a red error state with a retry button, or the question list.
- **Answer selection — [L22](frontend/src/components/quiz/QuizModal.tsx#L22), [L72-84](frontend/src/components/quiz/QuizModal.tsx#L72-L84)**: `selected` is a `Record<questionIndex, optionIndex>`, kept **local to this component** — nothing is sent anywhere yet, because there's no grading endpoint to send it to (that's the optional Step 4.3). Real `<input type="radio">` elements grouped by `name={quiz-question-${qi}}` so each question's options behave as one radio group, same as native HTML forms.
- **Resetting on a fresh quiz — [L24-28](frontend/src/components/quiz/QuizModal.tsx#L24-L28)**: a `useEffect` clears `selected` whenever the `quiz` array reference changes (i.e. a new `generate()`/`regenerate()` call finished) — otherwise old answers would visually linger against new questions.
- **A progress counter — [L91-101](frontend/src/components/quiz/QuizModal.tsx#L91-L101)**: `"N of 5 answered"`, purely informational (there's no submit step yet), plus the regenerate button.

**Wiring the button — [ChatView.tsx:86-100](frontend/src/components/chat/ChatView.tsx#L86-L100)**
Shown only when `activeDocument && activeDocument.documentId !== ALL_DOCUMENTS` ([L89](frontend/src/components/chat/ChatView.tsx#L89)) — hidden on the New Chat screen (no `activeDocument` yet) and under "All documents" scope, because [`sampleChunks`](src/repositories/chunks.repository.ts#L23-L34) reads one document's chunks in reading order and there's no such order across every PDF. `disabled={quizLoading}` stops a second click from firing a second Gemini request while one is already running.

**Wiring in `App.tsx`**
- [L31](frontend/src/App.tsx#L31): `const quiz = useQuiz()`.
- `handleGenerateQuiz()` — [L79-83](frontend/src/App.tsx#L79-L83): re-checks the same precondition the button's visibility already enforces (never trust that a handler is only reachable the way the UI intends) before calling `quiz.generate(...)`.
- `<QuizModal ... />` — [L171-179](frontend/src/App.tsx#L171-L179): rendered once at the top level of `app-shell`, alongside `<ChatView>`, so it overlays the whole app regardless of what's currently on screen underneath.

**CSS — [App.css](frontend/src/App.css)**
New rules for the header button ([L677-705](frontend/src/App.css#L677-L705)) and the modal (`.quiz-overlay` [L707-717](frontend/src/App.css#L707-L717), `.quiz-modal` [L719-728](frontend/src/App.css#L719-L728), question/option styling [L781-832](frontend/src/App.css#L781-L832)) — all built from the same design tokens (`--color-*`, `--space-*`, `--radius-*`) the rest of the app uses, so dark mode and the existing visual language (card shapes, the green accent on a selected option) carry over automatically with no extra work. The mobile media query gained an icon-only variant of the button ([L916-918](frontend/src/App.css#L916-L918)) and a full-screen modal on small viewports, matching how the sidebar already becomes a drawer below 900px.

### What actually happened
Tested live in a headless browser against the real running app:
- The button was **absent** on the New Chat screen, **present** after picking a single document, and **disappeared again** after switching the header's scope dropdown to "All documents".
- Clicking it showed the loading state, then a real 5-question quiz with 4 options each rendered from the backend.
- Selecting one option per question updated the progress counter correctly (`5 of 5 answered`); clicking **Regenerate** produced a fresh quiz and reset the counter to `0 of 5 answered`, confirming the reset effect works.
- Closing via the **X** button removed the overlay.
- **Zero console errors**, and a screenshot confirmed the modal's colors, card shapes and spacing visually match the rest of the app (same green accent used for a selected radio option as elsewhere for a selected/active state).

### Takeaway
Same pattern as every earlier `*F` step (2.1F, 2.3F, 3.2F): the backend endpoint existing isn't the finish line — a feature isn't "done, done" until it's something you can actually click through. Keeping the quiz's state in its own hook, separate from `useChat`, is what made wiring it in almost mechanical: `App.tsx` just holds one more hook and renders one more always-present overlay component, without touching how chat or sessions work at all.

---

## Step 4.3 + 4.3F — checking answers

**Files:** [components/quiz/QuizModal.tsx](frontend/src/components/quiz/QuizModal.tsx), [App.css:826-909](frontend/src/App.css#L826-L909). No backend files — see below for why.

### Why we need it
Step 4.2F let you *see and answer* a quiz. It never told you if you got anything right. This step closes that loop.

### The decision that shapes everything here: no `POST /quiz/check`
The roadmap describes a tiny endpoint that takes `{ questionIndex, chosenIndex }` and returns correct/incorrect. It wasn't built, on purpose. Here's the reasoning:
- Quizzes aren't stored anywhere server-side — there's no `quizId`, no `quiz_runs` table, nothing. `POST /quiz` generates one, sends it down, and forgets it.
- So a `/quiz/check` endpoint would have **no independent truth to check against**. Either the client sends `correctIndex` along with its guess (the server just compares two numbers the client already had), or the endpoint doesn't really exist in any meaningful sense.
- A round trip that can't actually catch a lying client isn't a real security boundary — it's just extra network latency dressed up as one. Building a *trustworthy* check would mean persisting quizzes server-side, which is a bigger change than this optional step is meant to be.
- So grading happens **entirely in `QuizModal.tsx`**, using the `correctIndex` values already sitting in the `quiz` prop from Step 4.2F.

### How it works

**New state — [QuizModal.tsx:30](frontend/src/components/quiz/QuizModal.tsx#L30)**
`checked` (boolean). Before it's true, the modal behaves exactly as it did in Step 4.2F — pick an option per question, nothing graded. Once true, radios lock and colors appear.

**Reset alongside the existing effect — [L35-38](frontend/src/components/quiz/QuizModal.tsx#L35-L38)**
The `useEffect` that already cleared `selected` on a fresh `quiz` array now also resets `checked` — so Regenerate doesn't just get you new questions, it also un-grades the modal back to answerable.

**The score — [L42](frontend/src/components/quiz/QuizModal.tsx#L42)**
`quiz.filter((q, qi) => selected[qi] === q.correctIndex).length` — computed on every render (cheap, `quiz` is only 5 items), not stored in its own state. No need to persist a value that's fully derivable from `selected` and `quiz`.

**Per-option grading — [L89-105](frontend/src/components/quiz/QuizModal.tsx#L89-L105)**
Two booleans per option, both gated on `checked`:
- `isCorrectOption` ([L89](frontend/src/components/quiz/QuizModal.tsx#L89)): true for the actually-correct option, **regardless of what was picked** — so the right answer is always revealed, not just "was your pick right".
- `isWrongPick` ([L90](frontend/src/components/quiz/QuizModal.tsx#L90)): true only for a selected option that wasn't correct.

These map to CSS classes appended to `.quiz-option` ([L94](frontend/src/components/quiz/QuizModal.tsx#L94)), plus a `CheckCircle`/`XCircle` icon rendered inline ([L104-105](frontend/src/components/quiz/QuizModal.tsx#L104-L105)). `disabled={checked}` on the radio input itself ([L100](frontend/src/components/quiz/QuizModal.tsx#L100)) is what actually locks answers in — not just a visual state, the input genuinely can't be changed anymore.

**The footer — [L118-138](frontend/src/components/quiz/QuizModal.tsx#L118-L138)**
Swaps between "N of 5 answered" + a **Check answers** button (before grading) and "N of 5 correct" (after). Check answers just does `setChecked(true)` — no request, no async, the data was already there.

### A real bug, found by looking at a screenshot, not by reading the code

The first version looked right in the code and typechecked cleanly, but a screenshot showed a wrong-but-selected option rendered with a **green background and a red ✕ icon at the same time** — confusing, and wrong.

The cause: [`.quiz-option:has(input:checked)`, added back in Step 4.2F](frontend/src/App.css#L826), gives the "you picked this" highlight. Once grading locks the radio, `input:checked` is still true for whichever option was picked, so that rule kept firing — and `:has()` gives it *higher specificity* than the plain `.quiz-option--incorrect` class, so the old green styling won even though the incorrect-red rule appeared later in the file. CSS specificity, not React state, was the actual bug.

**The fix — [App.css:826](frontend/src/App.css#L826)**: `.quiz-option:has(input:checked:not(:disabled))`. Since grading disables the radio ([QuizModal.tsx:100](frontend/src/components/quiz/QuizModal.tsx#L100)), this selector stops matching the instant `checked` becomes true, and only [`.quiz-option--correct`](frontend/src/App.css#L841)/[`.quiz-option--incorrect`](frontend/src/App.css#L848) apply from then on. One word (`:not(:disabled)`) fixed it.

**The rest of the CSS** ([`.quiz-modal-score`](frontend/src/App.css#L883), [`.quiz-modal-footer-actions`](frontend/src/App.css#L889), [`.quiz-check-button`](frontend/src/App.css#L895)) is unremarkable layout work using the same design tokens as everything else in the app.

### What actually happened
Tested live in a headless browser, twice — once before the CSS fix (to confirm the bug was real, not imagined) and once after:
- Answered all 5 questions, clicked **Check answers**: radios locked (confirmed by attempting to click a different option afterward — the score didn't change), the score read `"2 of 5 correct"`, 5 options were marked correct (one per question) and 3 were marked incorrect (the wrong picks).
- **Before the fix:** a screenshot showed a wrong pick with a green background and a red icon simultaneously.
- **After the fix:** the same wrong pick showed solid red; the actually-correct option showed solid green even though it hadn't been picked.
- **Regenerate** produced a new quiz, and both the score and every correct/incorrect class disappeared — confirming the shared reset effect works for grading too.
- Zero console errors throughout.

### Takeaway
Not every "endpoint the roadmap describes" is worth building — sometimes the honest engineering call is recognizing an endpoint would be theater (no real data behind it) and building the simpler, equally-correct version instead. And a screenshot caught a bug that reading the code, and even `tsc`, didn't: CSS specificity bugs are invisible in TypeScript and only show up when you actually look at the rendered page.

---

## 5. Cross-cutting: errors, logging, and the backend restructure

### Error handling on the backend — [utils/errors.ts](src/utils/errors.ts)
Every chat step talks to the network (Gemini, Neon) and can fail on a bad connection. Without handling, that becomes a bare `500` and the real cause is buried in a stack trace.
- **`withErrorHandling(label, handler, { sse })`** — [L36-64](src/utils/errors.ts#L36-L64): wraps a route handler in `try/catch`. On failure it logs the real cause to the terminal and sends the client a clear message ([config.ts:25-26](src/config.ts#L25-L26)): a plain route → `503 { error }`; a stream route → an `event: error` frame. If headers were already sent it just ends the response.
- **`summarizeError(err)`** — [L16-34](src/utils/errors.ts#L16-L34): Drizzle's failed-query errors embed the SQL **and every bound parameter** — for a vector search that's all 3072 numbers, drowning the real reason. This prints only: the first line of the message, the chain of `cause`s (where `ECONNRESET` etc. live), and the first stack frame inside *our* code (`where: …`). Never `console.error(err)` raw in a route.
- **Where it's applied:** only `/chat` and `/chat-stream`. The upload and the read/delete routes are *not* wrapped (pre-existing behavior; Express's default handler answers those). Also note: a wrong API key currently shows the "check your internet connection" message, because the wrapper doesn't distinguish failure types.

### Frontend logger
[utils/logger.ts](frontend/src/utils/logger.ts): `log.info/warn/error(scope, …)` prints `[DocMind:<scope>]` in colour. Filter the browser console by `[DocMind:` (or `[DocMind:useChat]`) to trace upload → chat → session flow. Toggle everything with `ENABLED` ([L4](frontend/src/utils/logger.ts#L4)).

### The backend restructure (`index.ts` 449 lines → 7)
The original `index.ts` held setup, helpers, error handling, and every route. It was split with **no behavior change**:

| Old (inside `index.ts`) | Now |
|---|---|
| server start | [index.ts:5-7](src/index.ts#L5-L7) |
| `express()`, `json`, `cors`, `GET /`, mounting | [app.ts](src/app.ts) (no `listen`, so tests can import it) |
| `HISTORY_LIMIT`, `PORT`, CORS origin, error message | [config.ts](src/config.ts) |
| `chunkText` | [utils/chunkText.ts](src/utils/chunkText.ts) |
| `summarizeError`, `withErrorHandling` | [utils/errors.ts](src/utils/errors.ts) |
| `buildChatPrompt` + chat steps 1–5 (duplicated in `/chat` and `/chat-stream`) | [chat.service.ts](src/services/chat.service.ts) (`prepareChat`, one copy) |
| upload steps 2–5 | [ingestion.service.ts](src/services/ingestion.service.ts) (`ingestPdf`) |
| `/documents`, `/upload` | [documents.routes.ts](src/routes/documents.routes.ts) |
| `/sessions…` | [sessions.routes.ts](src/routes/sessions.routes.ts) |
| `/chat`, `/chat-stream` | [chat.routes.ts](src/routes/chat.routes.ts) |

Why: the chat code was duplicated (Step 3.3 would have meant editing it twice), the upload logic needs to be a plain function for the future background worker (Phase 6), and tests need the app without opening a port.

---

## 6. One chat message, end to end

Follow a single message from the keyboard to the screen (streaming version):

1. **You type and press send.** [ChatInputForm.tsx:12-17](frontend/src/components/chat/ChatInputForm.tsx#L12-L17) trims it and calls `onSubmit` → `App` passes `sendMessage` from [useChat.ts:98](frontend/src/hooks/useChat.ts#L98).
2. **The user bubble appears immediately** ([useChat.ts:117](frontend/src/hooks/useChat.ts#L117)); loading = true → "Thinking…" ([ChatPanel.tsx:44](frontend/src/components/chat/ChatPanel.tsx#L44)).
3. **`EventSource` opens** `GET /chat-stream?documentId=…&message=…&sessionId=…` ([api/chat.ts:46-53](frontend/src/api/chat.ts#L46-L53)). The browser first checks CORS ([app.ts:17-21](src/app.ts#L17-L21)).
4. **Express routes it** — [app.ts:32](src/app.ts#L32) mounts `chatRouter`; [chat.routes.ts:42](src/routes/chat.routes.ts#L42) handles it inside `withErrorHandling`.
5. **`prepareChat()`** ([chat.service.ts:74](src/services/chat.service.ts#L74)):
   - validates input → [embeddings.service.ts](src/services/embeddings.service.ts) calls Gemini to embed the question →
   - [`searchSimilar`](src/repositories/chunks.repository.ts#L56-L86) runs the pgvector `<=>` query on Neon → top 3 chunks →
   - [`getRecentMessages`](src/repositories/chatMessages.repository.ts#L30-L42) loads the last 8 messages →
   - [`insertMessage`](src/repositories/chatMessages.repository.ts#L17-L24) saves your message →
   - [`buildChatPrompt`](src/services/chat.service.ts#L15-L49) assembles context + history + question.
6. **SSE opens**; `meta` (session id + sources) is sent ([chat.routes.ts:57-67](src/routes/chat.routes.ts#L57-L67)). The frontend adds the empty assistant bubble with sources ([useChat.ts:137-150](frontend/src/hooks/useChat.ts#L137-L150)).
7. **[`streamAnswer`](src/services/llm.service.ts#L36-L80)** calls Gemini's streaming endpoint; each parsed piece is `yield`ed, and the route writes it as `data: {"text": …}` ([chat.routes.ts:74-77](src/routes/chat.routes.ts#L74-L77)).
8. **Each piece reaches `onmessage`** ([api/chat.ts:61-64](frontend/src/api/chat.ts#L61-L64)) → `appendToAssistantBubble` → React re-renders; the bubble grows and the view scrolls ([ChatPanel.tsx:23-27](frontend/src/components/chat/ChatPanel.tsx#L23-L27)).
9. **The stream ends**: the server saves the full reply ([chat.routes.ts:88-95](src/routes/chat.routes.ts#L88-L95)) and sends `event: done`; the browser closes the connection and `onDone` refreshes the sidebar ([useChat.ts:152-157](frontend/src/hooks/useChat.ts#L152-L157)).

Along the way, the backend terminal shows the colourful `[1/7] … [7/7]` trace, and the browser console shows `[DocMind:…]` lines.

---

## 7. Known limitations (honest list)

Things that work but are deliberately simple — good to know, and several are future roadmap steps.

- **Uploads embed chunks one at a time**, so big PDFs are slow → Phase 6 (BullMQ background jobs).
- **`chunkText` is naive** (fixed 500 words, no overlap, flattens newlines) → advanced chunking topic.
- **Search has no vector index**, so it compares against every chunk → fine now, see INDEXING-AT-SCALE for later.
- **A chat's scope is fixed when it starts** (one document *or* all documents), because messages are saved against one `documentId`. Switching scope in the header starts a new chat instead of changing the current one.
- **"All documents" retrieval is only as good as top-3.** Chunks from several PDFs compete for the same 3 slots, and *meta* questions ("which documents do you have?") can't be answered by chunk search — the model only sees the 3 nearest chunks, often all from one file. A future routing step (Phase 7) is the real fix.
- **Orphan chunks exist in the database**: 8 groups of chunks have no `documents` row (test uploads from before Step 2.2). They're invisible in the UI and can't be deleted from it. All-documents search deliberately skips them; they can be cleaned up with SQL (`DELETE FROM chunks WHERE document_id NOT IN (SELECT id FROM documents)`) — not done automatically.
- **`listSessions()` loads *every* message** of every session and reduces them in JavaScript ([repository L71-114](src/repositories/chatMessages.repository.ts#L71-L114)) — fine for a learning project, wasteful at scale.
- **`/chat-stream` puts the user's message in the URL** (because `EventSource` is GET-only): it can appear in server logs, and very long messages could hit URL length limits.
- **The Gemini API key is sent in the URL** (`?key=`). Gemini also accepts it in an `x-goog-api-key` header, which keeps it out of URLs and logs.
- **The upload's PDF check trusts the client's mimetype** ([documents.routes.ts:40](src/routes/documents.routes.ts#L40)).
- **Errors are terminal-only** — writing them to a file (`logs/errors.log`) was discussed and intentionally deferred.
- **No automated tests yet** (Phase 9).
- **Don't re-run the `step2` / `step3` scripts against the real database** — they drop/clear the `chunks` table (see the warnings in Phase 1). `step3` is still an npm script; `step2` no longer is.

---

## 8. Glossary

- **Embedding** — a list of numbers (3072 here) representing a piece of text's meaning.
- **Vector** — that list of numbers; "vector" and "embedding" are used interchangeably here.
- **Cosine similarity / distance** — how alike two vectors are, by angle. Distance = 1 − similarity; smaller distance = closer meaning.
- **pgvector** — Postgres extension adding the `vector` type and operators like `<=>`.
- **Chunk** — a ~500-word slice of a PDF's text, embedded and stored as one row.
- **RAG** — Retrieval-Augmented Generation: retrieve relevant chunks, put them in the prompt, then generate.
- **Session** — one conversation: all `chat_messages` rows sharing a `session_id`.
- **Repository** — a module whose only job is database access.
- **Service** — a module that does the real work and never touches `req`/`res`.
- **Route** — Express handler that reads the request and writes the response.
- **Multer** — Express middleware for file uploads.
- **CORS** — browser rule that blocks cross-origin requests unless the server allows them.
- **SSE** — Server-Sent Events: a server keeps an HTTP response open and writes `data:…` events into it.
- **`EventSource`** — the browser API that consumes SSE (GET-only, auto-reconnects).
- **Async generator** — an `async function*` that `yield`s values over time; consumed with `for await`.
- **StrictMode** — React dev mode that double-invokes some code to expose impure logic.
- **Optimistic update** — showing the result in the UI *before* the server confirms (the user's message bubble).
- **Structured output** — getting an LLM to return data in an exact shape (JSON) instead of prose, so code can use it.
- **Zod schema** — a description of the shape data must have; `safeParse` checks data against it, and `z.infer` gives the matching TypeScript type.
- **Sentinel value** — a special value standing for a case (here `'all'` for "every document"), used instead of a schema change.
- **Orphan chunk** — a stored chunk whose `documents` row doesn't exist, so it's invisible in the UI.
