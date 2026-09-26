# DocMind

**Upload a PDF, chat with it, and get quizzed on it.**

DocMind is a small AI backend built from scratch to understand how AI products actually work under the hood: embeddings, vector search, RAG, conversation memory, streaming, and structured output. No LangChain, no LLM SDK, no framework doing the interesting parts. Just Express, Postgres, and plain HTTP calls to Gemini, so every piece is visible.

It comes with a React frontend that exercises every endpoint the way a real client would.

---

## What it does

- **Upload a PDF.** It gets parsed, split into chunks, turned into embeddings, and stored in Postgres with pgvector.
- **Chat with it.** Ask questions, get answers grounded only in your document, with the source passages shown under every reply.
- **It remembers the conversation.** Follow-ups like *"what about the second one?"* work, and a page refresh brings you back to the same chat.
- **Answers stream in live**, word by word, instead of arriving all at once.
- **Search one PDF or all of them.** Default is every uploaded document; answers name which PDF they came from.
- **Generate a quiz.** 5 multiple-choice questions from the document, validated before they ever reach the UI, then check your answers.
- **Conversation history.** A ChatGPT-style sidebar, grouped by day, with delete for chats and documents.

---

## How it works

### 1. Ingestion (when you upload)

```
PDF ──► multer (in memory) ──► pdf-parse ──► plain text
    ──► split into ~500-word chunks
    ──► embed each chunk (Gemini, 3072 numbers each)
    ──► store in Postgres/pgvector, tagged with a documentId
```

### 2. Chat (every time you ask)

```
question ──► embed it (same model)
         ──► pgvector search: the 3 closest chunks  (one PDF, or all of them)
         ──► load the last 8 messages of this conversation
         ──► prompt = those chunks + the history + the question
         ──► Gemini ──► answer, streamed back over SSE
         ──► both messages saved, so the next turn has memory
```

This is RAG in one line: instead of the model guessing from memory, it's handed the relevant text right before being asked.

### 3. Quiz

```
documentId ──► sample 5 chunks spread across the whole document (no search, a quiz has no question)
           ──► Gemini in structured-output (JSON) mode
           ──► validate with Zod: exactly 5 questions, exactly 4 different options, correct index 0-3
               └─ invalid? retry once, then fail cleanly
           ──► shuffle each question's options in code
           ──► quiz
```

---

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Node.js, TypeScript |
| API | Express 5, multer (uploads), cors |
| Database | Postgres + **pgvector**, hosted on Neon (free tier) |
| Data access | Drizzle ORM, behind a repository layer |
| PDF | pdf-parse v2 |
| LLM | Gemini API over plain `fetch` (`gemini-flash-lite-latest`) |
| Embeddings | `gemini-embedding-001` (3072 dimensions) |
| Validation | Zod (for request input *and* for the model's output) |
| Streaming | Server-Sent Events |
| Frontend | React 19, Vite, TypeScript |

Everything runs on free tiers. No card needed anywhere.

---

## API

| Method | Path | What it does |
|---|---|---|
| `GET` | `/` | Health check |
| `POST` | `/upload` | Upload a PDF (`multipart/form-data`, field `file`). Parses, chunks, embeds, stores. |
| `GET` | `/documents` | List uploaded documents |
| `DELETE` | `/documents/:documentId` | Delete a document, its chunks, and every chat about it |
| `POST` | `/chat` | `{ message, documentId?, sessionId? }` → `{ sessionId, answer, sources }` |
| `GET` | `/chat-stream` | Same as `/chat`, streamed. Query params: `message`, `documentId?`, `sessionId?` |
| `GET` | `/sessions` | One summary per conversation, newest first |
| `GET` | `/sessions/:sessionId/messages` | Full transcript of one conversation |
| `DELETE` | `/sessions/:sessionId` | Delete one conversation |
| `POST` | `/quiz` | `{ documentId }` → `{ documentId, quiz }` (5 validated questions) |

**`documentId`** on chat is optional: leave it out (or send `"all"`) to search every document. Each source comes back as `{ content, distance, documentId, filename }`.

**`/chat-stream` is a `GET`** on purpose: the browser's `EventSource` can only send GET requests. It sends these events, in order:

| Event | Payload | When |
|---|---|---|
| `meta` | `{ sessionId, sources }` | first, before any text |
| *(default)* | `{ text }` | once per piece of the answer |
| `done` | `{}` | after the full answer is saved |
| `error` | `{ error }` | if anything fails mid-stream |

---

## Project structure

```
src/
  index.ts            starts the server (7 lines)
  app.ts              builds the Express app, mounts the routes
  config.ts           shared constants
  routes/             thin: read the request, call a service, send the response
    documents.routes.ts   /upload, /documents
    sessions.routes.ts    /sessions
    chat.routes.ts        /chat, /chat-stream
    quiz.routes.ts        /quiz
  services/           the actual work, never touches req/res
    ingestion.service.ts  parse → chunk → embed → store
    chat.service.ts       the shared chat pipeline + prompt
    quiz.service.ts       generate → validate → retry → shuffle
    llm.service.ts        Gemini calls (normal + streaming)
    embeddings.service.ts Gemini embeddings
  repositories/       the only place SQL lives
  db/                 Drizzle schema + connection
  schemas/            Zod schema for the quiz
  utils/              error handling, chunking, colored pipeline logs
  step1-4 *.ts        standalone learning scripts from each phase

frontend/src/
  api/                fetch calls only
  hooks/              state + async logic (useChat, useQuiz, ...)
  components/         UI (sidebar, chat, quiz, upload)
  App.tsx             wires it together
```

---

## Getting started

### What you need

- **Node.js** 20 or newer
- A free **Postgres with pgvector**, for example [Neon](https://neon.tech) or [Supabase](https://supabase.com)
- A free **Gemini API key** from [Google AI Studio](https://aistudio.google.com/)

### 1. Set up the database

In your Postgres SQL editor:

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  text_length INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE chunks (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  embedding VECTOR(3072),
  document_id TEXT NOT NULL
);

CREATE TABLE chat_messages (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

(These match `src/db/schema.ts`.)

### 2. Run the backend

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

```
GEMINI_API_KEY=your-key-from-ai-studio
DATABASE_URL=postgresql://...your neon connection string...
FRONTEND_URL=http://localhost:5173
```

```bash
npm run dev        # API on http://localhost:3000
```

### 3. Run the frontend

```bash
cd frontend
npm install
cp .env.example .env     # VITE_API_URL=http://localhost:3000
npm run dev              # UI on http://localhost:5173
```

Open `http://localhost:5173`, upload a PDF, and start asking.

> Only PDFs with a real text layer work (typed or exported documents). Scanned PDFs are just images and would need OCR.

---

## Decisions worth knowing

A few things that aren't obvious from the code alone:

- **Validate the model like any other untrusted client.** The quiz is checked with Zod before it's used. In testing the model was valid 17 out of 17 times, so this is insurance, not a daily rescue. A set of deliberately broken replies (`npm run step4`) shows what it catches.
- **Valid isn't the same as good.** Measured across 50 questions, the model didn't place the correct answer evenly (one slot got 36%, another 10%). So options are shuffled in code after validation instead of trusting the model's habits.
- **Retry once, then fail honestly.** Two attempts max per quiz, then a clean error. Never an endless loop.
- **No `/quiz/check` endpoint, on purpose.** Quizzes aren't stored on the server, so a "check my answer" endpoint would only compare two numbers the browser already has. Grading happens in the browser. A real check endpoint would need stored quizzes first.
- **Errors travel inside the stream.** Once an SSE response starts, its status code is already sent, so failures go out as an `error` event instead.
- **Readable errors.** A failed vector query from Drizzle includes all 3072 numbers of the embedding. A small helper prints only the message, the underlying cause, and the line in this codebase where it broke.
- **Services never touch `req`/`res`.** That keeps the pipelines reusable, for example by a background worker later.

---

## Known limitations

- PDF upload embeds chunks one by one inside the request, so large PDFs are slow (background jobs are the planned fix).
- Chunking is a simple 500-word split, no overlap and no respect for paragraphs.
- "Search all documents" shares the top 3 results across every PDF, so a vague question can end up answered from one file. It also can't answer questions *about* your collection, like "which documents do you have?"
- Memory is the last 8 messages. Older messages are dropped, not summarized.
- When Gemini is overloaded it returns `503`, and the chat currently just shows "Streaming failed."
- No authentication and no automated tests yet.

---

## Learning docs

This repo doubles as a learning log:

- [PROGRESS.md](PROGRESS.md): what's done and what's next
- [project_building_workthrough.md](project_building_workthrough.md): the build order, phase by phase
- [CODE_EXPLAINED.md](CODE_EXPLAINED.md): every file explained, with links to the exact lines
- [topics/](topics/README.md): notes per concept, in my own words
- [ai-backend-roadmap.md](ai-backend-roadmap.md): the original plan

## What's next

Background jobs for PDF ingestion (BullMQ + Redis), then agents and tool calling, multi-step workflows, tests, and deployment.
