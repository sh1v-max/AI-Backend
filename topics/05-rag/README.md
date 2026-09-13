# 05 — RAG (Retrieval-Augmented Generation)

Every concept so far — embeddings, vector search, the repository pattern, PDF text extraction — exists to build toward this one idea. RAG is the actual reason this whole roadmap started with "what is an embedding." Once this clicks, the rest of DocMind is mostly plumbing.

---

## The problem RAG solves

An LLM like Gemini only knows what it learned during training, plus whatever text you put directly in the prompt. It has never seen your uploaded PDF — it can't answer questions about *your* document unless you hand it the relevant content yourself.

Two bad options if you don't:
- **Ask the LLM to answer from memory** → it either says "I don't have access to that document" (if honest) or **hallucinates** a plausible-sounding but wrong answer (if it guesses)
- **Paste the entire document into every prompt** → works for a 2-page PDF, breaks down for anything longer: wastes tokens (cost), can exceed the model's context window entirely, and dilutes relevance — the model has to find the needle in a much bigger haystack every single time

RAG is the fix: **retrieve** the specific pieces of the document relevant to *this* question, and hand only those to the LLM alongside the question. The model isn't guessing from memory or drowning in irrelevant text — it's answering from a small, targeted, relevant slice of context you selected for it.

Say the one-sentence version back to yourself, because it's worth memorizing verbatim: **"Instead of the model guessing from memory, I hand it the relevant text right before asking."** That's the entire idea. Everything else is implementation detail.

## The two halves of the pipeline

RAG has an **offline half** (happens once, when a document is uploaded) and an **online half** (happens every time a user asks a question). Confusing these two is the most common way to misunderstand RAG.

```
OFFLINE — once per document, no one is waiting
──────────────────────────────────────────────
PDF → extract text (topic 04, done) → chunk the text → embed each chunk
  → store (chunk text + its embedding + documentId) in Postgres (topics 01-03)

ONLINE — every time, a human is waiting
──────────────────────────────────────────────
user's question → embed the question → vector search stored chunks
  (filtered to this documentId) → take top 2-3 closest chunks
  → stuff into a prompt with the question → call the LLM → return the answer
```

**Step 2.2** (next up) builds the **offline half** — chunk, embed, store. **Step 2.3** builds the **online half** — embed the question, search, prompt, generate. This topic covers both conceptually since they're one idea split across two steps; you're about to build the first half.

## Why chunk at all?

You could embed the *entire* document as one vector and search on that — but a single embedding for a 10-page PDF blurs everything into one average "meaning," losing the ability to find the *specific paragraph* that actually answers a narrow question. Chunking keeps each stored piece small and focused enough that a search can point at the exact relevant section, not just "somewhere in this whole document."

The roadmap deliberately keeps chunking simple here — split by paragraph, or roughly every ~500 words. Not because it doesn't matter (chunk size *does* affect retrieval quality — too small loses context, too large dilutes relevance, same tension as the "database in a haystack" problem RAG itself solves), but because getting the end-to-end pipeline working correctly matters more right now than optimizing chunk boundaries. `topics/advanced/02-chunking-strategy` is where you'll come back to the tradeoffs (semantic chunking, overlap between chunks, etc.) once the basic version works.

## Tagging with `documentId`

Once you upload a second PDF, the `chunks` table has rows from multiple documents. Without a `documentId` column, searching would find the closest chunk across *every* uploaded document — meaning a question about PDF A could get answered using a chunk from PDF B. Tagging each chunk with the `documentId` it came from, and filtering `searchSimilar()` to just that document, keeps each document's Q&A isolated from every other one. This is also the earliest, smallest version of a real production concern: unscoped search leaking data across boundaries it shouldn't cross (the same root idea behind multi-tenancy, covered later in `topics/16-idempotency-multi-tenancy`).

## The retrieval + generation step (Step 2.3, coming after 2.2)

Once chunks are stored, answering a question looks like this:

```ts
const questionEmbedding = await getEmbedding(message)
const relevantChunks = await searchSimilar(questionEmbedding, 3) // top 3, filtered to documentId

const prompt = `Answer using only this context: ${relevantChunks.map(c => c.content).join('\n\n')}
Question: ${message}`

const answer = await callLLM(prompt)
```

Notice this reuses `searchSimilar()` from topic 03 — the exact same function, same `<=>` cosine-distance query, just now searching real document chunks instead of the 10 test sentences from Step 1.3. Nothing new to learn here mechanically; it's the same pattern applied to real data.

The prompt phrasing — "answer using only this context" — matters more than it looks. It's an instruction telling the model to ground its answer in the provided text rather than filling gaps from its own training knowledge, reducing (not eliminating) hallucination. This is the beginning of prompt engineering (`topics/advanced/01-prompt-engineering`) — how you phrase instructions to the model measurably changes its behavior.

## Where this goes next

```
01 embeddings, 02 vector search, 03 repository, 04 PDF parsing  → everything RAG is built from
05 (you are here)  → chunk + embed + store (2.2), then search + prompt + generate (2.3)
06 conversation memory → the missing piece: right now each question is answered in isolation,
                          with no memory of earlier turns in the conversation
```

---

## What you need to learn

- [ ] **The one-sentence definition of RAG** — hand the model relevant text right before asking, instead of it guessing from memory
- [ ] **Offline vs. online halves** — indexing (chunk/embed/store) happens once per document; retrieval (search/prompt/generate) happens once per question
- [ ] **Why chunking exists** — one embedding per whole document blurs meaning too much to find specific answers
- [ ] **Why `documentId` scoping matters** — without it, search can leak content across unrelated documents
- [ ] **The prompt shape** — context chunks + question, with an instruction to answer only from the given context

## What to build

**Step 2.2** (next): extend `/upload` to chunk the extracted text, embed each chunk, and store it via `insertChunk()`, tagged with a `documentId`. See `project_building_workthrough.md` Phase 2 for the exact steps.

**Step 2.3** (after that): build `/chat` — embed the incoming message, call `searchSimilar()` filtered to the document, build the prompt, call the LLM, return the answer.

## Resources

- [How to Build a RAG Chatbot with Node.js, Gemini, and pgvector – freeCodeCamp](https://www.freecodecamp.org/news/how-to-build-rag-chatbot-nodejs-gemini-pgvector/) — read the "retrieval + generation" section closely
- [RAG Pipeline: Complete Node.js Implementation Guide](https://dev.to/surajrkhonde/rag-pipeline-complete-nodejs-implementation-guide-1n54) — chunking strategy detail, useful later for the advanced pass
- [Gemini API docs – Text generation](https://ai.google.dev/gemini-api/docs/text-generation)

## After you finish

Fill in [NOTES.md](NOTES.md) once Step 2.2 (and later 2.3) actually work — specifically, be able to say in your own words why RAG needs two separate steps (indexing, then retrieval) instead of doing everything at question-time. That distinction is the one most likely to come up as a follow-up interview question.
