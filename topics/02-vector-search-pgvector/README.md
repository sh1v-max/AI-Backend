# 02 — Vector Search (pgvector)

Topic 01 taught you the math: embed two things, compare them with cosine similarity, by hand, in a script. This topic teaches you the same idea done for real — thousands of vectors, searched fast, inside a database — using Postgres and its `pgvector` extension.

---

## The problem this solves

Your Step 1.1 script compared exactly 2 pairs of sentences, computed by hand in a loop. That's fine for 2 vectors. DocMind will eventually store thousands of chunks across many PDFs — you can't loop through all of them in JavaScript every time someone asks a question; it would be slow and it doesn't scale.

The fix: store the vectors in a database that knows how to search them efficiently, and let the database do the math.

## What is pgvector?

`pgvector` is a Postgres **extension** — an add-on that gives Postgres a new column type (`vector`) and new operators to compare vectors, directly in SQL. It doesn't replace Postgres; it just teaches your existing relational database a new trick: "store a list of numbers in a column, and let me search by distance between them."

This matters because it means your embeddings live in the *same* database as everything else (chunks, users, chat history) — no separate specialized vector database service required, at least not yet, not for this project's scale.

## The operators — same math, new syntax

`pgvector` gives you three comparison operators. You only need one for now, but knowing all three matters:

| Operator | Distance type | What it measures |
|---|---|---|
| `<=>` | Cosine distance | The one you already know — `1 - cosine_similarity`. **This is the one we use.** |
| `<->` | Euclidean (L2) distance | Straight-line distance between two points in space |
| `<#>` | Negative inner product | Raw dot product, negated — faster to compute, but only valid if all vectors are normalized to the same length |

Here's the connection to make explicit: in Step 1.1, you wrote `cosine_similarity(a, b) = dot(a,b) / (|a| * |b|)` by hand. `<=>` computes `1 - cosine_similarity` — literally that formula, just flipped into a *distance* (smaller = more similar, instead of larger = more similar) and computed inside the database in optimized C code instead of a JavaScript loop. Same math. Different address.

## The table

```sql
CREATE EXTENSION vector;

CREATE TABLE chunks (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  embedding VECTOR(3072)
);
```

One important correction to the base roadmap: it says `vector(768)`, because the model it assumed (`text-embedding-004`) has been retired. You're using `gemini-embedding-001`, which outputs **3072** numbers (confirmed when you ran Step 1.1) — so the column must be `VECTOR(3072)`, matching whatever your embedding model actually produces. The dimension in the column definition isn't a preference, it's a hard requirement: pgvector will reject vectors of the wrong length for that column.

## Querying — finding the closest match

```sql
SELECT content
FROM chunks
ORDER BY embedding <=> '[0.12, -0.44, ...]'
LIMIT 2;
```

Read this sentence out loud once it clicks: *"order all rows by how cosine-different their embedding is from this query vector, and give me the 2 closest."* That's the entire idea of semantic search, in one SQL query. No `WHERE`, no keyword matching — just "sort by meaning-distance."

## Indexing (know it exists, don't over-focus yet)

For a handful of rows, Postgres just checks every row's distance (a "sequential scan") — fine, even fast. Once a table has hundreds of thousands of vectors, that becomes slow, and you'd add an index — `HNSW` or `IVFFlat` — so the database can skip most rows instead of checking all of them.

You don't need this for DocMind's scale. Know the names, know *why* they'd matter later (approximate nearest-neighbor search instead of exact), and move on — this is a "come back later" detail, not a Step 1.2 blocker.

## Where to run Postgres

Two free options with `pgvector` built in, no local install pain:
- **[Neon](https://neon.tech)** — serverless Postgres, generous free tier
- **[Supabase](https://supabase.com)** — Postgres + extras, also has a free tier

Either works identically for this project. Pick one, create a project, grab the connection string.

---

## What you need to learn

- [ ] **pgvector is an extension, not a separate database** — same Postgres, new column type + operators
- [ ] **`<=>` is your cosine math from Topic 01, run inside the database** — not a new concept, a new location
- [ ] **The vector column's dimension must match your embedding model exactly** — 3072 for `gemini-embedding-001`, and this is a hard constraint, not a style choice
- [ ] **`ORDER BY embedding <=> query LIMIT N` is the entire pattern** for "find the N most similar things" — you'll reuse this exact shape in RAG (Topic 05) and intent routing (Topic 10)
- [ ] **Indexes (HNSW/IVFFlat) exist for scale** — not needed yet, know the names and why they'd matter

## What to build (Step 1.2 of the roadmap)

1. Create a free Neon or Supabase Postgres project
2. Connect to it (via their SQL editor, or a client like `psql` / TablePlus / DBeaver)
3. Run `CREATE EXTENSION vector;`
4. Create the `chunks` table with `VECTOR(3072)`
5. Take 3-4 sentences, embed them using the same approach as `src/step1-embeddings.ts`, and insert them (content + embedding) directly via SQL or a tiny one-off insert script
6. Run one query by hand: `SELECT content FROM chunks ORDER BY embedding <=> '[...]' LIMIT 2;`
7. Confirm: the results returned are the ones you'd *expect* to be closest in meaning — same confirmation instinct as Step 1.1, just done via SQL instead of a printed similarity score

## Resources

- [pgvector Tutorial – DataCamp](https://www.datacamp.com/tutorial/pgvector-tutorial)
- [18 Months of Pgvector Learnings in 47 Minutes (YouTube)](https://www.youtube.com/watch?v=Ua6LDIOVN1s)
- [pgvector GitHub repo](https://github.com/pgvector/pgvector) — the actual operator/index reference, come back to this when indexing matters
- [Neon](https://neon.tech) · [Supabase](https://supabase.com)

## After you finish

Fill in [NOTES.md](NOTES.md) in your own words — especially the connection between `<=>` and the cosine formula you hand-wrote in Topic 01. If you can't explain that link without looking, that's the one thing worth re-reading before moving to Step 1.3.
