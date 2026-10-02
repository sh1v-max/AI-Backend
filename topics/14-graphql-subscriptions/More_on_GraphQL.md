# 14 — GraphQL + Subscriptions

**Roadmap: Phase 11 (Step 11.1)** · **Status in DocMind: not built, and not planned to be.** This is a reading topic: DocMind is REST, and stays REST. The goal is to be able to explain GraphQL and to see how a GraphQL subscription maps onto the SSE streaming you already built. Library APIs below are indicative; check current docs before building.

Code this file compares against: [chat.routes.ts](../../src/routes/chat.routes.ts) (`/chat-stream`), [llm.service.ts](../../src/services/llm.service.ts) (`streamAnswer`), [sessions.routes.ts](../../src/routes/sessions.routes.ts), [documents.routes.ts](../../src/routes/documents.routes.ts)

---

# 1. What is GraphQL?

REST gives you **many URLs**, each returning a fixed shape:

```text
GET /documents
GET /sessions
GET /sessions/:id/messages
POST /chat
```

GraphQL gives you **one URL** and a query language. The client says exactly which fields it wants:

```graphql
query {
  sessions {
    sessionId
    title
    messageCount
  }
}
```

And gets back exactly that shape, nothing more:

```json
{ "data": { "sessions": [ { "sessionId": "abc", "title": "What is RAG?", "messageCount": 6 } ] } }
```

> **REST: the server decides the shape of each response. GraphQL: the client does.**

It's a **query language for APIs** plus a **runtime** that executes those queries against functions you write. It has nothing to do with graph databases, and it isn't tied to any database at all.

---

# 2. Simple Analogy

### REST = a set menu

```text
Meal #1: burger + fries + drink
Meal #2: pizza + salad
```

You want a burger and a salad? Order two meals and throw away the fries and the pizza. Or ask the kitchen to invent Meal #3.

### GraphQL = a buffet with a tray

You walk the line once and take exactly what you want. One trip. Nothing extra on the tray.

The cost: the kitchen has to keep every dish ready and can't predict what anyone will take.

---

# 3. The Problems GraphQL Was Made For

**Over-fetching.** `GET /sessions` returns `sessionId, documentId, filename, title, lastMessage, lastMessageAt, messageCount`. A sidebar that only shows titles still downloads all of it.

**Under-fetching.** To show a session with its messages and its document's info, a REST client makes several requests:

```text
GET /sessions
GET /sessions/abc/messages
GET /documents
```

In GraphQL that's one request:

```graphql
query {
  session(id: "abc") {
    title
    document { filename chunkCount }
    messages { role content createdAt }
  }
}
```

**Many clients, different needs.** A mobile app wants small payloads, a web dashboard wants everything. With REST you add query params or new endpoints. With GraphQL each client writes its own query.

**A typed contract.** The schema is machine-readable, so tools can generate TypeScript types and validate queries before they're sent.

---

# 4. The Three Operation Types

```text
QUERY          read data                    like GET
MUTATION       change data                  like POST / PUT / DELETE
SUBSCRIPTION   receive a stream of events   like SSE / WebSocket
```

Mapping DocMind's REST API:

| REST | GraphQL |
|---|---|
| `GET /documents` | `query { documents { ... } }` |
| `GET /sessions/:id/messages` | `query { session(id:) { messages { ... } } }` |
| `DELETE /documents/:id` | `mutation { deleteDocument(id:) }` |
| `POST /quiz` | `mutation { generateQuiz(documentId:) { ... } }` |
| `POST /chat` | `mutation { sendMessage(...) { answer sources { ... } } }` |
| `GET /chat-stream` | `subscription { chat(...) { ... } }` |

The third type is why this topic is in an AI-backend roadmap.

---

# 5. The Schema

Written in **SDL** (Schema Definition Language). It's the contract.

```graphql
type Document {
  id: ID!
  filename: String!
  chunkCount: Int!
  createdAt: String!
}

type Source {
  content: String!
  distance: Float!
  filename: String
}

type Message {
  role: String!
  content: String!
  createdAt: String!
}

type Session {
  sessionId: ID!
  title: String!
  messageCount: Int!
  document: Document
  messages: [Message!]!
}

type Query {
  documents: [Document!]!
  sessions: [Session!]!
  session(id: ID!): Session
}

type Mutation {
  deleteDocument(id: ID!): Boolean!
  generateQuiz(documentId: ID!): Quiz!
}

type Subscription {
  chat(message: String!, documentId: ID, sessionId: ID): ChatEvent!
}
```

Reading the syntax:

* `String!` — non-null. Without `!`, it may be null.
* `[Message!]!` — a non-null list of non-null messages.
* Scalars: `Int`, `Float`, `String`, `Boolean`, `ID`. Custom scalars exist (e.g. `DateTime`).
* `Query`, `Mutation`, `Subscription` are the three entry points.
* Also: `input` types (for arguments), `enum`, `interface`, `union`.

A `union` is how you'd model the SSE events:

```graphql
type ChatMeta  { sessionId: ID!, sources: [Source!]! }
type ChatToken { text: String! }
type ChatDone  { ok: Boolean! }
type ChatError { error: String! }

union ChatEvent = ChatMeta | ChatToken | ChatDone | ChatError
```

That's the `meta` / default / `done` / `error` protocol of `/chat-stream`, written as types.

---

# 6. Resolvers

A resolver is a function that returns the value for one field. The schema says *what* exists; resolvers say *how to get it*.

```ts
const resolvers = {
  Query: {
    documents: () => listDocuments(),
    session: (_parent, args) => getSessionSummary(args.id),
  },
  Session: {
    messages: (parent) => getMessagesForSession(parent.sessionId),
    document: (parent) => getDocumentById(parent.documentId),
  },
  Mutation: {
    deleteDocument: async (_parent, args) => { /* ...same three deletes as the REST route... */ return true },
  },
}
```

Every resolver receives four arguments:

```text
(parent, args, context, info)

parent   the object this field belongs to (the Session, for Session.messages)
args     the field's arguments ({ id })
context  per-request shared data (the verified user, DB access)
info     details about the query itself (rarely needed)
```

Notice the resolver bodies are **the same repository calls** the REST routes make. GraphQL replaces the *routes* layer, not services or repositories:

```text
REST route      ─┐
                 ├─► service ─► repository ─► db
GraphQL resolver ─┘
```

That's the layering in this repo paying off again: routes are thin, so swapping the front door wouldn't touch the rest.

---

# 7. How a Query Executes

```text
query arrives
     ↓
PARSE        text → syntax tree
     ↓
VALIDATE     does every field exist in the schema? right argument types?
     ↓        (a bad query is rejected here, before any of your code runs)
EXECUTE      call resolvers field by field, top-down
     ↓
     Query.session        → { sessionId, title, documentId }
        Session.title     → default resolver: just reads parent.title
        Session.messages  → your resolver runs
        Session.document  → your resolver runs
     ↓
assemble the JSON in the shape of the query
```

Only the resolvers for **requested** fields run. If the client doesn't ask for `messages`, that query is never made.

---

# 8. Context

`context` is built **once per request** and handed to every resolver.

```ts
context: async ({ request }) => {
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  const user = token ? verifyJwt(token) : null
  return { user }
}
```

In Express, the equivalent is middleware setting `req.user`. In GraphQL there's only one endpoint, so "middleware per route" doesn't exist; auth happens when the context is built, and each resolver checks it:

```ts
deleteDocument: (_p, args, ctx) => {
  requireUser(ctx)                 // throws if not signed in
  return deleteForUser(ctx.user.id, args.id)
}
```

That's the `requireAdmin`-in-context pattern mentioned in the notes template. More in [topic 15](../15-auth-jwt/More_on_Auth_JWT.md).

---

# 9. Subscriptions — The Part That Matters Here

A subscription is a long-lived operation: the client subscribes once, the server pushes many results.

And a subscription resolver's `subscribe` function is an **async generator**:

```ts
Subscription: {
  chat: {
    subscribe: async function* (_parent, args, ctx) {
      const prep = await prepareChat({ ...args, sessionId: args.sessionId ?? randomUUID() }, Date.now())
      if (!prep.ok) { yield { chat: { __typename: 'ChatError', error: prep.error } }; return }

      yield { chat: { __typename: 'ChatMeta', sessionId: prep.sessionId, sources: prep.sources } }

      let full = ''
      for await (const piece of streamAnswer(prep.prompt)) {
        full += piece
        yield { chat: { __typename: 'ChatToken', text: piece } }
      }

      await insertMessage(prep.sessionId, prep.documentId, 'assistant', full)
      yield { chat: { __typename: 'ChatDone', ok: true } }
    },
  },
}
```

Put that next to the real `/chat-stream` handler:

```text
REST + SSE                              GraphQL subscription
────────────────────────────────        ────────────────────────────────
res.write(`event: meta ...`)            yield { chat: ChatMeta }
for await (piece of streamAnswer)       for await (piece of streamAnswer)
  res.write(`data: {text}`)               yield { chat: ChatToken }
res.write(`event: done`)                yield { chat: ChatDone }
res.end()                               (generator returns)
```

**Same loop.** `streamAnswer()` is already an async generator. The only difference is who formats the frames: in REST you write `data: ...\n\n` yourself; in GraphQL you `yield` objects and the server library serializes each one.

> **A subscription resolver is an async generator. `yield` is `res.write`.**

---

# 10. Subscription Transports: SSE vs WebSocket

GraphQL doesn't say *how* events travel. Two common transports:

| | GraphQL over SSE | GraphQL over WebSocket |
|---|---|---|
| Direction | server → client | both ways |
| Protocol | plain HTTP | upgraded connection |
| Works through proxies / load balancers | easily | needs WebSocket support |
| Auth | normal HTTP headers / cookies | sent in a connection-init message |
| Libraries | `graphql-sse`, built into GraphQL Yoga | `graphql-ws` |
| Good for | LLM token streaming, notifications | chat rooms, collaboration |

The production backend that inspired this topic used **GraphQL over SSE** for its chat front door. That's a sensible choice for LLM streaming: it's one-way, it's just HTTP, and it needs no special infrastructure.

On the wire it looks like what you already know:

```text
event: next
data: {"data":{"chat":{"__typename":"ChatToken","text":"RAG"}}}

event: next
data: {"data":{"chat":{"__typename":"ChatToken","text":" stands"}}}

event: complete
data:
```

It's SSE. Named events, `data:` lines, blank-line separators. Everything in [More_on_Streaming.md](../07-streaming-sse/More_on_Streaming.md) still applies, including proxy buffering and the "can't change the status code after the stream starts" rule.

One thing that gets easier: GraphQL-over-SSE clients usually use `fetch` (POST) rather than the browser's `EventSource`, so the "GET-only, no custom headers" limitation that forced `/chat-stream` to be a GET with query params goes away.

---

# 11. Where Subscription Events Come From

Two patterns:

**1. The generator produces events itself.** (The chat example.) One client, one stream, nothing shared. This is the LLM streaming case.

**2. Pub/Sub.** Something elsewhere publishes; subscribers receive.

```ts
// somewhere in a worker
pubsub.publish('document:status', { documentId, status: 'ready' })

// the subscription
subscribe: (_p, args) => pubsub.subscribe('document:status')   // returns an async iterator
```

This is the pattern for "tell the browser when ingestion finishes" (topic 09). With one server, an in-memory pubsub works. With several instances (or a separate worker process), you need a shared one, typically **Redis pub/sub**, because the publisher and the subscriber may be in different processes.

---

# 12. Errors in GraphQL

This surprises REST people:

> **GraphQL usually returns HTTP 200 even when something failed.**

```json
{
  "data": { "session": null },
  "errors": [
    { "message": "Session not found", "path": ["session"], "extensions": { "code": "NOT_FOUND" } }
  ]
}
```

* Errors are in an `errors` array in the body, not in the status code.
* **Partial success is possible**: some fields resolve, others fail, and you get both `data` and `errors`.
* Machine-readable codes go in `extensions.code`.

So monitoring by HTTP status doesn't work. You have to look inside responses.

You've met this idea already: `/chat-stream` reports failures as an in-band `event: error` frame with status 200, because `EventSource` can't read a non-200 body. GraphQL does that for everything.

A popular alternative is **errors as data**: model expected failures in the schema with a union (`ChatError` above), and keep the `errors` array for unexpected ones.

---

# 13. The N+1 Problem

The classic GraphQL performance bug.

```graphql
query { sessions { title document { filename } } }
```

```text
1 query   → SELECT ... sessions                       (returns 20 sessions)
20 queries → SELECT ... documents WHERE id = ?        (one per session)
```

21 queries for one request. Each `Session.document` resolver runs independently and has no idea about its siblings.

The fix is **DataLoader**: it collects all the ids requested during one tick and makes a single batched query.

```ts
const documentLoader = new DataLoader(async (ids) => {
  const docs = await getDocumentsByIds(ids)             // WHERE id IN (...)
  return ids.map((id) => docs.find((d) => d.id === id) ?? null)   // same order as ids
})

Session: { document: (parent, _a, ctx) => ctx.loaders.document.load(parent.documentId) }
```

```text
20 × load(id)  →  1 query: WHERE id IN (20 ids)
```

Loaders are created **per request** (inside the context) so the cache never leaks between users.

REST has the same problem in a different place: DocMind's `listSessions()` avoids it by doing a join in SQL. In GraphQL the join can't be written up front because you don't know which fields will be asked for.

---

# 14. Security Problems Specific to GraphQL

Because the client writes the query, the client can write an expensive one.

```graphql
query { sessions { messages { session { messages { session { messages { ... } } } } } } }
```

Defenses:

* **Depth limiting** — reject queries nested deeper than N.
* **Complexity limiting** — assign a cost per field, reject queries over a budget.
* **Pagination everywhere** — never return unbounded lists (`messages(first: 20, after: cursor)`).
* **Persisted queries** — the server only accepts queries from an approved list (identified by hash). Clients can't send arbitrary ones.
* **Disable introspection in production** — introspection lets anyone download your whole schema. Useful in dev, a map for attackers in prod.
* **Timeouts.**
* **Authorization in resolvers (or the service layer)**, not just at the entry point. Every path to a `Document` must check ownership, because GraphQL offers many paths to the same object.

Rate limiting by request count also stops meaning much (one request can be tiny or enormous), which is why complexity-based limits exist.

---

# 15. Caching

REST caching is easy: `GET /documents` is a URL; browsers and CDNs cache by URL.

GraphQL sends everything as `POST /graphql`. HTTP caching mostly doesn't apply. Instead:

* **Client-side normalized caches** (Apollo Client, urql): they store objects by `__typename` + `id` and update every query that references an object when it changes.
* **Persisted queries over GET** so CDNs can cache.
* **Server-side caching** per resolver.

This is a real cost of choosing GraphQL.

---

# 16. File Uploads

GraphQL is JSON. A PDF isn't. Options:

* a multipart extension for GraphQL (works, awkward)
* **keep uploads in REST** (very common: `POST /upload` stays exactly as it is)
* a mutation that returns a pre-signed URL, and the client uploads straight to object storage

Mixing REST and GraphQL in one backend is normal. Use each where it fits.

---

# 17. GraphQL vs REST vs tRPC vs gRPC

| | REST | GraphQL | tRPC | gRPC |
|---|---|---|---|---|
| Shape decided by | server | client | server | server |
| Endpoints | many | one | many (procedures) | many (methods) |
| Typed contract | optional (OpenAPI) | built in (schema) | TypeScript types shared directly | built in (protobuf) |
| Streaming | SSE / WS, by hand | subscriptions | subscriptions | native streaming |
| HTTP caching | easy | hard | easy-ish | n/a |
| Best for | public APIs, simple CRUD | many clients, nested data | one TS team owning both ends | service-to-service |
| Learning curve | low | medium-high | low (if TS everywhere) | medium |

---

# 18. Why a Company Picks GraphQL for a Chat/AI Backend

* **One typed schema** shared by web, mobile and internal tools, with generated types on every client.
* **Nested data** is natural: a conversation with messages, each with sources, each with a document.
* **Subscriptions are first-class**, so streaming tokens, tool-call status, and "document ready" events all go through one mechanism with typed events.
* **One place for auth**: the context.
* **Evolving without versioning**: add fields freely; mark old ones `@deprecated` instead of shipping `/v2`.

# Why NOT

* Much more setup than a few Express routes.
* N+1, complexity limits, and caching are all new problems you now own.
* Errors-with-200 complicates monitoring.
* For one frontend and a dozen endpoints, it's overkill.

**DocMind stays REST on purpose**: one client, ten endpoints, one streaming route. The right answer in an interview is knowing when each fits, not preferring one.

---

# 19. Server Libraries (Node)

| Library | Notes |
|---|---|
| **GraphQL Yoga** | batteries included, SSE subscriptions built in, works with Express |
| **Apollo Server** | the best-known; subscriptions need extra setup |
| **Mercurius** | for Fastify |
| **Pothos / Nexus / TypeGraphQL** | *code-first* schema builders (write TypeScript, generate SDL) |
| **graphql-codegen** | generates TS types from a schema and your queries |

**Schema-first vs code-first:** schema-first = write SDL, then resolvers that must match it. Code-first = write TypeScript that *produces* the schema, so types and schema can't drift. Same "one source of truth" idea as `z.infer` in topic 08.

A minimal Yoga server mounted on the existing Express app would look roughly like:

```ts
import { createSchema, createYoga } from 'graphql-yoga'

const yoga = createYoga({
  schema: createSchema({ typeDefs, resolvers }),
  context: ({ request }) => ({ user: authenticate(request) }),
})

app.use('/graphql', yoga)
```

Yoga also ships **GraphiQL**, an in-browser playground to write queries and watch subscriptions stream. If you ever want to *see* a subscription yield tokens, that's the fastest way.

---

# 20. Client Side

A query is just a POST:

```ts
await fetch('/graphql', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: `query ($id: ID!) { session(id: $id) { title messages { role content } } }`,
    variables: { id: 'abc' },
  }),
})
```

* **Variables** are sent separately from the query text. Never build queries by string concatenation (same reason as SQL parameters).
* **Fragments** are reusable field selections.
* Client libraries: Apollo Client, urql, or just `fetch` + `graphql-request`. For subscriptions over SSE: `graphql-sse`'s client.

---

# 21. If DocMind Were GraphQL (Thought Experiment)

```text
POST /upload            stays REST (multipart)
POST /graphql
   query documents, sessions, session(id) { messages }
   mutation deleteDocument, deleteSession, generateQuiz
   subscription chat(message, documentId, sessionId) → ChatMeta | ChatToken | ChatDone | ChatError
```

What would change:

* `routes/*.ts` → resolvers. Services and repositories untouched.
* The frontend's `EventSource` wrapper → a `graphql-sse` client; the hand-parsed `meta`/`done`/`error` events → a typed union with `__typename`.
* `prepareChat()` returning `{ ok: false, status, error }` → mapped to a `ChatError` event or a GraphQL error.
* The `GET` + query-params workaround disappears (a POST carries the message in the body).
* New work: DataLoader for `Session.document`, depth limits, and a per-request context.

Net: more machinery for the same features. Good exercise to reason about; not worth doing.

---

# 22. Interview-Level Summary

If asked **"What is GraphQL?"**:

> A query language for APIs with a typed schema. There's one endpoint, and the client specifies exactly which fields it wants; the server executes the query by calling resolver functions per field. It solves over-fetching and under-fetching and gives every client a typed contract.

If asked **"Query vs mutation vs subscription?"**:

> Queries read, mutations write, subscriptions are long-lived operations where the server pushes a stream of results.

If asked **"How do subscriptions work?"**:

> The subscription resolver returns an async iterator, usually an async generator. Each value it yields is sent to the client. The transport is separate: it can be WebSockets or Server-Sent Events. For streaming LLM tokens, SSE is enough because it's one-way and plain HTTP.

If asked **"How does that relate to what you built?"**:

> My REST streaming route loops over an async generator that yields text from the model and writes each piece as an SSE frame. A GraphQL subscription is the same loop: yield instead of `res.write`, and the library handles the framing. The four event types I send, meta, token, done and error, would be a union type in the schema.

If asked **"What's the N+1 problem?"**:

> Resolvers run per object, so fetching a list of 20 items with a related field causes one query for the list and 20 for the relation. DataLoader batches those into one `WHERE id IN (...)` query, with one loader instance per request.

If asked **"Where does auth go?"**:

> In the context. It's built once per request: verify the token, attach the user. Resolvers or the service layer then check permissions for the specific object.

If asked **"When would you not use GraphQL?"**:

> A small API with one client, or a public API where HTTP caching and simplicity matter. It brings N+1, query-complexity limits and harder caching. My project has one frontend and about ten endpoints, so REST is the right size.

---

# 23. Things to Remember

* GraphQL ≠ graph database. It sits in front of anything.
* HTTP 200 doesn't mean success. Look in `errors`.
* Resolvers replace routes, not services.
* Subscriptions need a transport: SSE or WebSocket.
* Client-controlled queries need depth/complexity limits.
* Introspection off in production.
* Uploads usually stay REST.

---

# 24. Final Mental Model

```text
                 CLIENT
                   │   one endpoint: POST /graphql
                   ▼
          ┌──────────────────┐
          │   parse          │
          │   validate  ◄────┼──── SCHEMA (types, the contract)
          └──────────────────┘
                   │
                   ▼
          ┌──────────────────┐
          │   CONTEXT        │   built once per request: verified user, loaders
          └──────────────────┘
                   │
     ┌─────────────┼──────────────────┐
     ▼             ▼                  ▼
   QUERY       MUTATION         SUBSCRIPTION
   read        write            async function*
     │             │                  │
     ▼             ▼                  ▼
  resolvers    resolvers        yield … yield … yield
     │             │                  │
     └──────┬──────┘                  ▼
            ▼                   transport: SSE (or WebSocket)
   services → repositories → db       │
            │                         ▼
            ▼                   client gets events one by one
   JSON shaped like the query
```

**One endpoint, one schema, the client picks the fields.**

**Resolver = a function per field. It replaces a route, not a service.**

**Context = where per-request auth lives.**

**Subscription = async generator. `yield` = `res.write`.**

**SSE is a perfectly good subscription transport, and it's what you already built.**

**N+1 → DataLoader. Arbitrary queries → depth and complexity limits.**
