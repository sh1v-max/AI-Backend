# 03: Repository Pattern & Drizzle, In My Own Words

Roadmap: Phase 1, Step 1.3 · Guide: [README.md](README.md) · Code: [src/db/schema.ts](../../src/db/schema.ts), [src/db/client.ts](../../src/db/client.ts), [src/repositories/chunks.repository.ts](../../src/repositories/chunks.repository.ts)

## Two separate ideas, not one

After topic 02 I had raw SQL strings sitting in a script. Worked, but every place that touched the database had to remember column order, `$1` placeholders, and format vectors as `'[0.1,0.2,...]'` strings by hand. One typo = a runtime bug.

1. **The repository pattern** is just a rule, not a tool: only a few functions in one folder are allowed to touch SQL. Everything else calls those functions. Same instinct I already had with Mongoose models, never write raw queries inside a route.
2. **Drizzle** is the tool that makes writing those functions nice in TypeScript. I describe the table in TS, and it gives me type safety, autocomplete, and builds the SQL for me.

## What I actually built

The table, described once in TypeScript, and that one definition drives both the database and my types:

```ts
export const chunks = pgTable('chunks', {
  id: serial('id').primaryKey(),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 3072 }),
})
```

Then two functions, and from here on nothing else in the app writes SQL:

```ts
insertChunk(content, embedding)
searchSimilar(queryEmbedding, limit)
```

`cosineDistance(column, value)` is Drizzle's helper for pgvector's `<=>`, so I don't type the operator myself.

## A real gotcha, not a hypothetical one

TypeScript refused to compile on my first try. `cosineDistance(...)` comes back typed as `unknown`, because Postgres can send numbers as strings over the wire (to avoid losing precision). Fix was telling Drizzle how to read it:

```ts
const distance = cosineDistance(chunks.embedding, queryEmbedding).mapWith(Number)
```

Found the actual reason instead of slapping `as any` on it. Also checked the real API by looking inside `node_modules/drizzle-orm` instead of trusting a tutorial, because versions change.

## Confirmed by actually running it

- [x] `step3-drizzle.ts` gave the **exact same** result as the raw SQL version (distance 0.2226 / 0.2707). Proof Drizzle builds the same query, just from typed code.
- [x] `db.execute(sql\`...\`)` is the escape hatch for raw SQL when the query builder doesn't cover something. Used it once.

## How this paid off later

The rule held up the whole project. Later I added `documents.repository.ts` and `chatMessages.repository.ts`, `searchSimilar` learned to filter by document (and later search all documents at once), and `sampleChunks` got added for the quiz. Every one of those changes happened in one file, and routes never cared.

## Watch out

`step3-drizzle.ts` runs `DELETE FROM chunks`. That wipes every real PDF chunk now. Don't run it against the live database.

## What still feels a little shaky

- There's no migrations folder. The tables were created straight in Neon, and the SQL is written as comments next to each table in `schema.ts`. Works, but if I ever needed to rebuild the database from scratch it'd be manual.
