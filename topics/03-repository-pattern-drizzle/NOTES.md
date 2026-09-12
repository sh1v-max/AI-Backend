# 03 — Repository Pattern & Drizzle — Quick Revision

Roadmap: Phase 1, Step 1.3 · Guide: [README.md](README.md) · Code: [src/db/schema.ts](../../src/db/schema.ts), [src/db/client.ts](../../src/db/client.ts), [src/repositories/chunks.repository.ts](../../src/repositories/chunks.repository.ts)

- **Repository pattern** = organizational rule, not a tool: only a few functions in one place touch SQL, everything else calls them
  - Same instinct as Mongoose models — never write raw queries inside route handlers
- **Drizzle** = the tool that makes writing those functions type-safe instead of hand-writing SQL strings
- **Schema-as-TypeScript** — one `pgTable(...)` definition drives both the DB structure and the TS types:
  ```ts
  export const chunks = pgTable('chunks', {
    id: serial('id').primaryKey(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 3072 }),
  })
  ```
- Verified the real API by grepping `node_modules/drizzle-orm` directly instead of trusting docs/tutorials blindly — versions shift
- Built two typed functions — nothing else in the app touches SQL from here on:
  ```ts
  insertChunk(content, embedding)
  searchSimilar(queryEmbedding, limit)
  ```
- `cosineDistance(column, value)` — Drizzle's helper for pgvector's `<=>`, builds the SQL expression instead of me typing the operator
- **Real gotcha hit:** `cosineDistance(...)` returns `unknown` by default (Postgres can send numerics as strings over the wire) — TypeScript wouldn't compile until adding `.mapWith(Number)` to tell Drizzle to decode it as a real number
- **Confirmed by running `step3-drizzle.ts`:** identical result to step2's raw SQL (distance 0.2226 / 0.2707) — proof Drizzle generates the same query underneath, just from typed code
- Also learned: `db.execute(sql\`...\`)` is Drizzle's escape hatch for raw SQL when the typed query builder doesn't cover something (used it once, to `DELETE FROM chunks`)

## Milestone

Phase 1 (Embeddings & Vector Search) fully done — embed → store → search, all through typed functions, backed by a real Postgres + pgvector database.
