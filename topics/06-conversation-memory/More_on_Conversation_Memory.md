# 06 — Conversation Memory

**Roadmap: Phase 2 (Steps 2.4 and 2.5)** · **Status in DocMind: built.** A `chat_messages` table, `HISTORY_LIMIT = 8`, history replayed into every prompt, a derived session list, and refresh-safe sessions through `localStorage`.

Code this file talks about: [chatMessages.repository.ts](../../src/repositories/chatMessages.repository.ts), [chat.service.ts](../../src/services/chat.service.ts) (`prepareChat`, `buildChatPrompt`), [chat.routes.ts](../../src/routes/chat.routes.ts), [sessions.routes.ts](../../src/routes/sessions.routes.ts), [schema.ts](../../src/db/schema.ts), [config.ts](../../src/config.ts) (`HISTORY_LIMIT`), [useChat.ts](../../frontend/src/hooks/useChat.ts)

---

# 1. The Problem

Ask this:

```text
"What are the three stages of a RAG pipeline?"
```

You get a good answer. Then ask:

```text
"Tell me more about the first one."
```

On its own, that second message means nothing. First *what*?

A human would understand because they remember the previous exchange. The model doesn't.

---

# 2. LLM Calls Are Stateless

Every call to the model is a brand-new, isolated request.

```text
call 1:  "What are the three stages?"   → answer    → forgotten
call 2:  "Tell me more about the first" → ???        (it has never seen call 1)
```

There's no hidden session on the provider's side linking your calls. The model's weights don't change when you talk to it. Nothing about you is stored between requests.

> **The model has no memory. It only has what's in the current request.**

So where does "the chatbot remembers" come from?

---

# 3. Memory Is an Illusion You Build

The application stores the conversation and **sends it again** with every new message.

```text
call 2 actually contains:

   user: What are the three stages of a RAG pipeline?
   assistant: Ingestion, retrieval, and generation...
   user: Tell me more about the first one.
```

Now "the first one" is answerable, because the earlier exchange is right there in the text.

Every chat product works this way. The "memory" lives in your database and your prompt, never in the model.

> **Memory = store the messages + replay them.**

---

# 4. Simple Analogy

Imagine a brilliant expert with no ability to form new memories. Every time you walk in, they've never met you.

So you carry a **notebook**. Before each question, you hand it over:

> "Here's everything we said so far. Now, my next question is…"

They read the notebook, answer perfectly in context, and forget again the moment you leave.

* The expert = the model
* The notebook = the `chat_messages` table
* Handing it over = building the prompt with history
* Writing the new exchange into it = `insertMessage()`

Two consequences follow straight from the analogy:

* The longer the notebook, the longer they take to read it, and the more you pay for their time. (Token cost.)
* At some point the notebook is too thick to read in one sitting. (Context window.)

---

# 5. What "Giving It Memory" Means, Concretely

Four things:

```text
1. STORE     every message, user and assistant, in a table
2. LOAD      the recent ones for THIS conversation on each request
3. REPLAY    them inside the prompt, before the new question
4. SAVE      the new exchange, so the next request has it
```

That's the entire feature. One table, two repository functions, and a change to the prompt.

---

# 6. The Table

```ts
export const chatMessages = pgTable('chat_messages', {
  id: serial('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  documentId: text('document_id').notNull(),
  role: text('role').notNull(),            // 'user' | 'assistant'
  content: text('content').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
```

One row per message. Both sides of the conversation.

| Column | Why |
|---|---|
| `session_id` | which conversation this message belongs to |
| `document_id` | what the conversation is about (a document id, or `'all'`) |
| `role` | who said it |
| `content` | what was said |
| `created_at` | to put them back in order |

---

# 7. `sessionId` vs `documentId`

They answer different questions:

```text
documentId   WHAT is being discussed
sessionId    WHICH conversation thread this is
```

One document can have many sessions:

```text
resume.pdf
   ├── session A   (Monday, asked about projects)
   ├── session B   (Tuesday, asked about education)
   └── session C   (another tab, started fresh)
```

Without `sessionId`, all three would blur into one stream, and Tuesday's "the first one" could resolve against Monday's answer.

Don't confuse this with an **auth session** (a logged-in user). DocMind's `sessionId` is a conversation id. Same word, different thing.

---

# 8. There Is No `sessions` Table

A design choice worth being able to explain.

A session isn't stored anywhere as its own row. It's just **every `chat_messages` row that shares a `session_id`**.

```text
session = SELECT * FROM chat_messages WHERE session_id = 'abc'
```

The sidebar list is **derived**: `listSessions()` reads the messages, groups them by `session_id`, and reduces each group to a summary:

```ts
{ sessionId, documentId, filename, title, lastMessage, lastMessageAt, messageCount }
```

* `title` = the first user message (the same trick ChatGPT uses)
* `lastMessage` / `lastMessageAt` = the newest row in the group
* `messageCount` = how many rows

**Why it's nice:** one table, no "session exists but has no messages" state, nothing to keep in sync, deleting a conversation is one `DELETE`.

**What it costs:**

* `listSessions()` loads **every message of every conversation** and groups in JavaScript. Fine for one person; wasteful at thousands of chats. The SQL version is a `GROUP BY session_id` with aggregates, or a real `sessions` table.
* There's nowhere to put per-session data: a renamed title, a pinned flag, a rolling summary (§17), an owner.

The day you need any of those, a `sessions` table earns its place.

---

# 9. The "Last N" Trick

You want the **last 8 messages, oldest first**.

The obvious query is wrong:

```sql
ORDER BY created_at ASC LIMIT 8     -- gives the FIRST 8 messages of the whole conversation
```

`LIMIT` cuts from the top of whatever order you asked for. So:

```ts
const rows = await db
  .select({ role: chatMessages.role, content: chatMessages.content })
  .from(chatMessages)
  .where(eq(chatMessages.sessionId, sessionId))
  .orderBy(desc(chatMessages.createdAt))   // newest first
  .limit(limit)                            // take the newest 8

return rows.reverse()                      // flip back to chronological
```

**Sort newest-first → limit → reverse.**

```text
all messages:     1 2 3 4 5 6 7 8 9 10 11 12
DESC + LIMIT 8:   12 11 10 9 8 7 6 5
reverse:          5 6 7 8 9 10 11 12      ← what the prompt needs
```

The order matters: a prompt must read like a real conversation, oldest to newest.

One detail: the sort is on `created_at` alone. Two rows with the same timestamp would have no guaranteed order. It hasn't been a problem (a user message and its reply are seconds apart), but adding `id` as a tiebreaker (`ORDER BY created_at DESC, id DESC`) makes it deterministic for free.

---

# 10. The Pipeline, With Memory

`prepareChat()` (steps 1–5) plus the route (steps 6–7):

```text
[1/7] validate the request
[2/7] embed the question
[3/7] search the top 3 chunks
[4/7] LOAD history          getRecentMessages(sessionId, 8)
      SAVE the user message insertMessage(..., 'user', message)
[5/7] build the prompt      buildChatPrompt(context, history, message)
[6/7] generate
[7/7] SAVE the reply        insertMessage(..., 'assistant', answer)
```

The same for `/chat` and `/chat-stream`. Only steps 6–7 differ.

---

# 11. Why Load Before Save

Look closely at step 4. History is loaded **first**, then the new message is saved.

```ts
const history = await getRecentMessages(sessionId, HISTORY_LIMIT)
await insertMessage(sessionId, documentId, 'user', message)
```

If it were the other way round, the history would already include the message being answered, and the prompt would say it twice:

```text
Conversation so far:
...
user: tell me more about the first one     ← from history
New question: tell me more about the first one
```

So: **load history (without the new message) → save the new message → build the prompt from the history you loaded.**

The comment in the code says exactly this: saved before generating so the *next* turn has it, but this turn's prompt uses the history pulled a moment earlier.

---

# 12. The Three-Layer Prompt

```text
[ rules ]
[ CONTEXT        — chunks from the document ]      grounds the FACTS
[ HISTORY        — the last N messages ]           grounds the CONVERSATION
[ NEW QUESTION ]                                   what's being asked right now
```

In `buildChatPrompt()`:

```ts
const historyBlock =
  history.length > 0
    ? `\n\nConversation so far:\n${history.map((m) => `${m.role}: ${m.content}`).join('\n')}`
    : ''
```

plus an instruction telling the model what the history is *for*:

```text
If there's conversation history below, use it to understand what the new
question is referring to (e.g. "the first one", "what about that").
```

Each layer has a different job:

* **Context** answers "what does the document say?"
* **History** answers "what are we talking about?"
* **Question** answers "what do they want now?"

And the question goes **last**, so it's the freshest thing the model reads before answering.

On the first message of a session, `history` is empty and the block disappears entirely.

---

# 13. Why Cap the History?

Why not send everything?

**Cost.** Every message is re-sent on every turn. Turn 50 pays for turns 1–49 again. Total tokens grow roughly with the *square* of the conversation length.

```text
turn 1:  1 message sent
turn 2:  3 messages sent
turn 3:  5 messages sent
...
```

**Context window.** There's a hard ceiling on how much text fits in one request.

**Latency.** More input, slower first token.

**Quality.** Old, off-topic turns are noise. A model given 80 messages can latch onto something irrelevant from an hour ago.

So:

```ts
export const HISTORY_LIMIT = 8
```

Eight messages is about four exchanges. One number in one place, used by both chat routes.

This is a **sliding window**: as new messages arrive, the oldest slide out of view. They're still in the database (the UI shows the full transcript). The *model* just stops seeing them.

---

# 14. What the Sliding Window Forgets

The honest downside:

```text
turn 1:   "My name is Shiv and I only care about chapter 3."
...
turn 6:   "Summarise the important parts for me."
```

By turn 6, turn 1 has slid out. The model no longer knows about chapter 3. From the user's side the bot "forgot", and there's no warning.

Also, `HISTORY_LIMIT` counts **messages, not tokens**. Eight one-line messages are tiny. Eight long assistant answers could be several thousand tokens. The window bounds the count but not the size. A token-budgeted window is the fix (see [advanced/03](../advanced/03-token-counting-cost/More_on_Tokens_Cost.md)).

And a subtle one: 8 is even, so the window normally starts on a user message. After a failed turn (§20) the count goes odd, and the window can start mid-exchange on an assistant reply with its question cut off.

---

# 15. Memory Strategies (the Menu)

The sliding window is the simplest of several. Know the names.

| Strategy | How | Good | Bad |
|---|---|---|---|
| **Full buffer** | send everything | nothing forgotten | cost and limits explode |
| **Sliding window** (DocMind) | last N messages | trivial, predictable | hard cut-off; forgets early facts |
| **Token window** | newest messages that fit a token budget | bounded size | still a hard cut-off |
| **Summary** | replace old turns with an LLM-written summary | keeps the gist forever | extra calls; detail is lost; summaries drift |
| **Summary + buffer** | summary of old turns + last N verbatim | gist *and* recent detail | more moving parts |
| **Retrieval memory** | embed past messages, fetch the relevant ones | scales to very long histories | can miss; needs a vector store |
| **Fact / entity memory** | extract durable facts ("prefers short answers") into a store | long-term, cross-session | extraction errors; privacy |

The usual production answer is **summary + buffer**.

---

# 16. Short-Term vs Long-Term Memory

```text
SHORT-TERM   within one conversation      "what did we just say?"
             → message history in the prompt          (DocMind has this)

LONG-TERM    across conversations         "what do I know about this user?"
             → a separate store of facts / preferences (DocMind doesn't)
```

In DocMind, session B knows nothing about session A, even on the same document. That's a deliberate boundary, and usually the right default: users expect a new chat to be a clean slate.

Long-term memory is a different feature with its own problems: what's worth remembering, how to correct it, how to let the user see and delete it.

You already own the tool for retrieval-style memory, by the way. Embedding old messages and searching them with pgvector is the same mechanism as searching document chunks.

---

# 17. How Summarisation Would Work

```text
messages 1–20   → "The user is reviewing a rental contract. They care about the
                   deposit and notice period. We established the deposit is two
                   months' rent."
messages 21–28  → kept word for word
new question
```

Mechanics:

1. When the history passes a threshold, call the model: "Summarise this conversation so far, keeping names, numbers and decisions."
2. Store the summary (this is where a `sessions` table, or a summary row, becomes necessary).
3. Each prompt = summary + the last few messages + the question.
4. Later, fold newly-old messages into the summary (a *rolling* summary).

Gotchas:

* It's an extra LLM call. Do it after responding, or in a background job, never while the user waits.
* Summaries lose detail and can introduce errors that then persist.
* A summary of a summary of a summary drifts. Summarise from the raw messages when you can.

This is sometimes called **compaction**.

---

# 18. The Limit That Memory Can't Fix: Retrieval

The most important thing to understand about DocMind's memory.

Look at the order in `prepareChat()`:

```text
[2/7] embed the question        ← uses the RAW message
[3/7] search the top 3 chunks   ← retrieval is DONE here
[4/7] load history              ← history arrives AFTER retrieval
```

So for "tell me more about the first one":

```text
embedded text:  "tell me more about the first one"
                 ↓
retrieved:       chunks that happen to contain words like "first"
                 ↓
history:         correctly says "the first one" = ingestion
                 ↓
the model knows WHAT you mean, but was handed the WRONG chunks
```

History fixes **understanding**. It can't fix **retrieval**, because retrieval already ran on a meaningless query.

When it works today, it's often because the previous assistant answer (now in history) already contains the needed information, or the same chunks happened to come back.

The fix is **query rewriting**: use the history to turn the follow-up into a standalone question *before* embedding.

```text
"tell me more about the first one"  →  "Explain the ingestion stage of a RAG pipeline"
```

That's PI.1 in [prompt-improvement.md](../../prompt-improvement.md). With tool calling (topic 10) the model writes the search query itself, which solves it another way.

---

# 19. History as Text vs Real Turns

DocMind flattens the history into a string inside one big prompt:

```text
Conversation so far:
user: ...
assistant: ...
```

The model's API has a proper structure for conversations:

```json
"contents": [
  { "role": "user",  "parts": [{ "text": "What are the three stages?" }] },
  { "role": "model", "parts": [{ "text": "Ingestion, retrieval, generation..." }] },
  { "role": "user",  "parts": [{ "text": "Tell me more about the first one." }] }
]
```

Why real turns are better:

* It's the format the model was trained on, so it tracks references more reliably.
* No ambiguity if a message itself contains the text `assistant:`.
* It separates conversation from instructions (which go in `systemInstruction`).

Two things to handle when switching (PI.2):

* The table stores `'assistant'`. Gemini's role name is `'model'`. Map it.
* Turns should alternate. A failed turn can leave two user messages in a row (§20). Merge or drop before sending.

---

# 20. When Things Fail Midway

The user message is saved **before** generation. The reply is saved **after**. So a failure in between leaves history uneven.

| What fails | What's in the database |
|---|---|
| Generation (`/chat`) | the user message, no reply |
| Stream breaks midway | the user message, no reply (the partial answer is **not** saved) |
| Saving the reply fails after a successful stream | the user message, no reply; the user did see the answer |

Then the user retries, and history has:

```text
user: what is the notice period?
user: what is the notice period?
assistant: 30 days.
```

Two user turns in a row. It's replayed into later prompts that way.

The third row is a deliberate decision in `/chat-stream`: the user already has the full answer, so a failed save is logged and the stream still ends with `done`. Showing "failed!" would be a lie. The price is a hole in the history.

Also worth knowing: the error bubble the UI shows ("Streaming failed") lives only in React state. Refresh, and it's gone, while the unanswered question remains.

Ways to tighten it later:

* save the user message and the reply together, after success (then a failed turn leaves nothing)
* or mark messages with a status and skip incomplete ones when loading
* or make the save idempotent with a client message id, so a retry doesn't duplicate ([topic 16](../16-idempotency-multi-tenancy/More_on_Idempotency_Multi_Tenancy.md))

The topic README lists "save-after-generate" as a learning point. That's true for the **assistant** reply. The **user** message is saved first.

---

# 21. Who Creates the `sessionId`?

Both sides can.

**Frontend** (`useChat.ts`):

```ts
const sessionId = activeSessionId ?? crypto.randomUUID()
```

It makes one up for the first message of a new chat, and reuses the active one after that.

**Backend** (both chat routes):

```ts
const sessionId = req.body.sessionId || randomUUID()
```

A fallback, so a bare `curl` with no `sessionId` still works.

The server always echoes the id back (`{ sessionId, answer, sources }` for `/chat`; the `meta` event for the stream), so the client learns it either way.

A UUID is used because it needs no coordination: the browser can generate one without asking the server, and collisions are practically impossible.

---

# 22. Surviving a Refresh (Step 2.5)

The first version kept the `sessionId` in React state only. Refresh the page and the *link* to the conversation was lost, even though every message was still safe in Postgres.

The fix stores **one thing** in the browser:

```ts
const ACTIVE_SESSION_KEY = 'docmind:activeSessionId'
```

On load:

```text
read the id from localStorage
        ↓
fetch GET /sessions  AND  GET /sessions/:id/messages   (in parallel)
        ↓
is the id in the sessions list?
   ├─ no  → remove it from localStorage, show the new-chat screen
   └─ yes → restore: active session, its document, the full transcript
```

The principle:

> **The browser stores a pointer. The database stores the truth.**

Why not put the messages in `localStorage` too?

* two copies that can disagree
* it wouldn't follow you to another device
* storage limits
* a deleted conversation would live on in the browser

Why the cross-check against `/sessions`? A saved id can go stale: the session was deleted, or the database was reset. Without the check you'd get a "ghost chat": an active session with nothing in it. It's also how the frontend learns which **document** the session belongs to, since the id alone doesn't say.

The key is cleared in three places: starting a new chat, returning to the welcome screen, and when the saved id turns out to be invalid.

---

# 23. A Session's Scope Is Fixed

Each message row carries a `document_id`: a real document, or `'all'` (the `ALL_DOCUMENTS` sentinel from Step 3.3).

A session's scope is whatever its messages were saved with. That's why switching the "Searching in" dropdown starts a **new** chat: mixing scopes inside one thread would replay answers about document A into questions about document B.

One thing to know: this is enforced by the **frontend's behaviour**, not by the backend. `prepareChat()` doesn't check that an incoming `documentId` matches the session's earlier messages. A hand-written request could mix them, and `listSessions()` would label the session by its first row.

`'all'` was chosen over a nullable column so the live table didn't need altering.

---

# 24. Deleting

Two deletes, both keeping history consistent:

```text
DELETE /sessions/:sessionId       → that conversation's messages. The document is untouched.
DELETE /documents/:documentId     → its chunks + EVERY message about it + the document row
```

The second exists so no conversation is left pointing at a document that no longer exists.

Edge: an "All documents" session isn't tied to any one document id (its rows say `'all'`), so deleting a document doesn't remove it. Its saved answers may still quote the deleted file.

---

# 25. What Isn't Stored

`chat_messages` holds `role` and `content`. Nothing else about the turn.

So **sources aren't persisted.** During a live chat, each assistant bubble has its sources attached (they arrive in the `meta` event). Reopen that conversation later and `GET /sessions/:id/messages` returns `role, content, createdAt` only: the same answers, without their sources.

Other things a production system would keep per assistant message:

* which chunks were retrieved, and their distances
* the model name and settings
* token counts and latency
* a status (complete / failed / partial)
* user feedback (👍 / 👎)

A `jsonb` metadata column on the message row covers all of it. That's also the raw material for debugging and evaluation ([topic 12](../12-testing-observability/More_on_Testing_Observability.md), [advanced/04](../advanced/04-evaluation/More_on_Evaluation.md)).

---

# 26. Performance Notes

At DocMind's size none of this matters. Worth knowing where it would start to:

* **No index on `session_id`.** Every history load and transcript fetch scans the table. The fix: an index on `(session_id, created_at)`, which serves both the filter and the sort.
* **`listSessions()`** reads every row. See §8.
* **Full transcript, no pagination.** `getMessagesForSession` returns everything. A 2,000-message conversation is one large response.
* **Two extra queries per chat request** (load history, save the user message) plus one more for the reply. Small next to the model call.

---

# 27. Security and Privacy

There's no auth, so:

* `GET /sessions` lists **every** conversation in the database.
* Anyone can read or delete any session by id.
* A `sessionId` is unguessable, but it's listed publicly, and it's sent in the **URL** of `/chat-stream` along with the message, where proxies and logs can see it.

With users, every session query needs an owner check ([topic 15](../15-auth-jwt/More_on_Auth_JWT.md), [topic 16](../16-idempotency-multi-tenancy/More_on_Idempotency_Multi_Tenancy.md)). History is a leak path as real as vector search: a guessed or stolen session id would replay someone else's conversation straight into a prompt.

Two smaller things:

* **History is untrusted text too.** A manipulated message, once saved, is replayed into every later prompt. Injection can persist across turns ([advanced/06](../advanced/06-llm-security/More_on_LLM_Security.md)).
* **Conversations are personal data.** How long are they kept? Can a user delete them? (DocMind: yes, per session.)

---

# 28. Provider-Side Conversation State

Some LLM APIs offer to hold the conversation for you: you send an id for the previous response or a conversation handle, and the provider supplies the history. (Features and names vary by vendor and change; check current docs.)

Understand what that is:

> It's the same replay, done on their servers. The model is still stateless.

Tradeoffs: less code and smaller requests, against vendor lock-in, less control over what's included or trimmed, and your users' history living with a third party.

**Prompt caching** is related: providers can cache a repeated prompt *prefix* and charge less for it. A conversation is a growing prefix, so each turn can reuse the cached earlier part. That makes long histories cheaper, not unnecessary.

Storing history yourself, as DocMind does, keeps it portable across providers ([advanced/07](../advanced/07-vendor-abstraction/More_on_Vendor_Abstraction.md)).

---

# 29. Testing Memory

`getRecentMessages` and the prompt builder are easy to test (topic 12):

```text
getRecentMessages (against a test DB)
   12 messages, limit 8  → returns messages 5–12, oldest first
   3 messages, limit 8   → returns all 3
   two sessions          → never mixes them

buildChatPrompt (pure)
   empty history         → no "Conversation so far" block
   with history          → block present, in order, before the question
   question is last

prepareChat (repositories mocked)
   history is loaded BEFORE the user message is saved
   the user message is saved with the right scope ('all' when documentId is omitted)
   the new message isn't duplicated in the prompt
```

And the behavioural check, by hand or in an eval set: ask a question, then a vague follow-up, and confirm it resolves. Always try the failure case first (follow-up with no history) so you know the fix is what made it work.

---

# 30. Real Numbers and Facts From This Project

* `HISTORY_LIMIT = 8` (about 4 exchanges), one constant in `config.ts`.
* The pipeline went from 5 steps to 7.
* Verified in Neon: 8 rows sharing one `session_id`, alternating `user` / `assistant`, in order.
* Tested: "3 pipelines in RAG", then "what's the first stage?" resolved correctly through history.
* One `localStorage` key: `docmind:activeSessionId`.
* No `sessions` table.

---

# 31. Interview-Level Summary

If asked **"How does a chatbot remember the conversation?"**:

> It doesn't. Every model call is stateless. The application stores each message and sends the recent ones again with every new request, so the model sees the earlier turns as part of its input. Memory is something the app builds, not a property of the model.

If asked **"How did you implement it?"**:

> A `chat_messages` table with a session id, role, content and timestamp. On each request I load the last eight messages for that session, save the new user message, build the prompt from retrieved context, then history, then the question, generate, and save the reply. A session id groups messages into one thread, separate from the document id.

If asked **"Why limit the history?"**:

> Every turn re-sends everything before it, so cost and latency grow with the conversation, and eventually you hit the context window. Old turns are also noise. I use a sliding window of the last eight messages. The weakness is a hard cut-off: something said early is forgotten, and counting messages doesn't bound tokens.

If asked **"What would you do for long conversations?"**:

> Summarise older turns into a compact summary and keep the most recent ones verbatim, with the window budgeted by tokens. For very long or cross-session memory, embed past messages and retrieve the relevant ones, or extract durable facts into a separate store.

If asked **"What's a limitation of your memory?"**:

> My pipeline embeds and searches using the raw message before it loads history. So for a follow-up like "tell me more about the first one", the model understands the reference from history, but retrieval already ran on a meaningless query and may have fetched the wrong chunks. History can't fix retrieval. The fix is rewriting the follow-up into a standalone question before embedding.

If asked **"How do you keep the conversation across a page refresh?"**:

> The browser stores only the active session id. On load it checks that id against the server's session list, and fetches the transcript from the database. The browser holds a pointer and the database stays the single source of truth, so a deleted or stale id is dropped instead of showing an empty ghost chat.

If asked **"Why no sessions table?"**:

> A session is just the set of messages sharing a session id, so the list is derived by grouping. One table, nothing to keep in sync. It costs a full scan to build the list and leaves nowhere to store per-session data like a title or summary, so I'd add the table when I need those.

If asked **"What happens if generation fails?"**:

> The user message is saved before generation and the reply after, so a failure leaves an unanswered user turn, and a retry produces two user turns in a row. I'd fix it by saving both together on success, or making the save idempotent with a client-generated message id.

---

# 32. Things That Actually Bit You

* `ORDER BY ... ASC LIMIT 8` returns the *first* eight, not the last. Sort-limit-reverse.
* The `sessionId` lived only in React state, so a refresh lost the conversation while the data sat in Postgres.
* A saved id can point at nothing; it needs checking against `/sessions`.
* The backend was already returning `sources` and the frontend never read them.
* `listSessions()` loading everything is fine now and wouldn't scale.
* A tolerated failed save can leave two user turns in a row.

---

# 33. Final Mental Model

```text
                     NEW MESSAGE  (sessionId, documentId, text)
                              │
                              ▼
                   embed → search chunks          ← uses the RAW message
                              │                     (history can't help here)
                              ▼
        ┌──────────────────────────────────────────┐
        │ chat_messages                            │
        │   WHERE session_id = ?                   │
        │   ORDER BY created_at DESC LIMIT 8       │──► reverse ──► HISTORY
        └──────────────────────────────────────────┘
                              │
                 save the user message   (AFTER loading, so it isn't doubled)
                              │
                              ▼
        ┌──────────────────────────────────────────┐
        │ PROMPT                                   │
        │   rules                                  │
        │   CONTEXT   (what the document says)     │
        │   HISTORY   (what we were talking about) │
        │   QUESTION  (what they want now)         │
        └──────────────────────────────────────────┘
                              │
                              ▼
                    MODEL  (remembers nothing)
                              │
                              ▼
                    save the assistant reply
                              │
                              ▼
                 the next message repeats all of this


   BROWSER: localStorage holds ONE id  ──►  DATABASE holds the conversation
```

**The model is stateless. Memory = store + replay.**

**`sessionId` = which conversation. `documentId` = what it's about.**

**Last N, oldest first = sort newest → limit → reverse.**

**Load history, then save the new message, then build the prompt.**

**Cap the history: cost, limits, latency, noise.**

**History fixes understanding, not retrieval.**

**The browser keeps a pointer; the database keeps the truth.**
