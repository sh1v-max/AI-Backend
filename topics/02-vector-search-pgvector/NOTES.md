# 02: Vector Search (pgvector), In My Own Words

Roadmap: Phase 1, Step 1.2 · Guide: [README.md](README.md) · Code: [src/step2-pgvector.ts](../../src/step2-pgvector.ts)

## What it is, simply

In topic 01 I compared two vectors in a JS loop. Fine for two sentences, useless for thousands. So instead I store the vectors in a database and let the database do the math. **pgvector** is a Postgres extension (not a separate database) that adds a `vector` column type and a few distance operators. I'm hosting it free on **Neon**.

## What I actually did

- Turned it on with `CREATE EXTENSION vector;`
- Made a `chunks` table with a `VECTOR(3072)` column. The size has to match the embedding model exactly, 3072 for `gemini-embedding-001`, or inserts just fail.
- Embedded 10 sentences across 4 topics (cats, finance, coding, cooking) and inserted them
- Then embedded a brand new sentence, "a cat napping on a blanket", and asked the database for the 2 closest

The query that sits under all semantic search:

```sql
SELECT content FROM chunks ORDER BY embedding <=> $1 LIMIT 2
```

Sort everything by how close it is in meaning, take the top N.

## The three operators

- `<=>` cosine distance, **the one I use**. It's basically `1 - cosine_similarity`, so **smaller = more similar** (opposite of topic 01, took me a second)
- `<->` euclidean distance (straight line distance)
- `<#>` negative inner product (needs normalized vectors)

## The part that made it click

`<=>` is doing the exact same cosine math I wrote by hand in topic 01. Same formula, just running inside Postgres instead of a JS loop. Nothing magic.

## Confirmed by actually running it

- [x] Neon + pgvector set up, extension enabled, real table created
- [x] "a cat napping on a blanket" came back with the two cat sentences first (distances **0.2226** and **0.2707**), ignoring finance, coding and cooking
- [x] Parameterized queries (`$1`, `$2`) so values never get pasted into the SQL string

## Watch out

`step2-pgvector.ts` starts with `DROP TABLE IF EXISTS chunks`. Fine back then, but now that table holds real PDFs, so **never run it again** against the live database. (I removed it from the npm scripts for that reason.)

## What still feels a little shaky

- Indexes (HNSW / IVFFlat). Right now every search compares against every row, which is totally fine at my size. They only matter at something like 100k+ rows, and I haven't tried one yet. There's a deeper note on this in [INDEXING-AT-SCALE.md](INDEXING-AT-SCALE.md).
