# 13 — Deployment

**Roadmap: Phase 10** · **Status in DocMind: partly done (2026-09-30).** The API is live on Render and the frontend on Vercel. There's no background worker yet (Phase 6 isn't built), so Step 10.1's "API + worker" is half complete.

* API: https://ai-backend-docmind.onrender.com/
* Frontend: https://docmind-jet.vercel.app/

Free-tier limits and pricing change. Every number about a provider below should be checked against that provider's current docs.

Code this file talks about: [package.json](../../package.json), [tsconfig.build.json](../../tsconfig.build.json), [config.ts](../../src/config.ts), [app.ts](../../src/app.ts), [index.ts](../../src/index.ts), [chat.routes.ts](../../src/routes/chat.routes.ts), [frontend/src/api/client.ts](../../frontend/src/api/client.ts)

---

# 1. What is Deployment?

On your laptop:

```text
npm run dev → http://localhost:3000     only you can reach it
```

Deployed:

```text
https://ai-backend-docmind.onrender.com  anyone can reach it, 24/7, without your laptop
```

Deployment = getting your code running on someone else's computer, with the right configuration, reachable from the internet, and staying up.

---

# 2. Simple Analogy

Cooking at home vs opening a food stall.

At home you know where everything is, the gas is always on, and if something breaks you're standing right there.

At the stall:

* you can't bring your whole kitchen, only a **packed kit** (the build)
* the recipe's secret spice mix isn't printed on the menu (environment variables)
* the stall owner tells you **which counter is yours** (the `PORT`)
* the stall closes when no customers come and reopens when one shows up (free-tier spin-down)
* customers reach you through the market's entrance, not your kitchen door (the proxy / HTTPS)

Most deployment bugs are one of those five things.

---

# 3. DocMind's Deployed Architecture

```text
                    BROWSER
                       │
        ┌──────────────┴───────────────┐
        │ HTML/JS/CSS                  │ API calls (fetch, EventSource)
        ▼                              ▼
   ┌─────────┐                  ┌──────────────┐
   │ VERCEL  │                  │    RENDER    │
   │ static  │                  │ Node/Express │
   │ frontend│                  │  (free web)  │
   └─────────┘                  └──────────────┘
                                   │        │
                          ┌────────┘        └────────┐
                          ▼                          ▼
                    ┌───────────┐             ┌────────────┐
                    │   NEON    │             │ GEMINI API │
                    │ Postgres  │             │ generation │
                    │ +pgvector │             │ embeddings │
                    └───────────┘             └────────────┘
```

Four services, four companies, all free tier. Later, Phase 6 adds a fifth (Upstash Redis) and a worker process.

Two **origins** are involved (`docmind-jet.vercel.app` and `ai-backend-docmind.onrender.com`), which is why CORS matters (§9).

---

# 4. Dev Mode vs Production Mode

```text
DEV     ts-node-dev --respawn --transpile-only src/index.ts
        TypeScript compiled on the fly, restarts on save, type errors ignored

PROD    tsc -p tsconfig.build.json   →   dist/index.js
        node dist/index.js
        plain JavaScript, compiled once, no TypeScript tooling at runtime
```

Why not run `ts-node` in production?

* slower startup and more memory (512 MB is all Render's free instance has)
* dev dependencies needed at runtime
* `--transpile-only` hides type errors; a real `tsc` build catches them **before** the code ships

So the build step is also a safety check.

---

# 5. The Build

```json
"scripts": {
  "build": "tsc -p tsconfig.build.json",
  "start": "node dist/index.js"
},
"engines": { "node": "22.x" }
```

[tsconfig.build.json](../../tsconfig.build.json) extends the normal config with three changes:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"],
  "exclude": ["src/step*.ts"]
}
```

* `rootDir: "src"` → output is `dist/index.js`, not `dist/src/index.js`. Get this wrong and `npm start` says "Cannot find module".
* `exclude: step*.ts` → the learning scripts never ship. Good: `step2`/`step3` are destructive (they DROP/DELETE `chunks`).
* `engines.node` → tells the host which Node version to use. Without it you get the host's default, which may differ from your laptop's.

On the host:

```text
Build command:  npm install && npm run build
Start command:  npm start
```

One trap: if the host installs with `NODE_ENV=production`, `devDependencies` (including `typescript`) are skipped and `tsc` isn't found. Either make sure dev dependencies are installed during build, or move `typescript` to `dependencies`.

`package.json` must stay strict JSON. A `//` comment broke every npm command once already (`EJSONPARSE`); on a host that means a failed deploy.

---

# 6. Environment Variables

The same code runs in two places with different settings. The differences live **outside** the code:

| Variable | Local | Deployed |
|---|---|---|
| `GEMINI_API_KEY` | `.env` | Render dashboard |
| `DATABASE_URL` | `.env` | Render dashboard |
| `FRONTEND_URL` | defaults to `http://localhost:5173` | `https://docmind-jet.vercel.app` (comma-separated list allowed) |
| `PORT` | defaults to 3000 | **set by Render** |
| `VITE_API_URL` | defaults to `http://localhost:3000` | Vercel dashboard, the Render URL |

Rules:

* `.env` is gitignored and never deployed. The host's dashboard is the production `.env`.
* `import 'dotenv/config'` in production is harmless: there's no `.env` file, so it loads nothing and the real environment is used.
* Never print them. A secret in a build log is a leaked secret.
* This idea ("config in the environment") is one of the **twelve-factor app** principles. Others worth knowing: stateless processes, logs as a stream to stdout, and dev/prod parity.

---

# 7. `PORT` and Binding

```ts
export const PORT = process.env.PORT || 3000
app.listen(PORT, ...)
```

The host decides which port your process must listen on and tells you through `PORT`. Hardcoding `3000` is the single most common first-deploy failure: the app starts, the host's health check can't find it, and the deploy is marked failed.

Also: the app must listen on all interfaces (`0.0.0.0`), not only `localhost`. Express's `app.listen(port)` with no host does this by default. Passing `'localhost'` explicitly would break it.

---

# 8. Frontend Build and `VITE_API_URL`

```ts
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'
```

The important thing about Vite env vars:

> **They are baked into the JavaScript at BUILD time.** They are not read at runtime.

Consequences:

* Changing `VITE_API_URL` in Vercel does nothing until you **redeploy** (rebuild).
* Anything prefixed `VITE_` ends up in the public bundle. **Never put a secret in one.** `VITE_GEMINI_API_KEY` would hand your key to every visitor.
* That's why the Gemini key lives only on the backend. The frontend never talks to Gemini directly.

Vercel settings for this repo: Root Directory `frontend` (it's a monorepo-style layout), build `npm run build`, output `dist`.

---

# 9. CORS in Production

The browser blocks a page on origin A from reading responses from origin B unless B says it's allowed.

```ts
export const FRONTEND_ORIGINS = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean)

app.use(cors({ origin: FRONTEND_ORIGINS }))
```

Two details here came from deploy prep:

**Comma-separated origins.** So the live API can serve the Vercel site *and* `localhost:5173` at once.

**The trailing slash.** The browser's `Origin` header is `https://docmind-jet.vercel.app`, never with a trailing `/`. If the env var is pasted as `https://docmind-jet.vercel.app/`, the string comparison fails and every request is blocked. The `.replace(/\/$/, '')` exists for exactly that paste mistake.

Things to remember about CORS:

* It's enforced by **browsers only**. `curl` and Postman ignore it. So "works in Postman, fails in the browser" almost always means CORS.
* It is **not** security for your API. Anyone can call the API directly. It protects *users* from malicious sites, not your server from callers.
* An origin is scheme + host + port. `http` vs `https` differ. `www.` vs no `www.` differ.
* Vercel **preview** deployments get different URLs per branch/commit; they won't be in your allow-list.
* `EventSource` follows CORS too.

---

# 10. Free-Tier Reality: Cold Starts

Render's free web services **spin down after a period with no traffic** and start again on the next request. That first request can take tens of seconds, sometimes close to a minute.

```text
no traffic for a while → instance sleeps
visitor arrives        → wake up → npm start → first response
                         (the visitor waits through all of it)
```

Neon's free compute also **auto-suspends** when idle and resumes on the next connection, usually much faster, but it adds to the first request.

So the worst case is cold API + cold database + cold LLM call, all on the first click.

What to do about it:

* **Tell the user.** A "waking up the server…" message on the frontend if the first request takes more than a few seconds. Honest UX beats a frozen page.
* **Tell the reader.** The README can say the first request may be slow. On a portfolio project, that one line prevents "it's broken" from a recruiter.
* **Pings.** An external uptime monitor hitting `/` every few minutes keeps it awake. Check the provider's terms and your monthly free hours before relying on that.
* **Pay.** The real answer in production.

Other consequences of an instance that restarts whenever it likes:

* Nothing in memory survives. (A `Map` of sessions or workflow state would vanish. DocMind keeps all state in Postgres, which is why this isn't a problem.)
* The local disk is **ephemeral**: files written at runtime disappear on restart or deploy.
* An in-flight request during a restart is lost. That's the argument for background jobs with retries.

---

# 11. Memory: Why There's a 10 MB Upload Cap

```ts
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
```

Multer uses **memory storage**: the whole PDF sits in RAM as a `Buffer`. Then `pdf-parse` builds the extracted text in memory, then chunks, then one 3072-number embedding at a time.

On a 512 MB instance, one huge PDF (or several at once) can push the process over the limit and the host kills it (out-of-memory). The cap turns that crash into a clean answer:

```text
oversize upload → multer throws MulterError LIMIT_FILE_SIZE
               → app.ts error handler → 413 { error: "PDF is too large (max 10 MB)" }
```

`413 Payload Too Large` is the correct status. Locally you'd never notice this; your laptop has 16 GB.

---

# 12. The Last-Resort Error Handler

```ts
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') { ... 413 ... }
  console.error(`[unhandled] ${summarizeError(err)}`)
  res.status(500).json({ error: 'Something went wrong on the server' })
})
```

Why it was added for deployment: without it, Express answers an unhandled error with an **HTML** error page. The frontend does `res.json()` on it and throws a confusing "Unexpected token `<`" error. Now every failure is JSON.

The **four arguments** are what tells Express this is an error handler. It must be registered **after** all routes.

Also: in production, never send stack traces to the client. They reveal file paths and internals. The real error goes to the server log (`summarizeError`), the client gets a generic message.

---

# 13. Streaming Behind a Proxy

Locally the browser talks straight to Node. Deployed, there's a reverse proxy / load balancer in between (it does HTTPS and routing).

```text
Browser ─── HTTPS ───► [ host's proxy ] ─── HTTP ───► Node
```

Proxies like to **buffer**: collect the response, then forward it in one piece. For SSE that turns "words appearing live" into "nothing for 5 seconds, then everything at once". The stream *works*, it just doesn't *stream*.

Hence this header on `/chat-stream`:

```ts
'X-Accel-Buffering': 'no'
```

It asks nginx-style proxies not to buffer this response. Harmless when no proxy exists.

Other streaming-in-production issues:

* **Compression.** A gzip middleware buffers to compress. If you add `compression()`, exclude `text/event-stream`.
* **Idle timeouts.** Proxies drop connections that are silent too long. If retrieval + waiting for the first token takes a while, a periodic SSE comment line (`: keep-alive\n\n`) keeps the connection warm. DocMind doesn't need it yet since `meta` is sent right away.
* **Serverless platforms.** Many function platforms limit response duration or buffer responses. A long-lived Node server (Render web service) is the easy home for SSE; that's a real reason the API isn't on a serverless host.
* **HTTP/1.1 connection limit.** Browsers allow about 6 connections per origin over HTTP/1.1, and each open `EventSource` uses one. Closing the stream on `done` (which the frontend does) avoids that.

How to check it's really streaming: `curl -N https://.../chat-stream?message=hi` and watch whether lines arrive gradually.

---

# 14. The Database in Production

* **Connection string** in `DATABASE_URL`, with SSL required (Neon's string includes `sslmode=require`).
* **Pooling.** `pg.Pool` keeps a handful of connections open. Serverless Postgres has a limited number of direct connections; Neon offers a **pooled** connection string (PgBouncer, the hostname contains `-pooler`) for apps that open many. One small Node server with one Pool is fine either way.
* **Idle disconnects.** After Neon suspends, pooled connections are dead. `pg` reconnects on the next query, but the first one may fail with `ECONNRESET`. That's a class of error `withErrorHandling` already turns into a 503, and a reason to add a retry around DB calls later.
* **Migrations.** There's no committed migrations folder; tables were created directly on Neon and the SQL lives in comments in [schema.ts](../../src/db/schema.ts). It works for one developer. The grown-up version is `drizzle-kit generate` + committed migration files run as a deploy step. The `status` column in Phase 6 is the first change where this starts to matter.
* **Same database for local and live.** Right now local dev and the deployed API point at the *same* Neon database. Convenient, and dangerous: a local experiment changes production data. Neon **branches** (a copy-on-write copy of the DB) are the free fix: one branch for dev, one for prod.
* **Backups.** Know how you'd restore. Neon has point-in-time restore within a window on its plans.

---

# 15. CI/CD: Auto-Deploy

```text
git push origin main
        ↓
Render sees the commit → build → start → swap traffic to the new version
Vercel sees the commit → build → publish
```

That's **continuous deployment**. Two things already configured:

* Render auto-deploys on commits to `main`.
* **Build filters** ignore `frontend/**`, `topics/**`, `posts/**`, `*.md`, so editing notes doesn't restart the API (and doesn't cause a cold start for nothing).

Since Shiv merges to `main` through a PR, `main` is effectively the "production" branch: what's on it is what's live.

What's missing: nothing stops a broken commit from deploying. A CI step (`tsc --noEmit` + tests, topic 12) that must pass before merge is the next layer.

**Rollback:** both platforms keep previous deploys; you can redeploy an older one from the dashboard. Or `git revert` and push.

---

# 16. Verifying a Deploy

A deploy isn't done when the dashboard turns green. It's done when you've checked it. What was actually verified on 2026-09-30:

```text
GET /                          → { status: 'ok' }
GET /documents                 → list
CORS: allowed origin           → passes
CORS: other origin             → blocked
POST /upload (oversize)        → 413
bad input                      → 400
frontend production build      → succeeds
```

A fuller smoke test for Step 10.2:

```text
upload a small PDF → appears in /documents
chat with it       → streamed, word by word (not in one lump)
refresh            → same session resumes
quiz               → 5 questions, grading works
delete the test document and session afterwards
```

Always check the **streaming** by eye in the deployed site. It's the one feature that can be "working" and still broken (§13).

---

# 17. Logs in Production

`console.log` goes to stdout; the host captures it and shows it in the dashboard. That's your only window into a deployed process.

Things that change:

* **Chalk colours** may show as raw escape codes or be stripped. Readable either way, but JSON lines are friendlier to a log viewer (topic 12).
* Free tiers keep logs for a **short time**. If you need history, ship them somewhere.
* The `summarizeError` output (first line + cause chain + first in-repo frame) is even more valuable here: you can't attach a debugger.
* Stack frames now point at `dist/*.js` line numbers, not your `.ts` files. Source maps (`"sourceMap": true` + `node --enable-source-maps`) fix that.

---

# 18. Security Checklist for Going Public

The moment a URL is public, strangers and bots find it.

* **No auth.** Anyone with the URL can upload PDFs, read every document and every chat session, delete them, and spend your Gemini quota. That's the honest current state. See [topic 15](../15-auth-jwt/More_on_Auth_JWT.md) and [topic 16](../16-idempotency-multi-tenancy/More_on_Idempotency_Multi_Tenancy.md).
* **No rate limiting.** A loop against `/chat` exhausts the free tier. `express-rate-limit` is a few lines (see [advanced/05](../advanced/05-rate-limiting-retries/More_on_Rate_Limiting_Retries.md)). Behind a proxy it needs `app.set('trust proxy', 1)` to see real client IPs.
* **Secrets** only in the host's env settings. Rotate the Gemini key and DB password if they're ever exposed. (A leak through `.history/` already happened once.)
* **HTTPS** is provided by both hosts automatically.
* **Upload validation.** The mimetype check trusts the client's claimed type. A size cap exists. Real validation would check the file's magic bytes (`%PDF`).
* **Security headers.** `helmet` sets sensible defaults.
* **Dependencies.** `npm audit` now and then.
* **Don't put personal data in a public demo.** The database had resume text in orphan chunks; a public "all documents" search can surface anything stored.

---

# 19. Deploying the Worker (When Phase 6 Exists)

The roadmap says "the BullMQ worker as a Render free background worker". Check that before planning around it: Render's free instance type has historically covered **web services** (plus static sites and small databases), while **background workers** are a paid instance type.

Options if a free worker isn't available:

| Option | Tradeoff |
|---|---|
| Run the `Worker` **inside the web service process** | free; no process isolation; sleeps when the web service sleeps; CPU work competes with requests |
| A second free **web** service that starts a worker and exposes a tiny health route | works; also spins down when idle, so jobs wait until it's pinged |
| Another free host for the worker | more moving parts |
| Pay for a worker | the real answer |

For learning, in-process is fine: retries, backoff, status, and idempotency all behave the same. Say clearly in the README that it's a free-tier compromise.

And the constraint that actually matters: **separate services have separate disks.** A file the API saves isn't visible to the worker. Either keep the bytes somewhere shared (Postgres / object storage) or parse in the request and queue only the embedding work. See [topic 09 §16](../09-background-jobs-bullmq/More_on_Background_Jobs.md).

Graceful shutdown also becomes necessary: the host sends `SIGTERM` on every deploy, and `worker.close()` lets the current job finish.

---

# 20. Containers (What You Didn't Need, and Why to Know It)

Render and Vercel built the app from source using their own Node buildpacks. No Docker involved.

A **Docker image** packages your app with its exact OS, Node version and dependencies, so it runs identically everywhere. Most companies deploy this way.

A minimal Dockerfile for this API would be:

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
CMD ["node", "dist/index.js"]
```

That's a **multi-stage build**: the first stage has TypeScript and compiles; the second has only production dependencies and the compiled output, so the final image is small.

You don't need to build this for DocMind. You should be able to read one and explain the two stages.

---

# 21. Scaling (Conceptually)

DocMind runs as one instance. What would change with more load?

* **Vertical scaling**: a bigger instance (more RAM/CPU). Simple, has a ceiling.
* **Horizontal scaling**: more instances behind a load balancer. Requires **stateless** processes: any instance can serve any request.

DocMind is already stateless in the way that counts: sessions, messages, documents and chunks are all in Postgres; nothing important lives in process memory. Things that would break statelessness later: an in-memory rate limiter, in-memory workflow state, a temp file on disk.

Where the real bottlenecks would be:

```text
Gemini rate limits        → queue + backoff, batching, caching
sequential embedding      → batch embedding calls, more workers
vector search at scale    → an HNSW index on chunks.embedding  (see topics/02 INDEXING-AT-SCALE.md)
DB connections            → pooling
memory per upload         → streaming uploads to storage instead of buffering
```

---

# 22. Interview-Level Summary

If asked **"How is your project deployed?"**:

> The Express API is a Node web service on Render, built with `tsc` into `dist` and started with `node dist/index.js`. The React frontend is a static build on Vercel. Postgres with pgvector is on Neon, and the LLM is the Gemini API. Config comes from environment variables on each host; pushing to `main` auto-deploys.

If asked **"What broke or needed changing for production?"**:

> A few real things. CORS needed to accept several origins and tolerate a trailing slash in the configured URL. Uploads are held in memory and the instance has 512 MB, so I added a 10 MB cap that returns a 413. Unhandled errors were returning Express's HTML page, which broke the frontend's JSON parsing, so I added a JSON error handler. And for SSE I added `X-Accel-Buffering: no` so a proxy doesn't buffer the stream into one lump.

If asked **"Why is the first request slow?"**:

> It's on free tiers. The web service spins down when idle and the database auto-suspends, so the first request pays for both waking up. In production you'd keep at least one instance warm.

If asked **"How do you manage secrets?"**:

> They're environment variables set in the host's dashboard, never in the repo. The frontend only gets the API's URL; anything a frontend build can see is public, so the LLM key stays on the server.

If asked **"What would you do before real users?"**:

> Auth and per-user data scoping, rate limiting, a CI gate with type-checks and tests, proper migrations, separate dev and prod databases, structured logs with request ids, and moving ingestion to a background worker.

If asked **"Why not serverless for the API?"**:

> The chat endpoint streams over SSE and can stay open for a while. A long-lived Node process handles that simply; many serverless platforms buffer or cap response duration.

---

# 23. Things That Actually Bit You (and a Few That Will)

Real, from this project:

* A trailing slash in `FRONTEND_URL` would have failed every CORS check.
* Needing more than one allowed origin.
* Unhandled errors coming back as HTML.
* Unbounded uploads on 512 MB of RAM.
* SSE buffering behind a proxy.
* `rootDir` deciding whether the output is `dist/index.js` or `dist/src/index.js`.
* Markdown edits triggering API redeploys until build filters were set.

Waiting for you:

* Cold starts confusing a first-time visitor.
* Changing `VITE_API_URL` without redeploying the frontend.
* A Vercel preview URL that isn't in the CORS allow-list.
* The worker and API not sharing a disk.
* Local dev and production sharing one database.
* Short log retention.
* A public API with no auth and no rate limit.

---

# 24. Final Mental Model

```text
        YOUR LAPTOP                         THE INTERNET
   ┌──────────────────┐
   │  git push main   │
   └──────────────────┘
            │
   ┌────────┴─────────┐
   ▼                  ▼
 VERCEL             RENDER
 npm run build      npm install && npm run build
 (VITE_API_URL      (tsc → dist/)
  baked in)         npm start → node dist/index.js
   │                listens on process.env.PORT
   │                reads GEMINI_API_KEY, DATABASE_URL, FRONTEND_URL
   ▼                  ▼
 static files  ───►  API  ───►  Neon (Postgres + pgvector)
 in the browser   CORS check    Gemini (generate + embed)
                  HTTPS proxy
                  (don't buffer SSE)
```

**Build once, run the built JS. Dev tooling stays home.**

**Config lives in the environment. Secrets never reach the repo or the frontend bundle.**

**Listen on `PORT`. Allow the frontend's origin exactly.**

**Free tiers sleep: expect cold starts, lose memory and disk on every restart.**

**Streaming needs a proxy that doesn't buffer.**

**A deploy is finished when you've tested the live URL, not when the dashboard is green.**
