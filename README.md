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
- **Attach a PDF and ask in one go.** The home screen is the chat box: attach (or drop) a PDF, type your question, send. If the PDF is still being processed, the question waits for it and goes out on its own. Behind the scenes the PDF is parsed and split into chunks right away, then a background worker turns the chunks into embeddings and stores them in Postgres with pgvector, while the sidebar shows it as "Processing…".
- **No PDF handy?** "Try our sample" uploads a short guide to DocMind itself, with starter questions it can actually answer.
- **Chat with it.** Ask questions, get answers grounded only in your document, formatted (lists, bold, tables), with the source passages shown under every reply.
- **It remembers the conversation.** Follow-ups like *"what about the second one?"* work, and a page refresh brings you back to the same chat.
- **Answers stream in live**, word by word, instead of arriving all at once.
- **Search one PDF or all of them.** A picker inside the chat box; default is every uploaded document, and answers name which PDF they came from.
- **Quiz yourself.** Pick a document, get 5 multiple-choice questions, validated before they ever reach the UI, then check your answers.
- **Sidebar.** Your documents (with a counter against your limit and a menu per file) and your conversations, grouped by day, each deletable.

---

## How it works

### 1. Ingestion (when you upload)

The slow part (one Gemini call per chunk) runs on a queue, so the upload request doesn't wait for it:

```
POST /upload ──► multer (in memory) ──► pdf-parse ──► plain text   (no text at all? 400 right away)
             ──► split into ~500-word chunks
             ──► documents row, status 'processing'
             ──► job { documentId, userId, chunk texts } ──► Redis (BullMQ)
      ◄── 202 { documentId, status: 'processing' }          (about a second)

worker ◄── takes the job from Redis
       ──► delete any chunks this document already has   (so a retry never duplicates)
       ──► embed each chunk (Gemini, 3072 numbers each) ──► store in Postgres/pgvector
       ──► status 'ready'   (or 'failed' after 3 attempts, 5 s then 10 s apart)

browser ──► polls GET /documents every 2 s until it's ready
```

On the free tier the worker runs inside the API's own process (Render's free plan has no separate worker service); `npm run worker` runs it on its own.

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
| Background jobs | BullMQ + Upstash Redis (free tier), worker inside the API process |
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
| `POST` | `/upload` | Upload a PDF (`multipart/form-data`, field `file`). Parses and chunks it, queues the embedding, answers **`202`** with `status: "processing"`. `400` for a PDF with no text, `503` if the queue is down. Guests can keep 5 documents, accounts 10. |
| `GET` | `/documents` | List uploaded documents, each with `status` (`processing` / `ready` / `failed`) and `error` |
| `DELETE` | `/documents/:documentId` | Delete a document, its chunks, and every chat about it |
| `POST` | `/chat` | `{ message, documentId?, sessionId? }` → `{ sessionId, answer, sources }` |
| `POST` | `/chat-stream` | Same as `/chat` (same JSON body), but the reply streams in as Server-Sent Events |
| `GET` | `/sessions` | One summary per conversation, newest first |
| `GET` | `/sessions/:sessionId/messages` | Full transcript of one conversation |
| `DELETE` | `/sessions/:sessionId` | Delete one conversation |
| `POST` | `/quiz` | `{ documentId }` → `{ documentId, quiz }` (5 validated questions) |

**`documentId`** on chat is optional: leave it out (or send `"all"`) to search all of *your* ready documents. Each source comes back as `{ content, distance, documentId, filename }`. Chat or quiz on one document that's still processing (or failed) answers `409`.

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
  index.ts            starts the server and the queue worker
  app.ts              builds the Express app, mounts the routes
  config.ts           shared constants (limits, token lifetimes, queue settings, ...)
  middleware/         requireAuth (checks the JWT), the /auth rate limiter
  routes/             thin: read the request, call a service, send the response
    auth.routes.ts        /auth/guest, /auth/register, /auth/login, /auth/me
    documents.routes.ts   /upload, /documents
    sessions.routes.ts    /sessions
    chat.routes.ts        /chat, /chat-stream
    quiz.routes.ts        /quiz
  services/           the actual work, never touches req/res
    auth.service.ts       sign/verify tokens, guest, register, login
    ingestion.service.ts  parse + chunk (request), embed + store (worker), queue the job
    documents.service.ts  "is this document ready?" (404 / 409) for chat and quiz
    chat.service.ts       the shared chat pipeline + prompt
    quiz.service.ts       generate → validate → retry → shuffle
    llm.service.ts        Gemini calls (normal + streaming)
    embeddings.service.ts Gemini embeddings
  queue/              Redis connections, the ingest queue, graceful shutdown
  workers/            the ingest worker (embed + store, retries, status)
  worker.ts           the worker on its own (`npm run worker`)
  repositories/       the only place SQL lives; every query takes the user's id
  db/                 Drizzle schema + connection
  schemas/            Zod schemas (the quiz, register/login bodies)
  utils/              error handling, chunking, colored pipeline logs
  step1-5 *.ts        standalone learning scripts from each phase (step5 = BullMQ)

frontend/src/
  api/                fetch calls only
  hooks/              state + async logic (useAuth, useChat, useQuiz, ...)
  components/         UI (sidebar, chat + home screen, quiz, sign in / sign up)
  App.tsx             waits for a user (guest or signed in), then wires it together

frontend/public/how-to-start.pdf    the sample document (source: frontend/sample-docs/)
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
  user_id TEXT,
  status TEXT NOT NULL DEFAULT 'ready',  -- 'processing' | 'ready' | 'failed' (for background jobs)
  error TEXT                             -- why it failed, when status = 'failed'
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
REDIS_URL=rediss://default:password@your-db.upstash.io:6379
BULLMQ_PREFIX=docmind-dev
# RUN_WORKER=false   # optional: don't start the queue worker with npm run dev
```

Generate the secret with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. The server refuses to start without it, or without `REDIS_URL` and `BULLMQ_PREFIX`.

For Redis, a free [Upstash](https://upstash.com) database works (no card). Use the `rediss://` URL from the ioredis/Node tab (two s's = TLS), not the `redis-cli` command, and keep eviction off (BullMQ needs its keys to stay). `BULLMQ_PREFIX` keeps local and production jobs apart when they share one Redis: use a different value per environment (`docmind-dev` locally, `docmind` in production). An idle worker still talks to Redis, so set `RUN_WORKER=false` when you're not working on uploads; uploads then wait in the queue until a worker runs.

```bash
npm run dev        # API on http://localhost:3000, with the queue worker inside it
```

### 3. Run the frontend

```bash
cd frontend
npm install
cp .env.example .env     # VITE_API_URL=http://localhost:3000
npm run dev              # UI on http://localhost:5173
```

Open `http://localhost:5173`, attach a PDF (or click "Try our sample"), and start asking.

> Only PDFs with a real text layer work (typed or exported documents). Scanned PDFs are just images and would need OCR.

### Deployment

The API runs on a **Render** free web service and redeploys on every push to `main`.

| Setting | Value |
|---|---|
| Build command | `npm install --include=dev && npm run build` (TypeScript is a dev dependency) |
| Start command | `node dist/index.js` |
| Health check path | `/` |
| Env vars | `GEMINI_API_KEY`, `DATABASE_URL`, `FRONTEND_URL` (comma-separated list of allowed origins), `JWT_SECRET` (its own value, not the local one), `TRUST_PROXY_HOPS` (how many proxies sit in front of the app; see below), `REDIS_URL` + `BULLMQ_PREFIX=docmind` (**not** the local value: a shared prefix would let your laptop's worker take production's jobs) |

`npm run build` uses `tsconfig.build.json`, which compiles only the app (not the `stepN` learning scripts) into `dist/`.

The queue worker starts inside this one web service (Render's free plan has no background-worker service). On every deploy Render sends `SIGTERM`; the app lets the worker finish the job in progress (up to 20 s) before it exits. A job cut off anyway is picked up again after the restart.

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
- **Upload answers before the work is done.** The request only does what someone is waiting for (parse, chunk, save a `processing` row, queue a job) and returns `202`. The embedding happens in a worker, and the document is searchable once it's `ready`. Until then, chat and quiz on it answer `409` (it's yours, it just isn't usable yet), and "all documents" search simply skips it.
- **Jobs are safe to run twice.** BullMQ retries a failed job and re-runs one whose worker died, so a job starts by deleting the chunks its document already has, then stores all of them. Tested with a forced failure halfway through, and with the server killed mid-job.
- **An idle queue worker isn't free.** A BullMQ worker keeps polling Redis even with nothing to do. Measured over 5 idle minutes: 118 Redis commands with default settings (about 1M a month if it never sleeps, double Upstash's free 500K) vs 19 with `drainDelay: 30` and `stalledInterval: 300000` (about 164K). The tuned values are in `src/config.ts`; `npm run step5` repeats the measurement.
- **A token in a header, not a cookie.** The frontend and API live on different sites, where cookies are third-party and increasingly blocked. The tradeoff is that the token sits in `localStorage`, so answers are rendered as markdown *without* raw HTML.

---

## Known limitations

- The queue worker shares the API's process (free tier, 512 MB, a fraction of a CPU), so a big upload can slow chat down a little. A separate worker service would fix it with no code change (`npm run worker`).
- If the server crashes in the middle of a job, the job resumes after the restart, but can take up to ~10 minutes to be noticed (the tuned stalled-job check runs every 5 minutes). Normal deploys aren't affected: the worker finishes its job first.
- Embedding is still one Gemini call per chunk, one document at a time.
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

Better answers (the prompt-quality plan in [prompt-improvement.md](prompt-improvement.md)), then agents and tool calling, multi-step workflows, and tests.
