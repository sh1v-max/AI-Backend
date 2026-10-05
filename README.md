# DocMind

**Upload a PDF, chat with it, and get quizzed on it.**

DocMind is a small AI backend built from scratch to understand how AI products actually work under the hood: embeddings, vector search, RAG, conversation memory, streaming, and structured output. No LangChain, no LLM SDK, no framework doing the interesting parts. Just Express, Postgres, and plain HTTP calls to Gemini, so every piece is visible.

It comes with a React frontend that exercises every endpoint the way a real client would.

- **Live app:** [docmind-jet.vercel.app](https://docmind-jet.vercel.app/)
- **Live API:** [ai-backend-docmind.onrender.com](https://ai-backend-docmind.onrender.com/)

> The API is on Render's free tier. After ~15 idle minutes it sleeps, so the first request can take up to a minute while it wakes up. If the app looks empty at first, give it a moment and refresh.

---

## What it does

- **Your own private space, no sign-up needed.** Every visitor silently gets a guest account and only ever sees their own documents and chats. Sign up later to keep them and use them on any device.
- **Upload a PDF.** It gets parsed, split into chunks, turned into embeddings, and stored in Postgres with pgvector.
- **Chat with it.** Ask questions, get answers grounded only in your document, formatted (lists, bold, tables), with the source passages shown under every reply.
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

### 4. Who's asking (every request)

```
first visit ──► POST /auth/guest ──► a guest user row + a signed JWT (kept in localStorage)
every request ──► Authorization: Bearer <JWT>
              ──► requireAuth middleware: check signature + expiry (no DB lookup) ──► req.user
              ──► every query filters on that user's id
                  (someone else's document or chat looks exactly like one that doesn't exist: 404)
sign up ──► the same guest row gets an email + password hash, so its files stay
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
| Auth | JWT (`jsonwebtoken`, HS256), `bcryptjs` for passwords, `express-rate-limit` |
| Streaming | Server-Sent Events |
| Frontend | React 19, Vite, TypeScript, `react-markdown` |

Everything runs on free tiers. No card needed anywhere.

---

## API

Every route except `/` and the three public `/auth` routes needs `Authorization: Bearer <token>` and only ever sees the caller's own data.

| Method | Path | What it does |
|---|---|---|
| `GET` | `/` | Health check |
| `POST` | `/auth/guest` | Create a guest account → `{ token, user }` (public, rate-limited) |
| `POST` | `/auth/register` | `{ email, password }` → `{ token, user }`. Sent with a guest's token, it upgrades that guest so its files stay (public, rate-limited) |
| `POST` | `/auth/login` | `{ email, password }` → `{ token, user }` (public, rate-limited) |
| `GET` | `/auth/me` | Who the token belongs to |
| `POST` | `/upload` | Upload a PDF (`multipart/form-data`, field `file`). Parses, chunks, embeds, stores. Guests can keep 5 documents, accounts 10. |
| `GET` | `/documents` | List uploaded documents |
| `DELETE` | `/documents/:documentId` | Delete a document, its chunks, and every chat about it |
| `POST` | `/chat` | `{ message, documentId?, sessionId? }` → `{ sessionId, answer, sources }` |
| `POST` | `/chat-stream` | Same as `/chat` (same JSON body), but the reply streams in as Server-Sent Events |
| `GET` | `/sessions` | One summary per conversation, newest first |
| `GET` | `/sessions/:sessionId/messages` | Full transcript of one conversation |
| `DELETE` | `/sessions/:sessionId` | Delete one conversation |
| `POST` | `/quiz` | `{ documentId }` → `{ documentId, quiz }` (5 validated questions) |

**`documentId`** on chat is optional: leave it out (or send `"all"`) to search all of *your* documents. Each source comes back as `{ content, distance, documentId, filename }`.

**`/chat-stream` is a `POST`**, and the frontend reads it with `fetch` and parses the events itself. It started as a `GET` with query params, because the browser's `EventSource` can only send GET, but `EventSource` also can't send an `Authorization` header, so it was replaced by `fetch`, and then the route moved to POST to keep the question out of the URL (and out of server logs). It sends these events, in order:

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
  config.ts           shared constants (limits, token lifetimes, ...)
  middleware/         requireAuth (checks the JWT), the /auth rate limiter
  routes/             thin: read the request, call a service, send the response
    auth.routes.ts        /auth/guest, /auth/register, /auth/login, /auth/me
    documents.routes.ts   /upload, /documents
    sessions.routes.ts    /sessions
    chat.routes.ts        /chat, /chat-stream
    quiz.routes.ts        /quiz
  services/           the actual work, never touches req/res
    auth.service.ts       sign/verify tokens, guest, register, login
    ingestion.service.ts  parse → chunk → embed → store
    chat.service.ts       the shared chat pipeline + prompt
    quiz.service.ts       generate → validate → retry → shuffle
    llm.service.ts        Gemini calls (normal + streaming)
    embeddings.service.ts Gemini embeddings
  repositories/       the only place SQL lives; every query takes the user's id
  db/                 Drizzle schema + connection
  schemas/            Zod schemas (the quiz, register/login bodies)
  utils/              error handling, chunking, colored pipeline logs
  step1-4 *.ts        standalone learning scripts from each phase

frontend/src/
  api/                fetch calls only
  hooks/              state + async logic (useAuth, useChat, useQuiz, ...)
  components/         UI (sidebar, chat, quiz, upload, sign in / sign up)
  App.tsx             waits for a user (guest or signed in), then wires it together
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

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,               -- NULL for guests
  password_hash TEXT,              -- NULL for guests
  is_guest BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  text_length INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  user_id TEXT
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
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  user_id TEXT
);

CREATE INDEX documents_user_id_idx ON documents (user_id);
CREATE INDEX chat_messages_user_session_idx ON chat_messages (user_id, session_id);
```

(These match `src/db/schema.ts`. `chunks` has no `user_id`: a chunk belongs to a document, and the document has the owner.)

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
JWT_SECRET=a-long-random-string
```

Generate the secret with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. The server refuses to start without it.

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

### Deployment

The API runs on a **Render** free web service and redeploys on every push to `main`.

| Setting | Value |
|---|---|
| Build command | `npm install --include=dev && npm run build` (TypeScript is a dev dependency) |
| Start command | `node dist/index.js` |
| Health check path | `/` |
| Env vars | `GEMINI_API_KEY`, `DATABASE_URL`, `FRONTEND_URL` (comma-separated list of allowed origins), `JWT_SECRET` (its own value, not the local one), `TRUST_PROXY_HOPS` (how many proxies sit in front of the app; see below) |

`npm run build` uses `tsconfig.build.json`, which compiles only the app (not the `stepN` learning scripts) into `dist/`.

On Render, requests pass through Cloudflare and then Render's own proxies before reaching the app. The rate limiter needs the visitor's real IP, so Express is told how many proxy hops to skip in `X-Forwarded-For` (`TRUST_PROXY_HOPS`). That number was measured, not guessed: the `RateLimit-Policy` response header contains a hash of the key the limiter used, which can be compared with a hash of your own IP. On Render the answer is 3 hops (client, Cloudflare edge, Render's front proxy).

The frontend is on **Vercel** (Root Directory `frontend`, Vite preset) with one env var, `VITE_API_URL`, pointing at the Render URL. Vite bakes it in at build time, so changing it needs a redeploy.

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
- **Guests are real users.** A first visit creates a user row with no email or password, so a guest's token goes through exactly the same checks as an account's. Signing up fills in that same row, which is why a guest's files survive it.
- **Ownership lives in the SQL.** Every repository function that reads or deletes takes the user's id as a *required* argument, so forgetting the filter is a TypeScript error instead of a data leak. Someone else's document returns 404, not 403, so its id isn't even confirmed to exist.
- **Protected by default.** The auth check is mounted before every data route in one place, so a route added later is protected without anyone remembering to do it.
- **A token in a header, not a cookie.** The frontend and API live on different sites, where cookies are third-party and increasingly blocked. The tradeoff is that the token sits in `localStorage`, so answers are rendered as markdown *without* raw HTML.

---

## Known limitations

- PDF upload embeds chunks one by one inside the request, so large PDFs are slow (background jobs are the planned fix).
- Chunking is a simple 500-word split, no overlap and no respect for paragraphs.
- "Search all documents" shares the top 3 results across every PDF, so a vague question can end up answered from one file. It also can't answer questions *about* your collection, like "which documents do you have?"
- Memory is the last 8 messages. Older messages are dropped, not summarized.
- When Gemini is overloaded it returns `503`, and the chat currently just shows "Streaming failed."
- No automated tests yet.
- Auth is deliberately simple: no refresh tokens or server-side logout (a token stays valid until it expires), no email verification or password reset, and the token lives in `localStorage`. A guest's files are tied to one browser: clearing its storage loses them.
- Logging in to an existing account doesn't merge the files you uploaded as a guest (signing up does keep them).
- The rate limiter's counters live in memory, so they reset whenever the free server restarts or sleeps.
- Uploads are capped at 10 MB (the free server has 512 MB of RAM and holds the upload in memory).

---

## Learning docs

This repo doubles as a learning log:

- [PROGRESS.md](PROGRESS.md): what's done and what's next
- [project_building_workthrough.md](project_building_workthrough.md): the build order, phase by phase
- [CODE_EXPLAINED.md](CODE_EXPLAINED.md): every file explained, with links to the exact lines
- [topics/](topics/README.md): notes per concept, in my own words
- [ai-backend-roadmap.md](ai-backend-roadmap.md): the original plan

## What's next

Background jobs for PDF ingestion (BullMQ + Redis), then agents and tool calling, multi-step workflows, and tests.
