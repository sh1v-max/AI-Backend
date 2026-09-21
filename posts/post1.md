# My AI Backend Learning Journey — Context for Social Posts

Background: I'm a frontend/full-stack engineer (know Node.js, Express, MongoDB, JWT, Zod, TypeScript) learning AI backend development from scratch. Building a project called **DocMind** — upload a PDF, chat with it, generate a quiz from it — to learn the real concepts behind RAG, vector search, and AI agents, not just copy-paste tutorials.

Following a self-made roadmap, one concept at a time: learn the theory → build the smallest possible version → move on. Writing my own notes after each step instead of just running code and moving on.

---

## What I've learned so far

### 1. Embeddings (the foundation)

- An embedding turns text into a list of numbers (a vector) — similar-meaning text ends up with similar numbers
- Used Gemini's `gemini-embedding-001` model → every sentence becomes a **3072-number vector**, regardless of whether it's one word or a paragraph
- The individual numbers mean nothing on their own — only their *position relative to other vectors* matters
- Embeddings are one-way — you can't turn a vector back into the original text
- Wrote **cosine similarity by hand**, no library: `dot(a,b) / (|a| * |b|)` — this measures the *angle/direction* between two vectors, not their length, which is why it's the right tool for "how similar in meaning" rather than raw distance
- Proved it works: "cat sat on mat" vs "kitten on rug" scored 0.76 similarity; "cat sat on mat" vs "stock market crashed" scored 0.59 — similar meaning really does score higher

### 2. Vector Search with Postgres + pgvector

- `pgvector` is a Postgres **extension**, not a separate database — it adds a `vector` column type and distance operators directly to SQL
- Set up a free **Neon** Postgres instance, ran `CREATE EXTENSION vector;`
- Created a `chunks` table with a `VECTOR(3072)` column — the size has to exactly match the embedding model's output
- The key insight: `pgvector`'s `<=>` operator is doing the **exact same cosine math I wrote by hand** in step 1 — just running inside the database, at scale, instead of a JS loop
- Learned the query pattern that underlies all semantic search: `ORDER BY embedding <=> queryVector LIMIT N` — "sort everything by how close it is in meaning, take the top N"
- Built a real script: embedded 10 sentences across 4 topics (cats, finance, coding, cooking), inserted them into Postgres, then embedded a brand-new query sentence ("a cat napping on a blanket") and searched for the closest matches — got back the two cat-related sentences, correctly ranked, ignoring the unrelated ones
- Learned about the other two pgvector operators too (`<->` euclidean, `<#>` inner product) and that indexes like HNSW/IVFFlat exist for when there's a lot more data — not needed yet at this scale

## The bigger idea connecting both steps

Normal databases search by *exact match* (`WHERE title LIKE '%cat%'`) — they can't find "kitten" when you search "cat" because the words are different, even though the meaning is close. Embeddings + vector search change what "search" means — from matching characters to matching **meaning**. That's the entire foundation RAG (retrieval-augmented generation), semantic search, and AI agent "intent routing" are all built on top of.

## What's next

- Wrapping the raw SQL in typed repository functions (Drizzle ORM)
- Then: parsing real PDFs, chunking them, and building the actual RAG chat pipeline for DocMind

---

*Feel free to turn this into a LinkedIn/Twitter post about my AI backend learning journey — tone: genuine, technical but accessible, showing real progress and hands-on understanding, not just buzzwords.*
