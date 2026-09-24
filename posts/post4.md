# AI Backend Learning Journey — Day 4 Context (for LinkedIn + Twitter)

## Instructions for Claude

Use the `post-writer-sms` skill to write both a LinkedIn post and a Twitter/X post (or thread if the content warrants it) based on everything below. Tone: genuine, technical but accessible, showing real hands-on progress — not buzzwords, not "excited to announce." I'm a frontend/full-stack engineer learning AI backend development from scratch, documenting the journey publicly. This is day 4 — see `post1.md` (embeddings/pgvector), `post2.md` (Drizzle repository pattern), `post3.md` (PDF parsing internals) for continuity/callbacks if useful. LinkedIn can go longer and more narrative; Twitter should be tighter, punchier, possibly a short thread (3-5 tweets) hitting the same key beats. The "issues encountered and fixed" section below is good material for a "here's what actually went wrong today" angle — that kind of honesty tends to land better than a highlight reel.

---

## What I built and learned today

Continuing **DocMind** (upload a PDF, chat with it, generate a quiz — building it from scratch to actually understand AI backend concepts, not copy-paste tutorials). Today: finished the actual RAG indexing pipeline, and hit three real, separate problems along the way — a migration issue, a cross-client data bug, and a tooling config conflict. Documenting all three because the debugging is as much the lesson as the feature.

### 1. The core RAG pipeline: chunk → embed → store

Extended the `/upload` endpoint to do the real work instead of just extracting text:
- Split extracted PDF text into ~500-word chunks (deliberately simple — no semantic boundaries yet, just a fixed word count, since chunking *strategy* is a deeper topic saved for later)
- Embed each chunk (Gemini's embedding model)
- Store each chunk tagged with a `documentId`, so multiple uploaded PDFs never mix together in later searches — without this, a search on one PDF could return an answer sourced from a completely different PDF

Tested on a real 16,282-character PDF — correctly split into 6 chunks. Worked out *why* 6 specifically, not just accepted the number: chunking is measured in words, not characters. Roughly 6 characters per English word on average, so `16282 chars ÷ 6 ≈ 2700 words`, and `2700 ÷ 500 words-per-chunk = 5.4`, which rounds up to 6 — any leftover remainder always becomes its own smaller final chunk rather than being dropped.

Also built a proper `documents` table alongside the chunks — real per-document metadata (filename, file size, character count, chunk count, upload timestamp) instead of trying to derive it awkwardly from chunk rows later.

## Issues encountered and fixed today

Real problems, not manufactured ones — the kind that only show up once you actually run the thing against real data and real clients.

**1. A migration tool correctly refused to run, and that was the right call.**
Added a `documentId` column as `NOT NULL` to a table that already had test rows in it. Drizzle Kit (the migration tool) detected this was a genuine data-loss risk — existing rows with no value for a newly-required column — and demanded interactive confirmation before proceeding. My automated terminal couldn't answer an interactive prompt, so it errored out instead of guessing. Since the existing data was disposable test data, I cleared it and ran the schema change directly. The lesson that actually matters: in a real production migration with real user data, you never delete rows to dodge that warning — the correct sequence is add the column as nullable → backfill a real value into every existing row → *then* tighten it to `NOT NULL` in a second migration. Good to hit the warning and understand exactly why it exists, instead of just clicking past a scary prompt.

**2. "It works" was only true from one client.**
Uploaded a PDF through Postman, then opened the actual frontend — the document wasn't there. Not a backend bug (the data was genuinely stored correctly in Postgres, confirmed with a direct query) — it was an architecture gap. The frontend's document list lived only in React's in-memory state, populated exclusively by the frontend's *own* successful upload calls. It never once asked the backend "what documents actually exist" — so anything uploaded from outside that specific browser tab was invisible to it, permanently, even after a refresh. Fixed by adding a real `GET /documents` endpoint backed by the new `documents` table, and a `useEffect` on page load that fetches the actual current state instead of trusting only local memory. Now Postman, curl, and the browser all see the same reality.

**3. A tooling config file living outside the "official" source folder broke type-checking.**
Added `drizzle.config.ts` at the project root (required by the migration tool). My editor immediately flagged `process.env` inside it as an unrecognized variable — odd, since Node's types were already installed. Root cause: `tsconfig.json` had both `include: ["src"]` (only these files are part of the project) and `rootDir: "src"` (every file must physically live inside this folder) — and a root-level config file violates both by definition. Fixed by adding the file to `include` and dropping the now-unnecessary `rootDir` restriction, since it wasn't doing meaningful work outside of an eventual full production build step anyway.

## The bigger takeaway

None of these three were "the feature was broken" — the feature (chunk, embed, store) worked on the first real test. All three were the *edges* around the feature: what happens to existing data when the shape changes, what happens when more than one client talks to the same backend, and what happens when a tool lives outside the folder your config expects it to. Tutorials almost never show this layer, because tutorials are usually single-client, fresh-database, single-config-file demos. Real backend work is disproportionately about these edges, not the happy path.

## What's next

Step 2.3 — `POST /chat`: embed a user's question, search the stored chunks scoped to one document, hand the relevant ones to the LLM, return a grounded answer. The actual retrieval-and-generation half of RAG, built on everything indexed so far.
