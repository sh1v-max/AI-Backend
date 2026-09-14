# Indexing at Scale — the 2000-dimension limit

A real constraint discovered while reading a tutorial ([freeCodeCamp's RAG chatbot guide](https://www.freecodecamp.org/news/how-to-build-rag-chatbot-nodejs-gemini-pgvector/)), verified against pgvector's actual source/docs — not a hypothetical "gotcha," a real thing that affects this exact project if it ever needed to scale. Kept as its own file, separate from [README.md](README.md), because it's a "come back to this later" concern, not part of the core Step 1.2 lesson.

---

## The constraint

pgvector's two index types — **HNSW** and **IVFFlat** — both cap the standard `vector` column type at **2000 dimensions**. This isn't a soft recommendation, it's a hard limit baked into pgvector itself (`HNSW_MAX_DIM` / `IVFFLAT_MAX_DIM` constants, both set to 2000).

Our `chunks.embedding` column is `VECTOR(3072)` — because `gemini-embedding-001` outputs 3072-dimensional vectors. **3072 > 2000.** So neither index type can be built directly on this column, as currently defined.

Verified via web search against current pgvector documentation (2026) — this is accurate as of pgvector 0.7.0 and later, not outdated tutorial advice.

## Does this affect DocMind right now?

**No.** Without an index, Postgres falls back to a **sequential scan** — it checks the distance (`<=>`) from the query vector to every single row, then sorts and returns the closest. This is exactly what topic 02's main README already anticipated when it said indexes are a "come back later" detail: for a handful of documents' worth of chunks (tens to low thousands of rows), a full scan is fast enough that you won't notice any difference in practice. Every `searchSimilar()` call you've made so far — including the 10-sentence test in Step 1.3 — has been running as a full scan the whole time, and it worked fine.

This only becomes a real problem at **production scale** — hundreds of thousands or millions of rows, where a full scan on every search becomes measurably slow. DocMind, as scoped by this roadmap, will never get there.

## Why the limit exists (briefly)

HNSW and IVFFlat are **approximate nearest-neighbor** algorithms — they build an index structure (a graph, for HNSW; clustered buckets, for IVFFlat) that lets a search skip most rows instead of checking every one. Building and querying that structure efficiently has practical limits tied to vector size; pgvector's maintainers capped it at 2000 dimensions for the standard `vector` type as a tradeoff between usefulness and index-building cost/complexity.

## If DocMind ever needed to scale — three real fixes

**Option 1 — `halfvec` (half-precision vectors)**

pgvector also has a `halfvec` type, which stores each number at half precision (16-bit float instead of 32-bit) and, as a result, doubles the index limit to **4000 dimensions** — enough to cover our 3072-dimensional vectors.

```sql
-- instead of:
embedding VECTOR(3072)

-- use:
embedding HALFVEC(3072)

CREATE INDEX ON chunks USING hnsw (embedding halfvec_cosine_ops);
```

Tradeoff: lower numeric precision per dimension, which can very slightly reduce search accuracy — in practice, usually negligible for semantic search, since embeddings are already approximate by nature.

**Option 2 — switch to a lower-dimension embedding model**

The tutorial's own suggestion: OpenAI's `text-embedding-3-small` outputs 1536 dimensions, comfortably under the 2000 limit for the standard `vector` type — no `halfvec` needed, HNSW/IVFFlat both work directly.

This is a real architectural decision some teams make *specifically because of this constraint* — choosing an embedding model partly based on its output dimension, not purely on quality. Switching models mid-project is a real migration cost though (every stored embedding would need to be regenerated, since embeddings from different models aren't comparable to each other) — not something to do lightly once data exists.

**Option 3 — do nothing, stay on full scan**

Legitimate at DocMind's scale. Full scan is simple, always exactly accurate (not "approximate" like HNSW/IVFFlat), and only becomes a real bottleneck at a scale this project will never reach. The "fix" here is just knowing *when* it would become necessary — a rough rule of thumb from the pgvector community: start considering an index once a table's row count climbs into the hundreds of thousands.

## Interview-relevant summary

If asked "why doesn't your vector column have an index, and what would you do about it at scale" — this is the answer: full scan is correct and fast enough at current scale; the standard `vector` type actually can't be indexed past 2000 dimensions with our 3072-dim embeddings; the real fix at scale would be `halfvec` (keep the same embedding model, accept a small precision tradeoff) or switching to a lower-dimension embedding model (bigger migration cost, no precision tradeoff). Knowing this tradeoff exists — and being able to name the actual numbers — is worth more in an interview than pretending indexing was never a concern.

## Related

- [README.md](README.md) — the main topic 02 doc, where indexes were first mentioned as "know it exists, don't over-focus yet"
- [topics/advanced/03-token-counting-cost](../advanced/03-token-counting-cost/NOTES.md) — a similar "cost/scale tradeoff you don't need yet but should know" topic
