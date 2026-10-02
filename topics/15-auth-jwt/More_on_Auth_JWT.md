# 15 — Auth (JWT)

**Roadmap: Phase 11 (Step 11.2)** · **Status in DocMind: no auth at all.** Anyone who has the API URL can upload, read every document and conversation, delete things, and spend the Gemini quota. You already know JWT basics from other projects, so this file is the full reference plus the part that's new: wiring auth into an **AI backend's** request path (streaming, cost, per-user data).

Code this file talks about: [app.ts](../../src/app.ts), [chat.routes.ts](../../src/routes/chat.routes.ts), [chat.service.ts](../../src/services/chat.service.ts), [schema.ts](../../src/db/schema.ts), the frontend's `EventSource` use in `frontend/src/api/chat.ts`

---

# 1. Two Words That Get Mixed Up

```text
AUTHENTICATION (authn)   WHO are you?          → login, tokens      → fails with 401
AUTHORIZATION  (authz)   WHAT may you do?      → roles, ownership   → fails with 403
```

Analogy: a hotel.

* Showing ID at reception = **authentication**.
* Your key card opening only room 412 = **authorization**.

You need both. A backend that only checks "is this a logged-in user?" and then returns any document by id has authentication with no authorization. That's the most common real-world API vulnerability, and it has a name: **IDOR** (insecure direct object reference) / broken object-level authorization.

---

# 2. Why Auth Matters More in an AI Backend

Three reasons beyond the usual:

1. **Every request costs money or quota.** An unauthenticated `/chat` is a free LLM for the internet. Auth is what lets you say "this user gets N messages per day".
2. **Private documents.** Users upload contracts, resumes, medical reports. The whole product is "chat with *your* documents".
3. **Leaks can happen through the model.** If retrieval isn't scoped to the user, someone else's text gets pasted into the prompt and comes back as a helpful answer. No "access denied", no error. See [topic 16](../16-idempotency-multi-tenancy/More_on_Idempotency_Multi_Tenancy.md).

---

# 3. Sessions vs Tokens

Two ways to remember that someone logged in.

### Server-side sessions (stateful)

```text
login → server stores { sessionId: 'x9f', userId: 7 } in a DB/Redis
      → sends cookie: sid=x9f
each request → server looks up 'x9f' → finds user 7
```

The cookie is a meaningless random id. The truth lives on the server.

### JWT (stateless)

```text
login → server SIGNS { sub: 7, exp: ... } → sends the token
each request → server checks the SIGNATURE → trusts the contents
```

No lookup. The token itself carries the facts, and the signature proves the server issued it.

| | Sessions | JWT |
|---|---|---|
| Lookup per request | yes | no |
| Revoke instantly | yes (delete the row) | no (valid until it expires) |
| Works across many services | needs a shared store | yes, each service verifies on its own |
| Size | tiny | hundreds of bytes on every request |

(Don't confuse "auth session" with DocMind's `sessionId`, which is a **conversation** id. Different thing, same word.)

---

# 4. What a JWT Is

Three Base64URL strings joined by dots:

```text
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 . eyJzdWIiOiI3IiwiZXhwIjoxNzYwMDAwMDAwfQ . 3q2-7wEXAMPLEsig
└────────────── header ─────────────┘   └───────────── payload ─────────────┘   └── signature ──┘
```

**Header**: which algorithm.

```json
{ "alg": "HS256", "typ": "JWT" }
```

**Payload**: the **claims**.

```json
{ "sub": "7", "role": "user", "iat": 1759990000, "exp": 1759990900 }
```

**Signature**:

```text
HMAC_SHA256( base64url(header) + "." + base64url(payload), SECRET )
```

Standard claim names:

| Claim | Meaning |
|---|---|
| `sub` | subject: the user id |
| `exp` | expiry (seconds since epoch) |
| `iat` | issued at |
| `nbf` | not valid before |
| `iss` | issuer (who made it) |
| `aud` | audience (who it's for) |
| `jti` | unique token id (for revocation lists) |

---

# 5. The Most Important Fact

> **A JWT is signed, not encrypted. Anyone can read it. Nobody can change it.**

Base64URL is an encoding, not a lock. Paste any JWT into a decoder and you see the payload.

So:

* **Never put secrets in a JWT.** No passwords, no API keys, nothing private.
* What the signature guarantees is **integrity**: if a user edits `"role":"user"` to `"role":"admin"`, the signature no longer matches and verification fails.

---

# 6. Why You Can Trust It Without a Database Lookup

```text
Only the server knows SECRET.
        ↓
Only the server can produce a valid signature for a given payload.
        ↓
If the signature checks out, the payload is exactly what the server wrote.
        ↓
So "sub: 7" really means user 7. No lookup needed.
```

Analogy: a wax seal on a letter. Anyone can read the letter. Only the king has the ring that makes the seal. If the seal is intact and matches, the letter is genuine and unaltered.

---

# 7. Verify vs Decode

This is the distinction the notes template calls out, and it's a real source of security bugs.

```ts
jwt.decode(token)            // just Base64-decodes. Checks NOTHING. Anyone can forge input for this.
jwt.verify(token, SECRET)    // recomputes the signature, checks exp/nbf, throws if anything is off
```

**Never make an authorization decision from `decode()`.**

What a correct verification includes:

1. The signature is valid for this key.
2. The **algorithm is the one you expect** (pin it: `{ algorithms: ['HS256'] }`).
3. `exp` is in the future.
4. `iss` / `aud` match, if you use them.

Why pin the algorithm: classic attacks set the header to `"alg": "none"` (no signature at all), or switch an RS256 token to HS256 and sign it with the public key as if it were a shared secret. Modern libraries defend against these, but being explicit costs nothing.

```ts
import jwt from 'jsonwebtoken'

const payload = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] })
```

---

# 8. HS256 vs RS256

```text
HS256   symmetric    ONE secret signs AND verifies
RS256   asymmetric   a PRIVATE key signs, a PUBLIC key verifies
```

* **HS256**: simple. Fine when the same server issues and verifies (a monolith like DocMind). The secret must be long and random; a short one can be brute-forced offline from any captured token.
* **RS256 / ES256**: the auth service keeps the private key; every other service only needs the public key. A service that can verify can't forge. This is how third-party providers work: they publish public keys at a **JWKS** URL and your backend fetches them.

---

# 9. Where the Token Lives in the Browser

| | `localStorage` | `httpOnly` cookie |
|---|---|---|
| JS can read it | yes | no |
| Stolen by XSS | **yes** | no |
| Sent automatically | no (you add a header) | yes |
| CSRF risk | no | **yes** (mitigate with `SameSite`, CSRF tokens) |
| Cross-origin setup | easy | needs `SameSite=None; Secure` + CORS `credentials` |

Neither is perfect. Common production choice: **short-lived access token** kept in memory, **refresh token** in an `httpOnly`, `Secure`, `SameSite` cookie.

The cross-origin row matters for DocMind specifically: the frontend (`docmind-jet.vercel.app`) and the API (`ai-backend-docmind.onrender.com`) are **different sites**. A cookie set by the API is a third-party cookie from the page's point of view, which browsers increasingly block. Either put both under one parent domain, proxy the API through the frontend's domain, or use header-based tokens.

---

# 10. Access Tokens and Refresh Tokens

The problem: a JWT can't be revoked. If it's valid for 30 days and gets stolen, the thief has 30 days.

The pattern:

```text
ACCESS TOKEN    short life (5–15 min)   sent on every request     stateless
REFRESH TOKEN   long life (days)        sent ONLY to /auth/refresh   stored server-side (hashed)
```

```text
login            → access (15 min) + refresh (7 days)
request          → Authorization: Bearer <access>
access expires   → 401
client           → POST /auth/refresh (with refresh token)
server           → checks the stored refresh token → new access (+ a new refresh)
logout           → delete the refresh token row
```

A stolen access token dies in minutes. The refresh token is checked against the database, so it **can** be revoked.

**Rotation**: each refresh issues a new refresh token and invalidates the old one. If an old one is ever presented again, someone has a stolen copy: revoke the whole family.

The honest tradeoff: with refresh tokens stored server-side, the system isn't purely stateless any more. That's fine. Stateless access checks + stateful refresh is the practical middle.

---

# 11. Passwords (Briefly, Since You Know This)

* **Hash, never encrypt, never store plain.** Use a slow password hash: `bcrypt`, `scrypt`, or `argon2`. Not SHA-256 (it's fast, which is what an attacker wants).
* Salting is built into those algorithms.
* Compare with the library's compare function (constant-time).
* Same error for "no such user" and "wrong password", so the login form can't be used to discover which emails exist.
* Rate-limit login attempts.

---

# 12. Where Verification Goes in the Request Lifecycle

**As early as possible. Before any expensive work.**

In Express that's middleware:

```ts
// src/middleware/requireAuth.ts
import jwt from 'jsonwebtoken'
import type { Request, Response, NextFunction } from 'express'

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Not signed in' })

  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET!, { algorithms: ['HS256'] })
    req.user = { id: String((payload as jwt.JwtPayload).sub) }
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}
```

(`req.user` needs a small TypeScript declaration that extends Express's `Request` type.)

Where it sits in DocMind's chat pipeline:

```text
request
   ↓
CORS → express.json()
   ↓
requireAuth           ← HERE. A bad token is rejected before anything costs money.
   ↓
rate limit (per user) ← needs the user id, so it comes after auth
   ↓
route handler
   ↓
prepareChat()         [1/7] validate → [2/7] embed (API call, costs quota) → [3/7] search → ...
```

If auth came after step 2, an anonymous caller could already burn an embedding call per request.

In GraphQL there's one endpoint, so verification happens while building the **context**, and resolvers call helpers like `requireUser(ctx)` / `requireAdmin(ctx)`. Same idea, different location. See [topic 14](../14-graphql-subscriptions/More_on_GraphQL.md).

---

# 13. 401 vs 403 (vs 404)

```text
401 Unauthorized   "I don't know who you are"        missing / invalid / expired token
403 Forbidden      "I know who you are. No."         valid token, not allowed
404 Not Found      "There's nothing here"            also used to HIDE that a resource exists
```

The naming is confusing: 401 is really "unauthenticated".

For "user asks for a document that belongs to someone else", **404 is often better than 403**. A 403 confirms the id exists. A 404 reveals nothing.

---

# 14. Authorization: Ownership

Authentication tells you the request is from user 7. Authorization is every query asking "…and does this belong to user 7?"

Wrong (IDOR):

```ts
// trusts whatever id the client sends
const chunks = await searchSimilar(embedding, 3, req.body.documentId)
```

Right:

```ts
// the user id comes from the VERIFIED token, never from the body
const chunks = await searchSimilar(embedding, 3, { userId: req.user.id, documentId })
```

Rules:

* **The user id comes from the token.** Never from the request body, query string, or a header the client controls.
* **Scope at the repository level**, so there's no query that can forget. Every repository function takes a `userId`.
* **Roles** (RBAC) are for broad permissions: `admin` can see usage stats. **Ownership** is for per-object access: this document is yours.

What DocMind would need:

```text
users(id, email, password_hash, created_at)
documents      + user_id
chunks         + user_id   (denormalized so vector search can filter without a join)
chat_messages  + user_id
```

and a `userId` parameter on every function in `repositories/`. The "All documents" mode becomes "all **my** documents"; today it literally means every document in the database.

That's multi-tenancy with tenant = user. Continued in [topic 16](../16-idempotency-multi-tenancy/More_on_Idempotency_Multi_Tenancy.md).

---

# 15. The Streaming Problem: `EventSource` Can't Send Headers

This is the part that's specific to DocMind and worth understanding well.

`/chat-stream` is consumed with the browser's native `EventSource`. Its constructor takes a URL and one option (`withCredentials`). **You cannot set an `Authorization` header.**

Options:

| Option | How | Tradeoff |
|---|---|---|
| **Cookie auth** | `new EventSource(url, { withCredentials: true })` + CORS `credentials: true` with an explicit origin | Clean, but cross-site cookies are fragile (see §9) |
| **Token in the query string** | `?token=...` | Works anywhere. But URLs get written to server logs, proxy logs, and browser history. Only acceptable with a **short-lived, single-use ticket** |
| **Ticket exchange** | `POST /chat-stream/ticket` (authenticated with the normal header) returns a 30-second one-time ticket; then `EventSource('/chat-stream?ticket=...')` | Safe version of the above; one extra request |
| **`fetch` streaming instead of `EventSource`** | `fetch(url, { headers: { Authorization } })` then read `response.body.getReader()` | Full control over headers and method; you parse SSE frames yourself and lose auto-reconnect |

The fourth option is what most production LLM frontends do. It also lets the route become a `POST` with a JSON body, which removes the reason `/chat-stream` is a GET in the first place. You already wrote this exact parsing once on the server side: `streamAnswer()` reads Gemini's stream with `getReader()` + `TextDecoder` and splits on blank lines. The client version is the same code.

A related point: the message currently travels in the **query string** of a GET. That means user questions can land in access logs. Moving to POST fixes that too.

---

# 16. Token Expiry During a Stream

Verify **once, when the stream opens**. A token that expires 30 seconds into a 60-second answer shouldn't cut the answer off; the request was authorized when it started.

If the token is already expired when the client tries to open the stream, `EventSource` can't read a 401 body (the same limitation that forced the `event: error` frames). With fetch-based streaming you can read the 401 normally, refresh, and retry.

---

# 17. Don't Build Auth Yourself (in Production)

Building login once is a great way to understand it. For a real product, use something maintained:

| Kind | Examples |
|---|---|
| Hosted auth | Clerk, Auth0, Supabase Auth, Firebase Auth, AWS Cognito |
| Libraries you host | Auth.js, Better Auth, Lucia-style patterns, Passport |

They handle password reset, email verification, OAuth ("Sign in with Google"), MFA, brute-force protection, and token rotation: the long list of things that are easy to get subtly wrong.

Your backend's job with a hosted provider is still the same middleware: **verify** the JWT (using the provider's public keys from its JWKS URL) and read `sub`.

**OAuth 2.0 / OpenID Connect** in one line each:

* OAuth 2.0: a protocol for delegated **authorization** ("let this app access my Google Drive").
* OIDC: a layer on top that adds **authentication** and an **ID token** (a JWT that says who the user is).

---

# 18. API Keys vs User Tokens

Two different credentials that are easy to blur:

```text
GEMINI_API_KEY      identifies YOUR SERVER to Google.   Lives only on the backend.
user JWT            identifies A USER to your server.   Lives in their browser.
```

The user never sees the Gemini key. Your server is a gatekeeper standing between users and a paid API, and auth is how it decides who gets through and how often.

If you offered DocMind as an API for other developers, you'd issue your own API keys: random strings, stored **hashed**, shown once, revocable, each tied to a user and a rate limit.

---

# 19. Per-User Limits (Why Auth Unlocks Cost Control)

Once there's a `req.user.id`:

```text
rate limit key = userId            (not IP: shared networks, and IPs are easy to change)
daily quota    = N messages / M uploads per user
usage log      = tokens_in / tokens_out per user     → who costs what
```

Without identity, the only handle is the IP address, which is a weak one. See [advanced/05](../advanced/05-rate-limiting-retries/More_on_Rate_Limiting_Retries.md) and [advanced/03](../advanced/03-token-counting-cost/More_on_Tokens_Cost.md).

---

# 20. Common JWT Mistakes

* Using `decode` where `verify` was needed.
* Not checking expiry (some manual implementations skip it).
* A short or guessable secret; a secret committed to git.
* Long-lived access tokens with no refresh/revocation story.
* Secrets or personal data in the payload.
* Token in `localStorage` on a site with an XSS hole.
* Token in a URL.
* Trusting `userId` from the request body alongside a valid token.
* Not pinning the algorithm.
* Checking auth in the frontend only. Hiding a button isn't security; the API must enforce it.
* Logging the `Authorization` header.
* Clock differences between servers causing "expired" errors: allow a few seconds of tolerance.

---

# 21. Testing Auth

Easy to test, and worth it:

```text
no header                      → 401
malformed header               → 401
bad signature                  → 401
expired token                  → 401
valid token                    → next() called, req.user.id set
valid token, someone else's document → 404
valid token → /chat calls prepareChat with THIS user's id
```

Sign test tokens in the test with a test secret. Use `vi.useFakeTimers()` to test expiry without waiting.

---

# 22. Adding It to DocMind (The Optional Side Exercise)

A sensible minimal order:

1. `users` table + `POST /auth/register`, `POST /auth/login` (bcrypt + a signed JWT).
2. `requireAuth` middleware; apply it to every router except health and auth.
3. `user_id` columns + a `userId` parameter through `repositories/`.
4. Frontend: login screen, store the token, send it on every `fetch` (one place: `api/client.ts`).
5. Solve streaming (§15): switch `streamChatMessage` to fetch-based streaming.
6. Decide what happens to existing rows that have no owner (the current documents, and the orphan chunks).

Step 5 is the one that makes this more than a copy of what you've done in other projects.

Add `JWT_SECRET` to the Render environment, generated with something like `openssl rand -base64 48`. Never commit it. `.history/` already leaked a secret once.

---

# 23. Interview-Level Summary

If asked **"What's inside a JWT?"**:

> Three Base64URL parts: a header with the algorithm, a payload of claims like the user id and expiry, and a signature over the first two made with a secret or private key. It's signed, not encrypted: anyone can read it, but any change breaks the signature.

If asked **"Why can you trust it without a database lookup?"**:

> Only the server holds the signing key, so only the server could have produced a signature that matches the payload. If it verifies and hasn't expired, the claims are what the server issued.

If asked **"Verify vs decode?"**:

> Decode just Base64-decodes the payload and proves nothing. Verify recomputes the signature with the key and checks expiry. Authorization decisions must only ever use a verified token, with the algorithm pinned.

If asked **"Authentication vs authorization?"**:

> Authentication is who you are, and failing it is a 401. Authorization is what you're allowed to do, and failing it is a 403, or a 404 if I don't want to reveal the resource exists. A valid token only answers the first question; every query still has to be scoped to that user.

If asked **"How do you handle logout or a stolen token?"**:

> JWTs can't be revoked directly, so access tokens are short-lived and paired with a refresh token that's stored server-side and can be deleted. Rotating refresh tokens also lets me detect reuse.

If asked **"Where does auth go in an AI backend's request path?"**:

> First, before anything that costs money. In my chat pipeline that means before the embedding call. Then per-user rate limiting, then the pipeline, with the verified user id passed down so retrieval only searches that user's chunks.

If asked **"How do you authenticate a streaming endpoint?"**:

> The browser's `EventSource` can't set headers, so the choices are cookie auth, a short-lived one-time ticket in the URL, or dropping `EventSource` for fetch-based streaming, which allows an Authorization header and a POST body. I'd use fetch streaming. The token is verified once when the stream opens.

---

# 24. Final Mental Model

```text
        LOGIN
          │  email + password
          ▼
   verify password (bcrypt)
          │
          ▼
   SIGN  { sub: userId, exp }  with SECRET
          │
          ▼
   client keeps the token
          │
══════════╪═══════════════════════════════════════════
          │  every request: Authorization: Bearer <token>
          ▼
   ┌─────────────┐   bad / missing / expired
   │  VERIFY     │ ─────────────────────────► 401
   │  signature  │
   │  + expiry   │
   └─────────────┘
          │ req.user.id   (from the token, never from the body)
          ▼
   rate limit per user ─────────────────────► 429
          │
          ▼
   route → service → REPOSITORY (… WHERE user_id = req.user.id)
          │                              │
          │                     not theirs → 404
          ▼
   embed → search (their chunks only) → prompt → LLM → answer
```

**Authentication = who (401). Authorization = what (403/404).**

**JWT = signed, not encrypted. Readable by all, changeable by none.**

**`verify`, never `decode`. Pin the algorithm.**

**Short access token + revocable refresh token.**

**Verify first, before the request costs anything.**

**The user id comes from the token and scopes every query, especially vector search.**

**`EventSource` can't send headers: use fetch streaming or a one-time ticket.**
