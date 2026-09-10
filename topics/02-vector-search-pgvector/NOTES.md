# 02 — Vector Search (pgvector) — Quick Revision

Roadmap: Phase 1, Step 1.2 · Guide: [README.md](README.md)

- **pgvector** = Postgres extension, adds a `vector` column type + distance operators — not a separate DB
- Enable with: `CREATE EXTENSION vector;`
- Column size must match embedding model exactly → `VECTOR(3072)` for `gemini-embedding-001`
- Three operators:
  - `<=>` cosine distance — **the one I use**, basically `1 - cosine_similarity`
  - `<->` euclidean distance
  - `<#>` negative inner product (needs normalized vectors)
- Query pattern: `ORDER BY embedding <=> queryVector LIMIT N` → sort by closeness, take top N
- Same cosine math as topic 01, just run inside the DB in C instead of a JS loop
- Indexes (HNSW / IVFFlat) → only matter at large scale (100k+ rows), not needed yet
- Free hosting: Neon or Supabase (pgvector built in)
- **Status:** haven't actually run Step 1.2 hands-on yet — no Neon/Supabase setup done, no real query run
