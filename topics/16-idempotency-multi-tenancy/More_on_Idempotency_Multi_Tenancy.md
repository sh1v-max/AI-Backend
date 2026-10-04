# 16 — Idempotency & Multi-Tenancy

**Roadmap: Phase 11 (Step 11.3)** · **Status in DocMind: multi-tenancy (per-user scoping) built on 2026-10-04 as part of auth; idempotency not built.** When this file was written DocMind was single-user with no duplicate protection, and the sections below still read that way. The per-user version: every repository query filters on `user_id`, vector search filters through the `documents` join, and session history is user-scoped. See [auth-jwt-plan.md](../../auth-jwt-plan.md). This is a reading topic: two production concerns that look unrelated but share a root. Both are about a backend **not trusting the client to behave**: not to send things twice, and not to ask only for its own data.

Code this file talks about: [chat.service.ts](../../src/services/chat.service.ts) (`prepareChat`), [documents.routes.ts](../../src/routes/documents.routes.ts) (`POST /upload`), [chunks.repository.ts](../../src/repositories/chunks.repository.ts) (`searchSimilar`), [schema.ts](../../src/db/schema.ts), [config.ts](../../src/config.ts) (`ALL_DOCUMENTS`)

---

# PART A — IDEMPOTENCY

---

# 1. What Does Idempotent Mean?

> **An operation is idempotent if doing it twice has the same effect as doing it once.**

```text
x = 5          idempotent      do it 10 times, x is 5
x = x + 1      NOT idempotent  do it 10 times, x went up by 10
```

Analogy: an elevator call button. Press it once or twenty times, one elevator comes. A vending machine button isn't like that: twenty presses, twenty cans.

You want your API's important buttons to behave like the elevator.

---

# 2. HTTP Methods and Idempotency

| Method | Idempotent by definition? | Why |
|---|---|---|
| `GET` | yes | reads only |
| `PUT` | yes | "set it to this" |
| `DELETE` | yes | deleting a deleted thing leaves it deleted |
| `POST` | **no** | "create a new one" each time |
| `PATCH` | not necessarily | depends on the change |

In DocMind:

* `DELETE /documents/:id` twice → same end state. Idempotent already.
* `POST /upload` twice → two documents, double the chunks, double the embedding calls.
* `POST /chat` twice → two user messages saved, two LLM calls, two answers.

(**Safe** is a different word: a safe method changes nothing at all. `GET` is safe and idempotent; `DELETE` is idempotent but not safe.)

---

# 3. Why Would a Request Arrive Twice?

Nobody intends it. It happens constantly:

* **Double-click** on Send or Upload.
* **Client retry after a timeout.** The request *succeeded* on the server, but the response got lost on a flaky network. The client can't tell "never arrived" from "arrived, reply lost", so it retries.
* **Mobile networks** dropping mid-request.
* **Automatic retries** in libraries, proxies, and load balancers.
* **`EventSource` auto-reconnect.** If the stream drops, the browser reopens the same URL by itself.
* **Queue redelivery.** At-least-once delivery means a job can run twice (topic 09).
* **Webhooks.** Providers resend until they get a 2xx.
* **The user refreshes** a page that re-submits.

The key insight:

> **From the client's side, "the request failed" and "the response was lost" look identical.** The only safe client behaviour is to retry. So the server must make retries harmless.

---

# 4. Why It Matters Extra for LLM Backends

A duplicate isn't only messy data. It's:

* **Money / quota.** Each duplicate `/chat` is an embedding call plus a generation call.
* **Slow.** The duplicate takes seconds, not milliseconds.
* **Non-deterministic.** Two runs of the same question give two *different* answers. Which one is "the" reply?
* **Corrupts history.** Two identical user turns in a row get replayed into every later prompt.

That last one is real in DocMind today. `prepareChat()` saves the user message **before** generating. If the request then fails and the user retries, history has the question twice. (A related note already in the project log: `/chat-stream`'s tolerated failed-save can leave two user turns in a row.)

---

# 5. The Idempotency-Key Pattern

The client generates a unique id for each **logical action** and sends it with the request. A retry of the same action sends the **same** id.

```http
POST /chat
Idempotency-Key: 7c9e6679-7425-40de-944b-e07fc1f90ae7
```

The server:

```text
request arrives with key K
        │
        ▼
   seen K before?
     │         │
    no        yes
     │         │
     ▼         ├─ finished?     → return the SAVED response. Do no work.
 record K      └─ still running? → 409 Conflict (or wait for it)
 (in progress)
     │
     ▼
 do the work
     │
     ▼
 save the response under K
     │
     ▼
 respond
```

Either the key is in a header (`Idempotency-Key`, a widely used convention) or in the body (a `messageId`, as the production backend in the notes template does). Same idea.

---

# 6. The Race Condition, and the Fix

Naive version:

```ts
const existing = await findKey(key)     // request A: not found
                                        // request B: not found   ← both get here
if (!existing) await doTheWork()        // both do the work
```

Check-then-act isn't atomic. Two requests can both pass the check.

**The fix: let the database decide, with a unique constraint.**

```sql
CREATE TABLE idempotency_keys (
  key         text PRIMARY KEY,
  user_id     text NOT NULL,
  status      text NOT NULL,          -- 'in_progress' | 'completed'
  response    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

```sql
INSERT INTO idempotency_keys (key, user_id, status)
VALUES ($1, $2, 'in_progress')
ON CONFLICT (key) DO NOTHING
RETURNING key;
```

* A row came back → you're first. Do the work.
* Nothing came back → someone else already claimed it. Look up its status.

The insert is atomic. Only one request can win. **"Insert first, and let the unique constraint tell you if you were first"** is the core trick, and it shows up everywhere (it's the same move as claiming a suspended workflow run in topic 11).

Redis version: `SET key value NX EX 86400` (set only if not exists, with an expiry).

---

# 7. Where the Check Goes

> **As early as possible. Before the first side effect.**

In DocMind's chat pipeline:

```text
auth
  ↓
IDEMPOTENCY CHECK     ← here
  ↓
[2/7] embed question      (costs quota)
[3/7] search
[4/7] load history
      save user message   ← FIRST SIDE EFFECT
[5/7] build prompt
[6/7] generate            (costs quota)
[7/7] save assistant reply
```

After auth (so you know whose key it is), before anything that costs money or writes data.

---

# 8. The Simplest Version for Chat: A Client Message Id

You don't always need a separate table. The thing being created can carry the key itself:

```sql
ALTER TABLE chat_messages ADD COLUMN client_message_id text;
CREATE UNIQUE INDEX chat_messages_client_id ON chat_messages (session_id, client_message_id);
```

```text
frontend:  generates a UUID when the user presses Send (crypto.randomUUID())
           sends it with the message; a retry re-sends the SAME id
backend:   INSERT the user message … ON CONFLICT DO NOTHING
           inserted → continue the pipeline
           conflict → this is a duplicate: don't embed, don't generate.
                      Return the reply already saved for it (or 409 if it's still generating)
```

To return the saved reply, the assistant message needs a link to the user message it answers (a `reply_to` column, or the same `client_message_id` on both rows).

This is "reject duplicate `messageId`s before processing", as described in the notes template.

---

# 9. Idempotency and Streaming

A duplicate of a streamed request has three possible states:

| State of the first request | What to do with the duplicate |
|---|---|
| Finished, reply saved | Send the saved reply (as one `data:` frame, then `done`) |
| Still streaming | `409`-style error frame, or attach to the running stream (hard) |
| Failed halfway | Treat as a fresh attempt: clear the partial state, run again |

There's also a mechanism built into SSE for this: each event can carry an `id:`, and on reconnect the browser sends `Last-Event-ID`. A server that buffers events can resume from that point. That's **resumable streams**. Worth knowing it exists; it's considerably more machinery than a chat demo needs.

The cheap, sufficient defense in DocMind: the frontend closes the `EventSource` on `done` and on error, so the browser doesn't auto-reconnect and re-ask the question.

---

# 10. Idempotent Uploads

`POST /upload` is the expensive one. A double-click means parsing and embedding the same PDF twice.

Options:

* **Idempotency key** per upload, as above.
* **Content hash.** Compute SHA-256 of the file bytes; a unique index on `(user_id, content_hash)`. Uploading the same file again returns the existing document. This is *deduplication*: it catches duplicates even across days and different requests.
* **`jobId` in BullMQ** (once Phase 6 exists): `queue.add('ingest', data, { jobId: documentId })`. Adding a job with an id that already exists is ignored.

They answer slightly different questions. A key says "this is the same *request*". A hash says "this is the same *content*".

---

# 11. Naturally Idempotent Operations

The best idempotency is the kind you get for free by designing the operation well.

| Instead of | Prefer |
|---|---|
| "insert a row" | "upsert by a unique key" (`ON CONFLICT DO UPDATE`) |
| "add 10 to balance" | "set balance to 110" or "apply transaction #abc once" |
| "append chunks" | "delete this document's chunks, then insert" |
| "status = next status" | "set status to `ready` where status = `processing`" |

That third row is exactly the idempotent ingestion job from [topic 09](../09-background-jobs-bullmq/More_on_Background_Jobs.md): a retry wipes the partial attempt first, so running twice equals running once.

---

# 12. Details That Matter in Real Implementations

* **Scope the key to the user.** `(user_id, key)`, so one user can't collide with or probe another's keys.
* **Expire keys.** Keep them 24 hours or so, then delete. They're for retries, not forever.
* **Same key, different body?** That's a client bug. Store a hash of the request and return `422` if a reused key comes with different content.
* **Don't cache failures blindly.** A `500` shouldn't be replayed forever. Usually only successful responses (and deliberate 4xx) are stored; a failed attempt releases the key so a retry can run.
* **A crashed "in progress".** If the server dies mid-work, the key is stuck. Give `in_progress` a timeout.
* **Idempotency makes retries safe.** That's why this topic and [advanced/05](../advanced/05-rate-limiting-retries/More_on_Rate_Limiting_Retries.md) belong together: you can only retry what's safe to repeat.

---

# 13. Exactly-Once Doesn't Exist

Networks give you two real choices:

```text
at-most-once    send once, never retry    → may be lost
at-least-once   retry until acknowledged  → may be duplicated
```

"Exactly once" is what you *build* on top:

> **at-least-once delivery + idempotent processing = effectively exactly-once**

That sentence is worth memorising. It's the answer to a lot of distributed-systems interview questions.

---

# PART B — MULTI-TENANCY

---

# 14. What is a Tenant?

A **tenant** is a customer of a shared system: a school, a company, an organisation, or a single user.

**Multi-tenancy** = many tenants using one deployment (one codebase, usually one database), each seeing only its own data.

Analogy: an apartment building.

```text
one building, one water supply, one lift       → shared infrastructure
your flat, your key, your stuff                → isolated data
```

Nobody should be able to walk into flat 302 by typing "302" into the lift.

DocMind today is a building with no doors. There are no users; every visitor sees every document and every conversation.

---

# 15. Three Isolation Models

| Model | How | Isolation | Cost / effort |
|---|---|---|---|
| **Shared tables** | one DB, one schema, a `tenant_id` column on every row | weakest: depends on every query being right | cheapest, scales to many tenants |
| **Schema per tenant** | one DB, a separate Postgres schema each | medium | migrations run once per tenant |
| **Database per tenant** | separate database each | strongest | most expensive; fine for a few large customers |

Most SaaS products use the first, sometimes offering the third to big customers. Everything below is about making the first one safe.

---

# 16. Row-Level Scoping

Every table gets a tenant column, and every query filters on it.

```sql
ALTER TABLE documents     ADD COLUMN user_id text NOT NULL;
ALTER TABLE chunks        ADD COLUMN user_id text NOT NULL;
ALTER TABLE chat_messages ADD COLUMN user_id text NOT NULL;
```

```sql
SELECT * FROM documents WHERE user_id = $1;
```

Two rules:

**1. The tenant id comes from the verified token. Never from the client.**

```ts
listDocuments(req.user.id)          // ✓ from the JWT
listDocuments(req.body.userId)      // ✗ the client can type anyone's id
```

**2. Make it impossible to forget.** Every repository function takes the tenant id as a required argument:

```ts
searchSimilar(userId, embedding, limit, documentId?)
listSessions(userId)
deleteDocument(userId, documentId)
```

DocMind's rule that **nothing outside `repositories/` touches SQL** is what makes this tractable: there are three repository files to change, and no SQL hiding in routes.

A `DELETE` or `UPDATE` must be scoped too: `DELETE FROM documents WHERE id = $1 AND user_id = $2`. Otherwise a valid user can delete another user's document by guessing its id.

---

# 17. Row-Level Security (RLS): Defense in Depth

Application-level `WHERE` clauses fail the day someone forgets one. Postgres can enforce the rule itself:

```sql
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY chunks_isolation ON chunks
  USING (user_id = current_setting('app.user_id'));
```

Per request, inside a transaction:

```sql
SET LOCAL app.user_id = 'user-7';
SELECT * FROM chunks;        -- only user-7's rows come back, even with no WHERE clause
```

Things to know:

* It's a **safety net**, in addition to application scoping, not instead of it.
* The setting must be per transaction (`SET LOCAL`). With a connection pool, a session-level setting would leak to the next request that reuses the connection.
* Table owners and superusers bypass RLS unless you force it. The app should connect as a restricted role.
* Supabase's whole security model is built on RLS, so it's worth understanding.

---

# 18. The AI-Specific Part: Scoped Vector Search

This is the reason the topic is in an AI-backend roadmap.

A normal data leak looks like an error or an obviously wrong record. A RAG leak looks like **a helpful answer**:

```text
User A asks: "What salary did we agree on?"
        ↓
vector search with NO tenant filter
        ↓
closest chunks include User B's offer letter
        ↓
they're pasted into the prompt as "context"
        ↓
the model answers fluently, using User B's numbers
```

No error. No "access denied". Nobody notices until someone reads something they shouldn't have.

> **Retrieval is an access-control boundary.** Whatever the search can return, the user can effectively read.

So the filter must be **inside the SQL**, before the model sees anything:

```sql
SELECT content, embedding <=> $1 AS distance
FROM chunks
WHERE user_id = $2                 -- the tenant filter
  AND document_id = $3             -- optional narrower scope
ORDER BY embedding <=> $1
LIMIT 3;
```

**Never** try to enforce it in the prompt ("only use documents belonging to this user"). The model isn't a security boundary. If the text is in the prompt, it has already leaked.

DocMind's all-documents mode makes this concrete. `searchSimilar(embedding, 3)` with no `documentId` searches **every chunk in the database**. That's correct for one user and a leak for two. With tenants it becomes "all of *my* documents": the same query with `WHERE user_id = $2`.

There's already a small preview of the problem in the database: the orphan chunks (some are resume text from early test uploads) used to be reachable by all-mode search until `documents.id IS NOT NULL` was added. Data nobody could see in the UI was still retrievable by the model.

---

# 19. Filtered Vector Search and Indexes

A performance trap that appears once there's an approximate index (HNSW/IVFFlat) on `chunks.embedding`:

```text
index returns the 40 globally nearest chunks
        ↓
then WHERE user_id = 'A' is applied
        ↓
maybe 0 of those 40 belong to user A  → empty or poor results
```

This is **post-filtering**: the index doesn't know about the filter.

Mitigations:

* **Exact search within a small tenant.** If a tenant has a few thousand chunks, a B-tree index on `user_id` + exact distance over just their rows is fast and perfectly accurate. For many apps this is the right answer.
* **pgvector iterative index scans** (newer versions) keep scanning until enough filtered rows are found.
* **Partial indexes or partitioning** per tenant for large tenants.
* Raise the index's search breadth (`hnsw.ef_search`).
* Dedicated vector databases have **namespaces** / metadata filtering for exactly this.

Background on indexes: [topics/02 INDEXING-AT-SCALE.md](../02-vector-search-pgvector/INDEXING-AT-SCALE.md).

DocMind has no vector index today (exact search), so this doesn't bite yet.

---

# 20. Everything Else That Must Be Tenant-Scoped

Data rows are the obvious part. The rest:

| Thing | How it leaks if unscoped |
|---|---|
| **Conversation history** | `getRecentMessages(sessionId)` trusts the session id. A guessed id reads someone's chat, and replays it into a prompt |
| **Caches** | a response cache keyed by question only → user B gets user A's cached answer. Keys must include the tenant |
| **Uploaded files** | storage paths like `/uploads/<docId>.pdf` with guessable ids |
| **Background jobs** | job data must carry the tenant id; the worker scopes its queries too |
| **Logs and traces** | prompts contain document text. Who can read the logs? |
| **Rate limits and quotas** | per tenant, so one tenant can't exhaust everyone's quota (the **noisy neighbour** problem) |
| **Tool calls** | a tool's `documentId` / `userId` must come from the server, never from the model (topic 10) |
| **Fine-tuning / shared prompts** | never train or few-shot on one tenant's data for another |

The pattern: **anything that stores or moves user content needs a tenant on it.**

---

# 21. Users Inside Tenants

When a tenant is an organisation, there are two levels:

```text
tenant (school)
   └── users (teachers, admins)
         └── documents
```

```text
tenant scoping   which school's data          → tenant_id on every row
authorization    what this user may do in it  → roles (admin / member), ownership
```

A JWT then carries both: `{ sub: userId, tenantId, role }`. The production backend in the notes template scoped by `schoolId` this way.

For DocMind, tenant = user is enough.

---

# 22. Testing Tenant Isolation

Isolation is a property you should test on purpose, because it never fails loudly.

```text
create user A and user B
A uploads a document with a distinctive sentence
B lists documents            → doesn't see A's
B fetches A's document by id → 404
B deletes A's document by id → 404, and it still exists
B chats in all-documents mode about A's distinctive sentence → no source from A's document
B requests A's sessionId     → 404
```

The fourth-from-last is the important one. Assert on the **retrieved sources**, not on the model's wording.

---

# 23. What It Would Take in DocMind

```text
1. users table + auth                                    (topic 15)
2. user_id on documents, chunks, chat_messages
3. userId as a required parameter on every repository function
4. prepareChat / generateQuiz / ingestPdf receive userId from the route
5. 'all' mode → WHERE user_id = …
6. session lookups verify the session belongs to the user
7. decide what to do with existing ownerless rows (and finally delete the orphan chunks)
8. isolation tests
```

Because services never touch `req`/`res`, the user id is just one more field in the input object they already take: `prepareChat({ userId, documentId, message, sessionId }, t0)`.

---

# 24. How the Two Halves Connect

They look unrelated. They rhyme:

```text
idempotency     "don't trust the client to send it only once"
multi-tenancy   "don't trust the client to ask only for its own data"
```

And they meet in practice: idempotency keys are scoped per tenant, queue jobs carry both a tenant id and a dedupe id, and both rely on the database (a unique constraint; a mandatory filter) rather than on good behaviour.

---

# 25. Interview-Level Summary

If asked **"What is idempotency?"**:

> An operation is idempotent if repeating it has the same effect as doing it once. It matters because clients retry: a request can succeed while its response is lost, and the client can't tell the difference, so the server has to make repeats harmless.

If asked **"How do you implement it?"**:

> The client generates a unique key per logical action and sends it on every attempt. The server inserts that key into a table with a unique constraint before doing any work. If the insert succeeds, it's the first time, so it does the work and stores the response. If it conflicts, it's a duplicate, and I return the stored response instead of working again. The check goes as early as possible, before any side effect.

If asked **"Why a unique constraint and not a lookup?"**:

> A lookup followed by an insert is a race: two concurrent requests can both see "not found". A unique-constrained insert is atomic, so only one can win.

If asked **"Why does it matter for an LLM backend in particular?"**:

> Duplicates cost real money and time, the two runs give different answers, and a duplicated user message pollutes the conversation history that's replayed into later prompts.

If asked **"Is exactly-once delivery possible?"**:

> Not at the network level. You get at-least-once delivery, and you make the processing idempotent, which gives you exactly-once effects.

If asked **"What is multi-tenancy?"**:

> Many customers sharing one deployment and usually one database, each isolated from the others. The common approach is a tenant id column on every table with every query filtered by it, with the tenant id taken from the verified token, never from the request. Row-level security in Postgres can enforce it as a second layer.

If asked **"What's special about multi-tenancy in a RAG system?"**:

> Vector search is an access-control boundary. If the similarity search isn't filtered by tenant, another tenant's chunks can be retrieved as context and the model will answer from them. It doesn't look like an error; it looks like a good answer. So the tenant filter has to be in the search query itself, not in the prompt. Caches, conversation history, and tool arguments need the same scoping.

If asked **"What's the catch with filtered vector search?"**:

> With an approximate index, the filter may be applied after the index returns its nearest neighbours, so a tenant with few rows can get too few results. Options are exact search within the tenant, iterative scans, or per-tenant partitions.

---

# 26. Things to Remember

* `POST` isn't idempotent unless you make it so.
* "Failed" and "response lost" look the same to a client.
* Check-then-insert is a race. Insert-and-catch-the-conflict isn't.
* Save the user message idempotently, or history gets duplicates.
* The tenant id comes from the token.
* A prompt instruction is not an access control.
* Unscoped vector search leaks silently.
* Cache keys, jobs, logs, and tool arguments need the tenant too.
* Test isolation with two users, asserting on retrieved sources.

---

# 27. Final Mental Model

```text
                      REQUEST
                         │
                         ▼
                 verify token ───────────────► 401
                         │  userId (tenant)
                         ▼
        ┌────────────────────────────────┐
        │ IDEMPOTENCY                    │
        │ INSERT (userId, key) UNIQUE    │
        │   conflict → return saved      │──► same response, no work, no cost
        │   inserted → continue          │
        └────────────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────┐
        │ TENANT SCOPE on every query    │
        │   documents  WHERE user_id = ? │
        │   history    WHERE user_id = ? │
        │   VECTOR SEARCH WHERE user_id=?│ ◄── the one that leaks silently
        └────────────────────────────────┘
                         │
                         ▼
               prompt (only their text)
                         │
                         ▼
                        LLM
                         │
                         ▼
          save response under the key → reply
```

**Idempotent = twice equals once.**

**Clients must retry; servers must make retries harmless.**

**Unique constraint first, work second.**

**At-least-once + idempotent = effectively exactly-once.**

**Tenant id from the token, on every query, enforced in the repository.**

**In RAG, what retrieval can reach, the user can read. Filter in SQL, never in the prompt.**
