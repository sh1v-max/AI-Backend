# 03 — Repository Pattern & Drizzle

Step 1.2 worked, but look at `step2-pgvector.ts` again: raw SQL strings, manual `$1`/`$2` placeholders, and a hand-written `toVectorLiteral()` just to format a vector correctly. That's fine for a one-off learning script. It's not fine for a real app with 5 endpoints all needing to touch the database — you'd end up copy-pasting SQL strings everywhere, and one typo in a raw query becomes a runtime bug instead of a compile-time error. This topic fixes that.

---

## Two separate ideas here — don't blur them

**1. The repository pattern** — an *organizational* idea, nothing to do with any specific tool:
> Nothing in your app writes SQL directly except a small set of functions in one place (a "repository"). Everything else — your endpoints, your business logic — calls those functions instead.

You already know this instinct from MongoDB/Mongoose: you don't write raw Mongo queries inside your Express route handlers, you call a model method. Same idea, different database underneath.

**2. Drizzle** — the *tool* that makes writing those repository functions pleasant in TypeScript, with full type safety, instead of hand-writing SQL strings like Step 1.2 did.

You could do the repository pattern with raw `pg` queries (just move the strings into functions). Drizzle is *better* because it gives you compile-time errors when you get a column name wrong, autocomplete on table columns, and it generates the SQL for you from TypeScript code — but the organizational discipline (repository pattern) is the part that actually matters conceptually. Drizzle is just tooling on top of it.

## Why bother wrapping working SQL?

Look at what Step 1.2 required you to know at the call site:
```ts
await pool.query(
  'INSERT INTO chunks (content, embedding) VALUES ($1, $2)',
  [content, toVectorLiteral(embedding)]
)
```
Every place in your app that inserts a chunk needs to remember the exact column order, the exact placeholder syntax, and to call `toVectorLiteral()` first. Get any of that wrong and you find out at runtime, maybe in production.

After wrapping it:
```ts
await insertChunk(content, embedding)
```
The SQL details, the vector formatting, the connection handling — all live in **one file**. Every caller just calls a plain typed function. If the table schema changes later, you fix it in one place, not everywhere it's used.

## What Drizzle actually does

Drizzle lets you describe your table as TypeScript, once:

```ts
// schema.ts
import { pgTable, serial, text, vector } from 'drizzle-orm/pg-core'

export const chunks = pgTable('chunks', {
  id: serial('id').primaryKey(),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 3072 }),
})
```

This one definition does two jobs:
- **Source of truth for your database structure** — Drizzle can generate the `CREATE TABLE` SQL from this, or check it matches what's already there
- **Source of truth for TypeScript types** — `chunks.content` is known to be a string, `chunks.embedding` is known to be a number array, everywhere you use it, with autocomplete

Then queries look like real TypeScript, not string templates:

```ts
await db.insert(chunks).values({ content, embedding })

await db
  .select({ content: chunks.content })
  .from(chunks)
  .orderBy(cosineDistance(chunks.embedding, queryEmbedding))
  .limit(2)
```

No `$1`/`$2`, no manually building `'[0.1,0.2,...]'` strings — Drizzle handles the vector formatting and the placeholder safety for you, and you get autocomplete on `chunks.content` instead of remembering a column name as a plain string.

## What you're actually building (Step 1.3)

Two typed functions, and nothing else in the app touches SQL directly from this point on:

```ts
insertChunk(content: string, embedding: number[]): Promise<void>
searchSimilar(queryEmbedding: number[], limit: number): Promise<{ content: string }[]>
```

These live in a `chunks.repository.ts` file. Later, when you build `/upload` and `/chat`, those endpoints call `insertChunk()` and `searchSimilar()` — they never see a SQL string.

## Where this goes next

```
03 (you are here)    → typed insertChunk() / searchSimilar(), backed by Drizzle
04 pdf-parsing        → extracts text; still needs a place to store it — this is that place
05 RAG                → calls searchSimilar() to find relevant chunks for a question
```

Every future step that touches the database goes through what you build here. Get this right once, reuse it everywhere.

---

## What you need to learn

- [ ] **The repository pattern is an organizational rule, not a Drizzle feature** — "only these functions touch SQL" — you could apply this rule with any tool, or none
- [ ] **What an ORM buys you over raw SQL strings** — type safety, autocomplete, one place to fix schema changes — and what it costs you (a layer of abstraction, some "magic" between your code and the actual SQL running)
- [ ] **Schema-as-TypeScript** — one `pgTable(...)` definition drives both the DB structure and your types
- [ ] **Drizzle still runs real SQL underneath** — nothing magic, it's generating the same kind of query you wrote by hand in Step 1.2, just from typed code instead of strings
- [ ] **Migrations vs. `db push`** — Drizzle Kit can either generate versioned migration files (safer, trackable in git) or just push schema changes directly to the DB (faster for early prototyping, like now)

## What to build (Step 1.3 of the roadmap)

1. Install `drizzle-orm` and `drizzle-kit`
2. Define the `chunks` table as a Drizzle schema (matching what you already created by hand in Step 1.2 — `id`, `content`, `embedding vector(3072)`)
3. Connect Drizzle to the same Neon `DATABASE_URL` you're already using
4. Write `insertChunk(content, embedding)` and `searchSimilar(queryEmbedding, limit)` in `src/repositories/chunks.repository.ts`
5. Write a small script that calls both functions and confirms the results match what Step 1.2's raw-SQL version produced

Since the exact Drizzle syntax for `vector` columns and distance functions (`cosineDistance` or similar) can shift between versions, check [orm.drizzle.team](https://orm.drizzle.team/docs/overview) for the current API when we implement this — don't memorize the exact function names from this doc as gospel, memorize the *shape* of what you're building.

## Resources

- [Learn Drizzle ORM in 13 mins (YouTube)](https://www.youtube.com/watch?v=hIYNOiZXQ7Y)
- [Drizzle ORM docs](https://orm.drizzle.team/docs/overview)
- [Full Drizzle course (YouTube)](https://www.youtube.com/watch?v=vyU5mJGCJMw)

## After you finish

Fill in [NOTES.md](NOTES.md) — especially: could you explain to someone why the repository pattern matters *even if* you weren't using Drizzle at all? If that answer is fuzzy, that's the concept worth re-reading, not the Drizzle syntax.
