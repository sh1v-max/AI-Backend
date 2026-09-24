# AI Backend Learning Journey — Day 2 Context (for LinkedIn post)

## Instructions for Claude

Use the `post-writer-sms` skill to write a LinkedIn post based on everything below. Tone: genuine, technical but accessible, showing real hands-on progress — not buzzwords, not "excited to announce." I'm a frontend/full-stack engineer (know Node.js, Express, MongoDB, JWT, Zod, TypeScript) learning AI backend development from scratch, documenting the journey publicly. This is day 2 of that journey (see `post1.md` for day 1 — embeddings + pgvector, if useful for continuity/callback).

---

## What I built and learned today

Continuing my **DocMind** project (upload a PDF, chat with it, generate a quiz — building it from scratch to actually understand AI backend concepts, not just copy-paste tutorials).

### The problem I ran into

After Step 1.2, I had a working Postgres + pgvector setup — but all raw SQL, hand-written as strings:
```ts
await pool.query(
  'INSERT INTO chunks (content, embedding) VALUES ($1, $2)',
  [content, toVectorLiteral(embedding)]
)
```
Every place that needed to touch the database would've needed to remember exact column order, placeholder syntax, and manually format vectors as `'[0.1,0.2,...]'` strings. One typo = a runtime bug, not a compile-time error.

### What I learned: two separate ideas

1. **The repository pattern** — an organizational rule, not tied to any tool: nothing in the app writes SQL directly except a small set of functions in one place. Everything else calls those functions. (I already knew this instinct from Mongoose models — same idea, different database.)
2. **Drizzle ORM** — the tool that makes writing those functions pleasant in TypeScript: full type safety, autocomplete on table columns, and it generates SQL from typed code instead of me hand-writing strings.

### What I actually built

- Defined my `chunks` table as TypeScript (schema-as-code) — one definition drives both the DB structure and my types:
```ts
export const chunks = pgTable('chunks', {
  id: serial('id').primaryKey(),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 3072 }),
})
```
- Wrote two typed repository functions — `insertChunk()` and `searchSimilar()` — that are now the *only* code in the whole project allowed to touch SQL
- Replaced the raw SQL calls with clean, typed calls:
```ts
await insertChunk(content, embedding)
const results = await searchSimilar(queryEmbedding, 2)
```
- Ran it and got the **exact same result** as my raw-SQL version from yesterday (distance 0.2226 / 0.2707, correctly ranking the two cat-related sentences over the finance ones) — proof Drizzle generates the same query underneath, just from typed code

### A real gotcha I hit (not glossed over)

TypeScript compilation actually failed on my first attempt: `cosineDistance()` returns a value typed as `unknown` by default, because Postgres can return numeric values as strings over the wire to avoid precision loss. Had to explicitly tell Drizzle how to decode it:
```ts
const distance = cosineDistance(chunks.embedding, queryEmbedding).mapWith(Number)
```
Small thing, but it's the kind of real debugging moment that doesn't show up in polished tutorials — found the actual type error, understood *why* it happened, fixed it correctly instead of just silencing it with an `as any`.

## The bigger takeaway

Working code isn't the same as *good* code. Step 1.2's raw SQL worked fine — but wrapping it in a repository is what makes it safe to reuse across 5 different endpoints without copy-pasting SQL strings everywhere. This is the exact same discipline as using Mongoose models instead of raw MongoDB queries — just applied to a relational + vector database instead.

## What's next

Phase 1 (Embeddings & Vector Search) is done. Moving to Phase 2: parsing real PDFs and building the actual RAG chat pipeline for DocMind.
