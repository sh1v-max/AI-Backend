# Auth Plan: JWT login + guest mode + per-user data

**Status:** built and deployed (written 2026-10-02, built 2026-10-03 → 10-04, live through PR #3). Everything below was the plan; what actually happened per step, including what bit, is in the [results log](#9-results-log-fill-in-while-building). Differences from the plan: AUTH.6 (login UI) was built before the deploy instead of after, and the `trust proxy` hop count took three tries (1 → 2 → 3, see the Deploy and Trust proxy rows).
**Scope:** every endpoint except `GET /`. Backend, database and frontend all change.
**Why this file exists:** DocMind is live, and anyone who opens the link sees every PDF and every conversation ever uploaded. The cause is that nothing in the app knows *who* is asking: `documents`, `chunks` and `chat_messages` have no owner, so `GET /documents` and `GET /sessions` return all rows to everyone. This file is the full plan to fix that: the design, the rules to follow while building, the build order, and every file that changes.

> Code references use **function names** as the anchor (line numbers drift). If this file and the code disagree, the code wins. Re-check before building.

> This pulls roadmap **Step 11.2 (Auth/JWT)** and half of **Step 11.3 (multi-tenancy)** forward from "reading only" to "actually built". The concepts are explained in [More_on_Auth_JWT.md](topics/15-auth-jwt/More_on_Auth_JWT.md). This file is only the build plan.

---

## Contents

- [1. The problem in one picture](#1-the-problem-in-one-picture)
- [2. Design](#2-design)
- [3. Rules to follow while building](#3-rules-to-follow-while-building)
- [4. Roadmap (build order, with time)](#4-roadmap-build-order-with-time)
- [5. File edits, file by file](#5-file-edits-file-by-file)
- [6. Test checklist](#6-test-checklist)
- [7. What this plan deliberately does NOT cover](#7-what-this-plan-deliberately-does-not-cover)
- [8. Decisions (answered by Shiv, 2026-10-03)](#8-decisions-answered-by-shiv-2026-10-03)
- [9. Results log (fill in while building)](#9-results-log-fill-in-while-building)

---

## 1. The problem in one picture

```
TODAY                                   AFTER THIS PLAN

browser A ─┐                            browser A ── token(user A) ─┐
browser B ─┼─► GET /documents           browser B ── token(user B) ─┼─► GET /documents
browser C ─┘        │                   browser C ── token(guest C)─┘        │
                    ▼                                                        ▼
        SELECT * FROM documents             SELECT * FROM documents WHERE user_id = <from token>
        (everyone gets everything)          (each caller gets only their own rows)
```

Two separate jobs, and both are needed:

| Job | Question | Built in | Fails with |
|---|---|---|---|
| **Authentication** | Who are you? | `requireAuth` middleware (verifies the JWT) | 401 |
| **Authorization (ownership)** | Is this row yours? | `userId` filter in every repository query | 404 |

Login alone fixes nothing. If only the list endpoints were filtered, anyone holding a `documentId` could still chat with that file, quiz it, or delete it. The ownership filter on every query is the real fix. The JWT is just how the server learns the `userId` to filter by.

---

## 2. Design

### 2.1 Guests are real users

A guest is a row in the `users` table with `is_guest = true` and no email or password. `POST /auth/guest` creates that row and returns a JWT for it.

Why this and not "skip auth when there is no token":

- There is **one** code path. A guest token goes through the same middleware and the same ownership filters as a registered user's token. No `if (guest)` anywhere in the data layer.
- A guest can **upgrade** later: registering fills in `email` + `password_hash` on the *same* row, so their documents and chats stay.
- The only places that look at `isGuest` are the limits (2.7) and the UI label.

The cost: a guest's identity lives only in that browser's `localStorage`. Clear it, switch device, or let the token expire, and the data is unreachable. The UI should say so.

### 2.2 Tokens

| | Choice | Why |
|---|---|---|
| Format | JWT, **HS256**, one secret (`JWT_SECRET`) | One server signs and verifies. RS256 only matters when other services verify |
| Payload | `{ sub: userId, guest: boolean }` + `iat`/`exp` | Smallest thing that works. No email, nothing private (a JWT is readable by anyone) |
| Lifetime | registered: **7 days**. guest: **30 days** | A guest can't log back in, so an expired guest token means lost data |
| Sent as | `Authorization: Bearer <token>` header | Frontend (Vercel) and API (Render) are different sites. A cookie from the API would be a third-party cookie, which browsers block more and more |
| Stored | `localStorage` key `docmind:token` | Simple, survives refresh. Readable by XSS, which is the known tradeoff (see section 7) |
| Refresh tokens | **Not in v1** | Listed in section 7. The new learning here is ownership and the streaming problem, not token rotation |

Logout in v1 is client-side: drop the token. The token itself stays valid until it expires. That is an honest limitation of stateless JWTs and worth being able to say in an interview.

### 2.3 Database changes

One new table and two new columns. All additive and nullable, so the live tables don't lock and the **old deployed code keeps working** while the new code is being built.

```sql
-- Run on Neon BEFORE deploying any new code (AUTH.0).

CREATE TABLE users (
  id            TEXT PRIMARY KEY,                 -- uuid, same style as documents.id
  email         TEXT UNIQUE,                      -- NULL for guests (Postgres allows many NULLs in a UNIQUE column)
  password_hash TEXT,                             -- NULL for guests
  is_guest      BOOLEAN   NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE documents     ADD COLUMN user_id TEXT;
ALTER TABLE chat_messages ADD COLUMN user_id TEXT;

CREATE INDEX documents_user_id_idx          ON documents (user_id);
CREATE INDEX chat_messages_user_session_idx ON chat_messages (user_id, session_id);
```

**`chunks` gets no `user_id` column.** A chunk belongs to a document, and the document has the owner. `searchSimilar` already joins `documents`, so the filter goes on `documents.user_id`. This is different from what [More_on_Auth_JWT.md](topics/15-auth-jwt/More_on_Auth_JWT.md) section 14 suggests (denormalize `user_id` onto chunks). That advice matters once there is an ANN index (HNSW) and many tenants, because the index returns its top-k *before* the join filter runs and one tenant's results can get filtered down to nothing. DocMind has no vector index today (it scans), so the join is correct and simpler. Revisit if an index is ever added.

**`chat_messages` does need `user_id`.** An "All documents" session has `document_id = 'all'`, so there is no document row to find the owner through.

**Existing rows** get `user_id = NULL`, which matches no user, so they become invisible to everyone the moment the new code is live. See AUTH.7 for what to do with them.

### 2.4 Endpoints

New (public, no token needed):

| Method & path | Body | Returns | Errors |
|---|---|---|---|
| `POST /auth/guest` | none | `201 { token, user }` | |
| `POST /auth/register` | `{ email, password }` | `201 { token, user }` | 400 invalid, 409 email taken |
| `POST /auth/login` | `{ email, password }` | `200 { token, user }` | 400 invalid, 401 wrong credentials |

New (token required):

| Method & path | Returns | Errors |
|---|---|---|
| `GET /auth/me` | `{ user }` | 401 bad/expired token, or the user row is gone |

`user` is always `{ id, email, isGuest }`. Never the hash.

**Guest upgrade:** if `POST /auth/register` arrives *with* a valid guest token in the header, the server updates that guest row (sets email, hash, `is_guest = false`) instead of creating a new user. Same `id`, so all their data stays. Without a token it creates a fresh user.

**Login while a guest:** the browser switches to the logged-in account and the guest's data is left behind. v1 warns in the UI ("your guest files will stay with this browser's guest session"). Merging guest data into an existing account is in section 7.

Existing endpoints: paths, bodies and the SSE protocol **do not change**. They all now require the header, and all only see the caller's rows.

| Endpoint | New behavior |
|---|---|
| `GET /documents`, `GET /sessions` | only the caller's rows |
| `POST /upload` | row saved with the caller's `user_id`. 403 when over the document cap (2.7) |
| `DELETE /documents/:id` | 404 if it isn't the caller's |
| `GET /sessions/:id/messages`, `DELETE /sessions/:id` | filtered by caller. Someone else's session looks like an empty one |
| `POST /chat`, `GET /chat-stream` | search, history and saved messages all scoped to the caller |
| `POST /quiz` | 404 if the document isn't the caller's |

### 2.5 Where verification sits

```
app.ts

  express.json()
  cors()
  GET /                    public (health)
  authRouter               public  (/auth/guest, /auth/register, /auth/login; /auth/me protects itself)
  ─────── app.use(requireAuth) ───────   everything below needs a valid token
  documentsRouter
  sessionsRouter
  chatRouter
  quizRouter
  error handler
```

**Default deny.** The protected routers are mounted *after* the middleware, so a route added next month is protected without anyone remembering to do it. The opposite design (adding `requireAuth` to each route by hand) fails silently the first time someone forgets.

`requireAuth` only verifies the signature and expiry. It does **not** hit the database. That is the point of a JWT: the proof is in the token.

### 2.6 The streaming problem

`/chat-stream` is consumed with the browser's `EventSource`, and `EventSource` **cannot send an `Authorization` header**. Its constructor takes a URL and nothing else useful.

| Option | Verdict |
|---|---|
| Token in the query string (`?token=...`) | Works in 5 minutes. But URLs end up in server logs, proxy logs and browser history. No |
| Cookie auth + `withCredentials` | Frontend and API are different sites, so it's a third-party cookie. Fragile |
| One-time ticket (`POST /chat-stream/ticket` then `?ticket=`) | Safe, but an extra endpoint, extra storage and an extra request |
| **`fetch` + `response.body.getReader()`** | **Chosen.** Headers work normally. Parse the SSE frames by hand |

The backend route stays exactly as it is: still `GET /chat-stream`, same four frame types. Only the frontend's `streamChatMessage()` changes, and it keeps the same `StreamHandlers` interface, so `useChat.ts` does not change at all.

Nice symmetry: the frame parser needed in the browser is the same one already written in `streamAnswer()` on the backend (buffer, normalize `\r\n`, split on the blank line, keep the trailing partial frame).

Side benefit: `fetch` can read a non-200 body, so a 400/401/404 from `/chat-stream` shows its real message instead of "Connection lost".

What is lost: `EventSource` auto-reconnects. DocMind closes the stream on any error anyway, so nothing actually depended on it.

### 2.7 Limits (why guests need a cap)

`POST /auth/guest` is public and free to call, so anyone can create guests in a loop and each one can upload PDFs that cost Gemini embedding calls. A cap per user limits the damage per identity:

```ts
// config.ts
export const GUEST_MAX_DOCUMENTS = 5
export const USER_MAX_DOCUMENTS = 10
```

Checked in the upload route before `ingestPdf()`. It also gives guests a reason to sign up.

This does not stop someone minting thousands of guests. That needs rate limiting by IP on `/auth/*`, which is topic A5. Flagged in section 7, with a 20-minute optional version in AUTH.7.

### 2.8 Libraries

| Package | For | Note |
|---|---|---|
| `jsonwebtoken` + `@types/jsonwebtoken` | sign / verify | Already what the More_on file uses |
| `bcryptjs` | password hashing | Pure JS. Native `bcrypt` needs a compiler toolchain, which is a common install failure on Windows and can slow Render builds. Slower per hash, irrelevant at this scale |
| `zod` (already installed) | validate `/auth/register` and `/auth/login` bodies | Same `safeParse` habit as the quiz, now on request bodies |

No frontend packages.

---

## 3. Rules to follow while building

1. **`userId` comes from the verified token and nowhere else.** Always `req.user.id`. Never from the body, the query string or a URL param. A client can put any id it likes in those.
2. **Default deny.** Protected routers are mounted after `app.use(requireAuth)`. Public routes are the exception and are listed explicitly above that line.
3. **`userId` is a required parameter on every repository function that reads, updates or deletes user data.** Required, not optional. That turns "forgot to filter" into a TypeScript compile error instead of a data leak. This is the single most useful trick in the plan.
4. **Someone else's resource is a 404, not a 403.** 403 confirms the id exists. 404 says nothing. (403 is used only for "you are who you say, but over your limit".)
5. **Services never touch `req`/`res`.** Existing rule, still applies. The route reads `req.user.id` and passes it in: `prepareChat({ ..., userId }, t0)`.
6. **Nothing outside `repositories/` touches SQL.** Existing rule. All user queries go in the new `users.repository.ts`.
7. **`jwt.verify`, never `jwt.decode`.** And pin the algorithm: `jwt.verify(token, secret, { algorithms: ['HS256'] })`. Without the pin, a token claiming a different algorithm is the classic JWT attack.
8. **`password_hash` never leaves the backend.** Only `findUserByEmail()` selects it, only `auth.service.ts` reads it. Every other user query selects `id, email, is_guest` by name. Never `select()` with no column list on `users`.
9. **Never log a token, a password or a hash.** Log `userId.slice(0, 8)` when a log line needs to show who.
10. **Same error for "no such email" and "wrong password":** `401 Invalid email or password`. Two different messages tell an attacker which emails are registered.
11. **Guests are users.** No guest branches in repositories or services. `isGuest` is read only by the limit check and the UI.
12. **Logging is a feature.** Keep every existing `pipelineLogger` call. Add one `detail()` line showing the user in step 1 of the chat, quiz and upload pipelines, and an `auth` theme for the `/auth/*` routes.
13. **Database changes are additive and go first.** Add nullable columns, deploy code that uses them, and only then think about tightening. Never a change that breaks the currently deployed code.
14. **Build on a branch, deploy once.** Render and Vercel both auto-deploy from `main`. A backend that demands tokens with a frontend that doesn't send them is a broken live site. Merge only when AUTH.1 to AUTH.6 all work locally.
15. **`JWT_SECRET` lives in `.env` and the Render dashboard only.** Add a placeholder line to `.env.example`. Never print it.
16. **Project conventions still apply:** conversational "why" comments, an `Auth.N —` marker on new code, `npx tsc --noEmit` after backend edits, free tier only, and Shiv does every commit and push.

---

## 4. Roadmap (build order, with time)

| Step | What | Main files | Time |
|---|---|---|---|
| **AUTH.0** | Prep: branch, packages, `JWT_SECRET`, run the SQL on Neon | `package.json`, `.env`, `.env.example`, `schema.ts` | 30 min |
| **AUTH.1** | Users + tokens: repository, service, `/auth/*` routes | `users.repository.ts`, `auth.service.ts`, `auth.schema.ts`, `auth.routes.ts` | 2 to 2.5 h |
| **AUTH.2** | `requireAuth` middleware, `req.user` typing, mount in `app.ts` | `middleware/auth.ts`, `types/express.d.ts`, `app.ts` | 45 min to 1 h |
| **AUTH.3** | Ownership: `userId` through every repository, service and route | 3 repositories, 3 services, 4 route files | 2.5 to 3 h |
| **AUTH.4** | Frontend plumbing: token store, `authFetch`, `useAuth`, auto guest, app gate | `api/client.ts`, `api/auth.ts`, `hooks/useAuth.ts`, `App.tsx`, all `api/*.ts` | 1.5 to 2 h |
| **AUTH.5** | Streaming: replace `EventSource` with `fetch` streaming | `api/chat.ts` | 1 to 1.5 h |
| **AUTH.6** | Auth UI: sign in / sign up modal, account area in the sidebar, guest upgrade, logout | `components/auth/*`, `Sidebar.tsx`, `App.css` | 2 to 2.5 h |
| **AUTH.7** | Limits, existing data, deploy, break-it testing on the live site | `config.ts`, `documents.routes.ts`, Render dashboard | 1 to 1.5 h |
| **AUTH.8** | Docs: CLAUDE.md, README, CODE_EXPLAINED, PROGRESS, walkthrough | docs | 45 min to 1 h |

### Time estimate

- **If you type it yourself and understand each piece: 12 to 15 focused hours**, so 3 to 4 sittings.
- **If Claude writes it and you review, run and test each step: 5 to 7 hours**, so 2 sittings. Most of that is your review and the testing, not the writing.

**Shortest path that fixes the public problem** (given the Oct 8 deadline): AUTH.0 to AUTH.5 plus AUTH.7, with guest mode only and no login UI. About **8 to 9 hours self-typed, 3 to 4 hours with Claude writing**. Every visitor silently gets their own guest account and sees only their own files. The sign in / sign up UI (AUTH.6) can follow as a second deploy, because the backend endpoints for it already exist after AUTH.1.

### Why this order

1. **AUTH.0 first** because the SQL is safe to run against the live database on its own (additive, nullable), and everything after needs it.
2. **AUTH.1 before AUTH.2** so there is a way to get a real token before anything demands one.
3. **AUTH.3 is tested with curl/Postman** using tokens from AUTH.1. Two guest tokens are enough to run the whole isolation checklist in section 6 before any frontend exists.
4. **AUTH.4 before AUTH.5** because the stream needs the token store.
5. **AUTH.6 last among the code steps** because it is the only optional one.

---

### AUTH.0: Prep

1. `git checkout -b auth-branch` (Shiv).
2. `npm install jsonwebtoken bcryptjs` and `npm install -D @types/jsonwebtoken`. If `tsc` then complains about bcryptjs types, add `@types/bcryptjs` (newer bcryptjs versions ship their own).
3. Generate a secret and add `JWT_SECRET=...` to `.env`:
   `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
   Add `JWT_SECRET=change_me_to_a_long_random_string` to `.env.example`.
4. Run the SQL from section 2.3 in the Neon SQL editor.
5. Mirror it in `schema.ts` (users table, the two `userId` columns), with the SQL kept in a comment like the other tables.

**Check:** the live site still works exactly as before. `npx tsc --noEmit` is clean.

**Gotcha:** if local dev and Render share one Neon database, this SQL changes production. It is safe because nothing reads the new columns yet. Confirm which database `.env` points at before running anything.

### AUTH.1: Users, tokens and the `/auth` routes

**`users.repository.ts`** (new): `createGuest()`, `createUser(email, passwordHash)`, `upgradeGuest(id, email, passwordHash)`, `findUserByEmail(email)` (the only one that returns the hash), `findUserById(id)`.

**`auth.service.ts`** (new):

```ts
export interface AuthUser { id: string; isGuest: boolean }

signToken(user)            // jwt.sign({ sub: user.id, guest: user.isGuest }, secret, { algorithm: 'HS256', expiresIn })
verifyToken(token)         // jwt.verify(..., { algorithms: ['HS256'] }) -> AuthUser | null   (null, never throws)
loginAsGuest()             // createGuest() + signToken
register(input, guest?)    // zod check -> hash -> upgradeGuest() or createUser() -> signToken
login(input)               // zod check -> findUserByEmail -> bcrypt.compare -> signToken
```

Same return style as `prepareChat()`: `{ ok: true, token, user } | { ok: false, status, error }`. The route sends the response.

**`auth.schema.ts`** (new): `email` trimmed and lowercased, `password` 8 to 72 characters.

**`auth.routes.ts`** (new): four thin routes, each wrapped in `withErrorHandling`.

**Gotchas**

- **72 is not arbitrary.** bcrypt silently ignores everything after 72 bytes, so two long passwords with the same first 72 bytes would both log in. Reject longer ones.
- **Lowercase the email before saving and before looking up**, or `Shiv@x.com` and `shiv@x.com` become two accounts.
- **Duplicate email has a race.** "Check then insert" lets two simultaneous requests both pass the check. The `UNIQUE` constraint is the real guard: catch Postgres error code `23505` on insert and return 409.
- **`register` reads the header itself.** It is a public route, so `requireAuth` hasn't run. It calls `verifyToken()` on the header if one is present, and only upgrades when the token is valid *and* that user is still a guest.
- **A missing `JWT_SECRET` must fail loudly.** Read it through one small function that throws a clear message, and check it at startup in `index.ts`, so a misconfigured Render deploy dies at boot instead of on the first login.

**Tests (curl/Postman):** guest returns a token; register returns a token; registering the same email again gives 409; login with the right password works; wrong password and unknown email give the *same* 401; bad email format and a 5-character password give 400; paste the token into jwt.io and confirm the payload holds only `sub`, `guest`, `iat`, `exp`.

### AUTH.2: The middleware

```ts
// src/middleware/auth.ts
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  const user = token ? verifyToken(token) : null
  if (!user) return res.status(401).json({ error: 'Sign in required' })
  req.user = user
  next()
}
```

`req.user` doesn't exist on Express's `Request` type, so it is added by declaration merging:

```ts
// src/types/express.d.ts
import type { AuthUser } from '../services/auth.service'
declare global {
  namespace Express {
    interface Request { user?: AuthUser }
  }
}
export {}
```

Then in `app.ts`: mount `authRouter`, then `app.use(requireAuth)`, then the four existing routers.

**Gotchas**

- **`user` is optional in the type** (`user?:`), because on public routes it really is missing. Protected handlers use `req.user!.id`. The `!` is safe there only because of where the router is mounted, which is one more reason for the default-deny layout.
- **CORS preflight.** A custom `Authorization` header makes the browser send an `OPTIONS` request first. `cors()` is mounted before `requireAuth`, so it answers the preflight before auth ever sees it. Keep that order. If `requireAuth` came first, every browser request would fail with a CORS error that looks nothing like an auth problem.
- **`npm run dev` uses `--transpile-only`**, so a wrong `req.user` type won't stop the server. Run `npx tsc --noEmit`.
- **401 on the stream route.** `requireAuth` returns a normal 401 JSON for `/chat-stream`. That was unreadable for `EventSource`, and is fine after AUTH.5 because `fetch` can read it.

**Tests:** no header gives 401 on all nine protected endpoints; `GET /` and `/auth/*` still work without one; a token with one character changed gives 401; a token signed with a different secret gives 401.

### AUTH.3: Ownership through the data layer

The biggest step, and the one that actually fixes the bug. Every change is listed in section 5. The pattern is always the same three moves:

```
route:       const userId = req.user!.id            (rule 1)
service:     takes userId as an argument            (rule 5)
repository:  WHERE ... AND user_id = userId         (rule 3)
```

The interesting ones:

**`searchSimilar`** takes `userId` and filters through the join it already has:

```ts
.where(
  documentId
    ? and(eq(chunks.documentId, documentId), eq(documents.userId, userId))
    : eq(documents.userId, userId),
)
```

In single-document mode this does the ownership check and the search in one query. Someone else's `documentId` returns zero chunks, and the existing "No document found with that documentId" 404 fires with no new code. The old `isNotNull(documents.id)` orphan filter is no longer needed: a chunk with no `documents` row has a NULL `user_id` through the join and can never match.

**`sampleChunks`** (quiz) has no join today. It needs an `innerJoin(documents, ...)` plus the same `userId` filter.

**Sessions.** A session is just a `session_id` on message rows, and the **client chooses the id**. So every session query filters on `session_id` AND `user_id`. If user B sends user A's `sessionId`, B's query finds nothing of A's: no history is loaded into B's prompt, and B's new messages are saved under B's `user_id`. The two never mix, with no separate "does this session belong to you" lookup.

**`DELETE /documents/:id`** runs three deletes. Check ownership once at the top (`getDocumentForUser`, 404 if missing), then delete chunks, messages and the document row.

**Gotchas**

- **`getRecentMessages` is the easy one to miss.** It doesn't return data to the client, it feeds the *prompt*. Unfiltered, user B could send A's `sessionId` and ask "summarise our conversation so far", and the model would answer from A's history. A leak through the LLM is still a leak.
- **`listSessions` runs two queries** (messages, then documents for filenames). Both need the filter.
- **This breaks old orphan sessions on purpose.** CLAUDE.md section 8 notes that a session pinned to an orphan chunk group still works in single-document mode. After this step it won't, since orphans have no owner. That is the correct outcome.
- **Use `and(...)` from drizzle-orm**, not two chained `.where()` calls. A second `.where()` replaces the first.

**Tests:** the full isolation checklist in section 6, with two tokens in Postman.

### AUTH.4: Frontend plumbing

**`api/client.ts`** gets the token store and one wrapper that every API file uses:

```ts
getToken() / setToken() / clearToken()        // localStorage 'docmind:token', each in try/catch
authFetch(path, init?)                        // adds Authorization, and on a 401 calls the registered handler
onUnauthorized(handler)                       // useAuth registers "token is dead, start over"
```

**`api/auth.ts`** (new): `guestLogin()`, `register()`, `login()`, `fetchMe()`.

**`hooks/useAuth.ts`** (new). On mount:

```
token in localStorage?
   ├── yes → GET /auth/me ── 200 → ready (this user)
   │                      └─ 401 → clear token, fall through
   └── no  → POST /auth/guest → save token → ready (guest)
```

**`App.tsx`** is split in two. Today's body moves into an `AppShell` component, and `App` becomes a small gate:

```tsx
function App() {
  const auth = useAuth()
  if (auth.status === 'loading') return <SplashScreen />
  return <AppShell key={auth.user.id} auth={auth} />
}
```

**Gotchas**

- **Why the gate exists.** `useDocuments`, `useSessions` and `useChat` all fetch on mount. Without the gate they fire before any token exists and get three 401s on first load.
- **Why `key={auth.user.id}`.** When the user changes (guest signs in, or logs out), a different `key` makes React throw away the whole `AppShell` and build a fresh one. All three hooks remount and refetch for the new user, and no state from the previous user survives in memory. Without it, the old user's documents would stay on screen until a manual refresh.
- **A real bug waiting in the current code:** `fetchDocuments()` and `fetchSessions()` call `res.json()` without checking `res.ok`. On a 401 they would receive `{ error: ... }` and then crash on `.map`. Both must go through `parseJsonOrThrow`.
- **`/upload` must not get a `Content-Type` header from `authFetch`.** The browser sets the multipart boundary itself. `authFetch` adds only `Authorization` and leaves the rest of `init.headers` alone.
- **StrictMode runs effects twice in dev**, so a naive `useAuth` creates two guest users on first load. Guard with a ref, or a module-level in-flight promise that both runs share.
- **`docmind:activeSessionId`** from a previous user is harmless, because `useChat` already cross-checks it against `GET /sessions` and drops it if missing. Clear it on logout anyway.

**Tests:** fresh browser profile: exactly one `POST /auth/guest`, then the app loads empty. Refresh: `GET /auth/me`, no new guest. Corrupt the token in devtools and refresh: a new guest is created without an error on screen. Upload in a normal window and in a private window: each sees only its own file.

### AUTH.5: Streaming with `fetch`

Rewrite the body of `streamChatMessage()` in `api/chat.ts`. Signature and `StreamHandlers` stay the same.

```ts
const controller = new AbortController()
const res = await authFetch(url, { signal: controller.signal })
if (!res.ok) { handlers.onError((await res.json()).error); return }   // 400/401/404 now readable

const reader = res.body!.getReader()
const decoder = new TextDecoder()
let buffer = ''
while (true) {
  const { value, done } = await reader.read()
  if (done) break
  buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n')
  const frames = buffer.split('\n\n')
  buffer = frames.pop() ?? ''              // the last piece may be half a frame: keep it for the next read
  for (const frame of frames) dispatch(frame)   // read the `event:` and `data:` lines, call the right handler
}
return () => controller.abort()            // the cleanup function, was source.close()
```

**Gotchas**

- **A frame can be split across two reads**, and so can a multi-byte character. `buffer` handles the first, `{ stream: true }` on the decoder handles the second. Same reasoning as `streamAnswer()`.
- **No `event:` line means the default event**, which is the `{ text }` piece. `EventSource` did that mapping silently (`onmessage`). Now it is explicit.
- **The stream ending without a `done` or `error` frame** means the connection dropped. Call `onError('Connection lost')`, otherwise the UI stays on "Thinking…" forever. `EventSource` used to raise this as its native error event.
- **Aborting throws an `AbortError`** inside the read loop. Catch it and stay silent: it's the cleanup function doing its job, not a failure.
- **`onDone` / `onError` must fire exactly once.** `useChat.sendMessage()` awaits a promise that only those two resolve.

**Tests:** a normal streamed answer looks identical to before; an empty message shows the real 400 text; stopping the backend mid-answer shows "Connection lost" and re-enables the input; a bad Gemini key still shows the `event: error` message; the Network tab shows an `Authorization` header and **no token in the URL**.

### AUTH.6: Auth UI (optional for the first deploy)

- **`components/auth/AuthModal.tsx`**: one modal, two modes (sign in / create account), email + password, inline error from the API, disabled while submitting. Reuse the quiz modal's overlay styling so it matches.
- **`Sidebar.tsx`**: an account area at the bottom. Guest: "Guest" label + "Sign up to keep your files" button. Signed in: the email + "Log out".
- **Guest upgrade**: sign up sends the current guest token, so the same user comes back with `isGuest: false` and the files stay on screen. Because the `id` didn't change, `key={auth.user.id}` doesn't remount anything, which is exactly right.
- **Sign in from a guest with files**: show the warning from 2.4 before switching.
- **Log out**: clear the token, then start a new guest session, so the app is never left in a "nobody" state.
- When the upload cap returns 403, show its message and point at sign up.

**Tests:** upgrade keeps documents and sessions; log out then sign in on a second browser shows the same files; wrong password shows the error and doesn't close the modal; the modal works at mobile width.

### AUTH.7: Limits, old data, deploy

1. **Document cap**: `countDocuments(userId)` in the upload route before `ingestPdf()`. 403 with a clear message.
2. **Old rows** (all have `user_id = NULL`). Pick one, Shiv's call:
   - **Claim them**: register your own account, copy your id from the `users` table, then
     `UPDATE documents SET user_id = '<id>' WHERE user_id IS NULL;` and the same for `chat_messages`.
   - **Delete them**: `DELETE FROM chat_messages WHERE user_id IS NULL;` then delete the chunks whose document has no owner, then the documents.
   - Either way this is the moment to remove the 8 orphan chunk groups, since nothing can reach them any more: `DELETE FROM chunks WHERE document_id NOT IN (SELECT id FROM documents);`
3. **Deploy**: add `JWT_SECRET` in the Render dashboard **before** merging. Then merge `auth-branch` into `main` (Shiv). Render and Vercel redeploy together.
4. **Optional, 20 min**: `express-rate-limit` on `/auth/*` (for example 20 requests per 15 minutes per IP). Render sits behind a proxy, so it needs `app.set('trust proxy', 1)` or every visitor looks like the same IP.
5. **Break it on the live URL**: run section 6 again against Render, in two different browsers.

**Gotcha:** Render's free instance sleeps. The first request after a sleep takes 30+ seconds, and with this plan that first request is `POST /auth/guest`, so the splash screen is what a visitor sees during a cold start. Make it say something ("Waking up the server…").

### AUTH.8: Docs

CLAUDE.md (sections 3, 4, 6, 7, 8, 9, 13), README (features, API table, setup `.env` + users SQL, limitations), a new section in CODE_EXPLAINED.md, PROGRESS (topic 15 and the multi-tenancy half of 16), the walkthrough's Step 11.2. `topics/15-auth-jwt/NOTES.md` stays Shiv's to write.

---

## 5. File edits, file by file

### Backend: new files

| File | Contents |
|---|---|
| `src/repositories/users.repository.ts` | `createGuest`, `createUser`, `upgradeGuest`, `findUserByEmail`, `findUserById` |
| `src/services/auth.service.ts` | `AuthUser`, `signToken`, `verifyToken`, `loginAsGuest`, `register`, `login` |
| `src/schemas/auth.schema.ts` | Zod `Credentials` (email, password 8 to 72) |
| `src/routes/auth.routes.ts` | `POST /auth/guest`, `POST /auth/register`, `POST /auth/login`, `GET /auth/me` |
| `src/middleware/auth.ts` | `requireAuth` |
| `src/types/express.d.ts` | adds `user?: AuthUser` to Express's `Request` |

### Backend: edited files

| File | Change |
|---|---|
| `src/db/schema.ts` | add the `users` table; add `userId: text('user_id')` to `documents` and `chatMessages`; SQL in comments |
| `src/config.ts` | `GUEST_MAX_DOCUMENTS`, `USER_MAX_DOCUMENTS`, `TOKEN_TTL_USER = '7d'`, `TOKEN_TTL_GUEST = '30d'` |
| `src/index.ts` | one startup check that `JWT_SECRET` is set (the file stays tiny) |
| `src/app.ts` | mount `authRouter`, then `app.use(requireAuth)`, then the existing four routers |
| `src/utils/pipelineLogger.ts` | an `auth` theme |
| `src/repositories/documents.repository.ts` | `insertDocument(..., userId)`; `listDocuments(userId)`; `deleteDocument(id, userId)`; new `getDocumentForUser(id, userId)` and `countDocuments(userId)` |
| `src/repositories/chunks.repository.ts` | `searchSimilar(embedding, limit, userId, documentId?)` filters on `documents.userId`; `sampleChunks(documentId, userId, count)` gains an inner join; `insertChunk` and `deleteChunksByDocumentId` unchanged (the caller checks ownership first) |
| `src/repositories/chatMessages.repository.ts` | `userId` added to `insertMessage`, `getRecentMessages`, `getMessagesForSession`, `listSessions` (both of its queries), `deleteSession`, `deleteMessagesByDocumentId` |
| `src/services/chat.service.ts` | `prepareChat` input gains `userId`; passed to `searchSimilar`, `getRecentMessages`, `insertMessage`; one `detail()` line for the user. `buildChatPrompt` untouched |
| `src/services/quiz.service.ts` | `generateQuiz` input gains `userId`; passed to `sampleChunks` |
| `src/services/ingestion.service.ts` | `ingestPdf(file, userId)`; passed to `insertDocument` |
| `src/routes/documents.routes.ts` | pass `req.user!.id` everywhere; ownership check at the top of DELETE; document cap before `ingestPdf` |
| `src/routes/sessions.routes.ts` | pass `req.user!.id` to all three repository calls |
| `src/routes/chat.routes.ts` | pass `userId` into `prepareChat` and into both assistant `insertMessage` calls. Nothing else changes: same headers, same frames |
| `src/routes/quiz.routes.ts` | pass `userId` into `generateQuiz` |
| `src/step4-quiz-zod.ts`, `src/step3-drizzle.ts` | both call the changed repository functions (`sampleChunks` / `searchSimilar`) directly, so each needs a user id argument or it stops compiling. Excluded from the production build, but `npx tsc --noEmit` covers them. Edit only, **never re-run step3** (it deletes the chunks table) |
| `package.json` | `jsonwebtoken`, `bcryptjs`, `@types/jsonwebtoken` |
| `.env.example` | `JWT_SECRET=` placeholder |

`llm.service.ts`, `embeddings.service.ts`, `utils/errors.ts`, `utils/chunkText.ts`, `schemas/quiz.schema.ts`, `db/client.ts`: **no change**.

### Frontend: new files

| File | Contents |
|---|---|
| `frontend/src/api/auth.ts` | `guestLogin`, `register`, `login`, `fetchMe` |
| `frontend/src/types/auth.ts` | `User { id, email, isGuest }`, `AuthResponse` |
| `frontend/src/hooks/useAuth.ts` | `status`, `user`, `login`, `register`, `logout` |
| `frontend/src/components/auth/AuthModal.tsx` | sign in / create account (AUTH.6) |
| `frontend/src/components/auth/AccountArea.tsx` | the sidebar's guest label or email + log out (AUTH.6) |

### Frontend: edited files

| File | Change |
|---|---|
| `frontend/src/api/client.ts` | token store, `authFetch`, `onUnauthorized` |
| `frontend/src/api/documents.ts` | `fetch` to `authFetch` (3 calls); `fetchDocuments` goes through `parseJsonOrThrow` |
| `frontend/src/api/sessions.ts` | `fetch` to `authFetch` (3 calls); `fetchSessions` and `fetchSessionMessages` go through `parseJsonOrThrow` |
| `frontend/src/api/quiz.ts` | `fetch` to `authFetch` |
| `frontend/src/api/chat.ts` | `sendChatMessage` uses `authFetch`; `streamChatMessage` rewritten on `fetch` + reader (AUTH.5) |
| `frontend/src/App.tsx` | split into the `App` gate + `AppShell`; owns the auth modal's open state |
| `frontend/src/components/sidebar/Sidebar.tsx` | renders `AccountArea` at the bottom |
| `frontend/src/App.css` | `.auth-*`, `.account-*`, splash screen |

`useChat.ts`, `useDocuments.ts`, `useSessions.ts`, `useQuiz.ts` and every chat/quiz component: **no change**. That is the payoff of the `api/` and `hooks/` split: auth is a transport concern, so it stays in `api/`.

---

## 6. Test checklist

Two users, **A** and **B** (two guest tokens are enough). A uploads one PDF and has one conversation.

| # | As B | Expected |
|---|---|---|
| 1 | `GET /documents` | `[]` |
| 2 | `GET /sessions` | `[]` |
| 3 | `POST /chat` with A's `documentId` | 404 |
| 4 | `GET /chat-stream` with A's `documentId` | 404 |
| 5 | `POST /chat` with `documentId: 'all'` | 404 "No documents have been uploaded yet" |
| 6 | `POST /quiz` with A's `documentId` | 404 |
| 7 | `DELETE /documents/<A's id>` | 404, and A's document, chunks and messages are **all still there** |
| 8 | `GET /sessions/<A's sessionId>/messages` | `[]` |
| 9 | `DELETE /sessions/<A's sessionId>` | A's messages are still there |
| 10 | `POST /chat` on B's own document, sending A's `sessionId` | answers normally, and the reply shows no knowledge of A's conversation |

Token handling:

| # | Request | Expected |
|---|---|---|
| 11 | any protected route, no header | 401 |
| 12 | token with one character changed | 401 |
| 13 | token signed with a different secret | 401 |
| 14 | expired token (set the TTL to `'5s'` temporarily, wait) | 401, and the frontend recovers into a new guest |
| 15 | a `userId` field added to a request body | ignored: the result is still the token's user |
| 16 | `GET /` and `POST /auth/guest`, no header | 200 / 201 |

Then check A still sees everything of theirs, unchanged.

**Logging check (CLAUDE.md section 10):** the terminal still shows the full `[1/7]` to `[7/7]` chat trace, the quiz trace and the upload trace, each now with the user line. Bad API key and wifi-off still print the same `summarizeError` block.

---

## 7. What this plan deliberately does NOT cover

| Not built | Why not now | What it would take |
|---|---|---|
| Refresh tokens + rotation | The cross-site cookie problem makes the proper version (httpOnly cookie) awkward on Vercel + Render | A `refresh_tokens` table, `/auth/refresh`, and the same parent domain or a proxy |
| Server-side logout / revocation | Stateless JWTs can't be revoked without a lookup | Comes with refresh tokens, or a token-version column on `users` |
| Email verification, password reset | Needs an email-sending service | Resend or similar, free tier |
| Rate limiting on `/auth/*` | Topic A5. A 20-minute version is optional in AUTH.7 | `express-rate-limit` + `trust proxy` |
| Merging a guest's data into an existing account on login | Edge case, needs a decision on conflicts | `UPDATE ... SET user_id = <account> WHERE user_id = <guest>` on both tables at login |
| Cleaning up abandoned guests | No cron on the free tier | A script: delete guests (and their rows) with no messages in 30 days. Needs a `last_seen_at` column |
| XSS hardening of the token | `localStorage` is readable by any script on the page. React escapes output by default and answers render as plain text, so the surface is small today. **It grows if markdown rendering is added (PI.5 in [prompt-improvement.md](prompt-improvement.md))**: sanitize then | In-memory access token + httpOnly refresh cookie |
| OAuth ("Sign in with Google") | A different topic | An auth provider (Clerk, Auth.js, Supabase Auth). In a real product this is what you'd use instead of hand-rolled passwords |
| Roles / admin | Nothing needs it | An enum column |
| Making `user_id` `NOT NULL` | Needs the old rows dealt with first (AUTH.7) | `ALTER COLUMN ... SET NOT NULL` once no NULLs remain |
| Foreign keys (`user_id REFERENCES users`) | The existing tables don't use FKs either (`chunks.document_id` has none). Consistent, not ideal | Add once the orphan rows are gone |

---

## 8. Decisions (answered by Shiv, 2026-10-03)

| # | Decision | Answer |
|---|---|---|
| D1 | Does a first-time visitor become a guest **automatically**, or see a welcome screen with "Continue as guest" / "Sign in"? | **Automatic** |
| D2 | First deploy with the login UI, or guest-only first and login UI second? | **Guest-only first**: AUTH.0 to AUTH.5 + AUTH.7. AUTH.6 (login UI) is a later deploy |
| D3 | Old rows: claim them for your account, or delete them? | **Deleted** by Shiv through the UI before the build started. Orphan chunks and any "All documents" sessions may still be in the tables: check in AUTH.7 |
| D4 | Document caps | **Guest 5, registered 10** |
| D5 | Rate limiting on `/auth/*` now or later? | **Now** (built in AUTH.7) |

---

## 9. Results log (fill in while building)

| Step | Date | Time taken | Notes / what bit you |
|---|---|---|---|
| AUTH.0 | 2026-10-03 | | Code side done: `jsonwebtoken` 9, `bcryptjs` 3 (ships its own types, no `@types/bcryptjs` needed), `schema.ts`, `.env.example`. Shiv ran the SQL on Neon and added `JWT_SECRET` to `.env` |
| AUTH.1 | 2026-10-03 | | `users.repository.ts`, `auth.service.ts`, `auth.schema.ts`, `auth.routes.ts` (guest, register, login), mounted in `app.ts`, startup `JWT_SECRET` check in `index.ts`, `auth` log theme. Tested live on a spare port, 13 cases, all as expected; the 2 test users were deleted afterwards. `GET /auth/me` moved to AUTH.2 (it needs the middleware). Not done: equal-time login for unknown emails (a missing account answers faster than a wrong password) |
| AUTH.2 | 2026-10-03 | | `middleware/auth.ts` (`requireAuth`), `types/express.d.ts` (`req.user`), `GET /auth/me` (route-level `requireAuth` + a DB lookup), `app.use(requireAuth)` after `authRouter`. Tested: all 9 data routes + `/auth/me` + an unknown path give 401 with no token; tampered / wrong-secret / expired / `alg: none` / missing `Bearer ` all 401; valid token 200; deleted-user token on `/auth/me` 401; CORS preflight with `authorization` still 204. What bit me: a test server from AUTH.1 survived `TaskStop` and kept answering on the test port with old code, so the first run looked like auth wasn't working. Check what is on the port before trusting a test |
| AUTH.3 | 2026-10-03 | | Required `userId` on every read/delete in all 3 repositories; `searchSimilar` and `sampleChunks` now INNER JOIN `documents` and filter on `documents.user_id` (replaces the old orphan filter); `getDocumentForUser` ownership check before DELETE's three deletes; `userId` through `prepareChat`, `generateQuiz`, `ingestPdf`; one `user:` log line per pipeline. Making `userId` required turned 15 call sites into compile errors, which is the checklist of what to change. Section 6 checklist run with two guests and a generated PDF: tests 1-10 and 15 all as expected; owner happy paths (upload, stream, follow-up using history, all-documents chat, quiz, delete) all work. What bit me: dotenv 17 prints a banner to stdout, which corrupted tokens made with `node -e` in tests (requests came back 400). Use `config({ quiet: true })`. Re-ran AUTH.2's expired and deleted-user token tests with clean tokens: still 401. Also: `step3-drizzle.ts` passed its document id where `userId` now goes and still compiled (both are strings), so positional string arguments are the one thing the compiler can't check. 65 orphan chunks are still in the table (unreachable now), to delete in AUTH.7 |
| AUTH.4 | 2026-10-04 | | `api/client.ts` (token store + `authFetch` + `onUnauthorized`), `api/auth.ts` (`guestLogin`, `fetchMe`, plain fetch on purpose), `types/auth.ts`, `hooks/useAuth.ts` (module-level in-flight promise against StrictMode's double mount; stale-401 guard compares the rejected token with the current one), `components/common/SplashScreen.tsx`, `App.tsx` split into the `App` gate + `AppShell` with `key={user.id}`, all `api/*` on `authFetch`, `fetchDocuments`/`fetchSessions`/`fetchSessionMessages` now go through `parseJsonOrThrow`. Tested in a headless browser against the dev servers: first visit makes exactly ONE `POST /auth/guest` (StrictMode dedupe works) and every data request carries the Bearer header; refresh reuses the token via `/auth/me`; a corrupted token gives `/auth/me` 401 then a new guest with no error screen; upload works; a second browser profile is a different guest and sees no documents. 5 test guests + 1 test PDF deleted afterwards. Chat is still broken until AUTH.5 (`EventSource` can't send the header). `oxlint` shows 2 warnings, both pre-existing (`QuizModal.tsx`, `useChat.ts`) |
| AUTH.5 | 2026-10-04 | | `streamChatMessage()` rewritten on `authFetch` + `res.body.getReader()` + a small `parseFrame()`; same signature and handlers, so `useChat.ts` is untouched; backend untouched. `finish()` guarantees exactly one `onDone`/`onError`; a body that ends without `done`/`error` gives "Connection lost"; `AbortError` from the cleanup is silent; non-200 bodies are now readable. Tested in a headless browser: real streamed answer + a follow-up that needed history, both with the Bearer header and no token in the URL; mocked streams for normal, CRLF, dropped connection, `event: error`, error-then-done (only the first counts), a `: ping` comment line, a 404 JSON body, and abort after 50 ms: all as expected. Noticed: aborting only stops the browser; the server finishes the request and still saves both messages (pre-existing, same as with EventSource) |
| AUTH.6 | 2026-10-04 | | Built early, at Shiv's request (D2 had deferred it). `api/auth.ts` `login()` / `register()` (register sends the current guest token so the server upgrades in place); `useAuth` gains `login`, `register`, `logout` (logout = drop the token and start a fresh guest); `components/auth/AuthModal.tsx` (one modal, sign in / create account, server errors shown as-is, a note when a guest with files signs up (kept) or signs in (left behind)); `components/auth/AccountArea.tsx` in the sidebar footer (guest: "Sign up to keep them" + "I already have an account", no log out; registered: initial, email, log out). `closeAuth` is a `useCallback` so streaming re-renders don't re-run the modal's focus effect. Tested in a headless browser: sign up keeps the same user id and the uploaded document; short password caught client-side; log out gives an empty new guest; wrong password and duplicate email show the server's messages; logging back in restores the document. Fixed while testing: an old mobile rule (`.sidebar .icon-button { display: none }`) hid the Log out button, and `display: block !important` on the brand broke the logo layout. 4 test users deleted |
| AUTH.7 | 2026-10-04 | | Code done: `GUEST_MAX_DOCUMENTS = 5` / `USER_MAX_DOCUMENTS = 10` / `AUTH_RATE_LIMIT = 20 per 15 min` in `config.ts`; `countDocuments()`; `checkDocumentCap` middleware placed BEFORE multer on `/upload` (403 with a sign-up hint for guests); `express-rate-limit` 8.7 in `middleware/rateLimit.ts`, one shared limiter on `/auth/guest`, `/auth/register`, `/auth/login` (not `/auth/me`); `app.set('trust proxy', 1)`; `ip:` log line on `/auth/guest`. Tested: 20 requests then 429 (and the counter is shared across routes), `RateLimit` + `Retry-After` headers present, `/` and `/auth/me` not limited; 5 uploads as a guest then 403, delete one and upload works again, same user as registered gets past 5. Found: locally a faked `X-Forwarded-For` header gets around the limiter, because no real proxy sits in front; on Render it depends on there being exactly 1 proxy hop, so check the `ip:` log line after deploy. DB before deploy: 0 documents, 0 unowned messages, 65 orphan chunks (all of `chunks`), 1 user. Remaining: Shiv runs the orphan-chunk SQL, sets `JWT_SECRET` on Render, merges |
| Deploy | 2026-10-04 | | Live (PR #3). Checked from outside: `/documents` and `/sessions` 401 without a token; two guests isolated (list `[]`, chat/quiz/delete of the other's document 404, all-documents 404); owner upload + streamed answer + delete work; CORS preflight from the Vercel origin allows `authorization`; live frontend gets a guest and sends the Bearer header, new account area shows. **Found:** `trust proxy = 1` was wrong. Five identical requests from one machine landed in two different rate-limit counters, because Render has two hops (Cloudflare, then Render's load balancer; every response has `CF-RAY`), so `req.ip` was a Cloudflare edge IP. Changed to `TRUST_PROXY_HOPS` (env, default 2) and confirmed with a local Express check that the visitor IP wins with and without a faked header. Needs a redeploy, then re-run the 5-request check. 3 live test users deleted |
| Trust proxy, round 2 | 2026-10-04 | | After `5eb5109` (2 hops) went live, re-measured: five identical requests now each got a **new** counter (`r=19; t=900` every time), so the limiter wasn't limiting at all. The `RateLimit-Policy` header's `pk` (first 12 hex of `sha256(key)`) changed every request and never matched `sha256` of the client IP Cloudflare reports at `/cdn-cgi/trace`. Fits a 3-hop chain `<client>, <Cloudflare edge>, <Render front proxy>`: 1 hop keyed on Render's front proxies (the earlier two counters), 2 on Cloudflare edges (new every request). Next: set `TRUST_PROXY_HOPS=3` in Render (env only, no code change) and check that `pk` matches `sha256(<your IP>)` |
| Trust proxy, round 3 | 2026-10-04 | | Shiv set `TRUST_PROXY_HOPS=3` in Render. Checked from outside with 5 `POST /auth/login {}` requests (400 from validation, so no rows created, but the limiter still counts them): `r=19, 18, 17, 16, 15`, one counter. `pk=:ZWMyZTFmZDU5MTZm:` decodes to `ec2e1fd5916f`, exactly the first 12 hex of `sha256(<client IP from /cdn-cgi/trace>)`. Two more with a faked `X-Forwarded-For` (`9.9.9.9`, `8.8.4.4`): same `pk`, counter kept going down (14, 13), so the client-written hop isn't trusted. Also re-checked: `/documents` 401 without a token, CORS preflight from the Vercel origin 204 with `authorization` allowed, frontend 200. Code default changed 2 → 3 and the comments in `app.ts`/`config.ts` updated. **Closed** |
| AUTH.8 | 2026-10-04 | | Docs: CLAUDE.md (§2–9, 11, 13), README (accounts, auth flow, API, setup SQL + `JWT_SECRET`, deployment, decisions, limitations), CODE_EXPLAINED.md (new auth section + frontend redesign section, end-to-end trace, limitations, glossary), PROGRESS (13, 15, 16), walkthrough (Phase 10 note, Steps 11.2/11.3, frontend redesign), roadmap (Phase E note), topic 15/16 More_on headers. NOTES.md for 15/16 left for Shiv |
