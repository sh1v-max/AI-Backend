# 01 — Embeddings

The foundation everything else in this project sits on. Skip this and RAG, vector search, and intent routing will all feel like magic later. Understand this and they'll feel obvious.

---

## What is an embedding?

An embedding is a piece of text turned into a list of numbers — a **vector** — in such a way that texts with similar *meaning* end up with similar numbers.

```
"The cat sat on the mat"        → [0.12, -0.44, 0.81, ..., 0.09]   (768 numbers)
"A kitten was resting on the rug" → [0.14, -0.41, 0.79, ..., 0.11]   (768 numbers, close to the first)
"The stock market crashed"      → [-0.63, 0.22, -0.05, ..., 0.87]  (768 numbers, far from both above)
```

That's the entire concept. Everything else — RAG, semantic search, intent routing, recommendation systems — is built on top of this one fact: **you can turn "meaning" into "distance between numbers."**

## Why does this matter for a backend?

Normal databases search by *exact* or *pattern* matching — `WHERE title LIKE '%cat%'` only finds the literal word "cat." It won't find "kitten" or "feline" even though they mean almost the same thing.

Embeddings let you search by **meaning** instead of by keyword. That's the whole unlock:
- A user asks "how do I reset my password" → you find help docs about "account recovery" even though no words overlap
- A user uploads a PDF and asks a question → you find the *relevant paragraph*, not just paragraphs containing the same words
- A chatbot decides "is this a question about the document, or just small talk" → by comparing the message's meaning to a few example categories

You're not writing a smarter keyword search. You're changing what "search" means — from character matching to meaning matching.

## How does text become numbers?

An embedding model (a smaller, specialized neural network — not the same as a chat model like Gemini/Claude) reads text and outputs a fixed-length vector. You don't design this vector or know what each number "means" individually — the model learned, from huge amounts of text, to place similar meanings near each other in this number-space during its training.

Key facts to actually internalize:
- The vector length is fixed per model (e.g. Gemini's `text-embedding-004` outputs 768 numbers, always — a one-word input and a full paragraph both come back as 768 numbers)
- Embedding a short sentence and a long paragraph costs about the same — it's one API call either way
- The model is deterministic-ish: the same text embedded twice gives you (approximately) the same vector
- You cannot reverse an embedding back into the original text — it's one-way

## Measuring "how similar" — cosine similarity

Once you have two vectors, you need a way to score how close they are. The standard tool is **cosine similarity** — it measures the angle between two vectors, ignoring their length/magnitude.

```
cosine_similarity(a, b) = dot(a, b) / (|a| × |b|)
```

- `dot(a, b)` — multiply each pair of numbers and sum them up
- `|a|` — the magnitude (length) of vector a: `sqrt(sum of each number squared)`
- Result ranges from **-1 to 1**: `1` = identical meaning/direction, `0` = unrelated, `-1` = opposite

Why cosine and not just "subtract the vectors"? Because we care about *direction* (what the text means) not *magnitude* (how "intense" the vector's numbers happen to be) — two vectors pointing the same way but different lengths should still score as similar.

You're writing this formula by hand in Step 1.1 on purpose — once you've typed `dot / (magA * magB)` yourself, the `<=>` operator you'll see in Postgres/pgvector in the next topic stops being a mystery symbol and becomes "oh, that's just this math, done inside the database."

## Where this goes next (so you know why you're learning it)

```
01 (you are here)     → embed two sentences, compare them by hand
02 vector search       → store many embeddings in Postgres, let the DB do this math fast, for thousands of vectors
03 repository pattern  → wrap that in clean, typed functions
05 RAG                 → embed a user's question, find the closest chunks of a document, hand them to the LLM
10 agents/intent       → embed a message, compare it against a few known "intents" instead of asking the LLM to classify every time
```

Every one of those is the same cosine-similarity idea, applied to a bigger dataset or a different use case. Nothing new conceptually — just scale.

---

## What you need to learn

- [ ] **The one-sentence definition** — text → numbers, similar meaning → similar numbers. Be able to say this without looking it up.
- [ ] **What "768 numbers" actually represents** — not individually meaningful, but their *relative position* to other vectors is
- [ ] **The cosine similarity formula** — know what dot product and magnitude mean, not just that a function exists
- [ ] **Why cosine, not raw distance** — direction vs magnitude
- [ ] **The idea that embedding ≠ generation** — a dedicated embedding model (`text-embedding-004`) is a different, smaller, cheaper model than a chat model (Gemini/Claude) — you'll use both in this project, for different jobs
- [ ] **Embeddings are one-way** — you can't decode a vector back to text

## What to build (Step 1.1 of the roadmap)

A plain Node script — **no server yet**. See [src/step1-embeddings.ts](../../src/step1-embeddings.ts):

1. Call the Gemini embeddings API on two pairs of sentences — one similar pair, one unrelated pair
2. Print the raw number arrays (just to see them — they'll mean nothing visually, and that's fine, that's the point)
3. Write the cosine similarity formula yourself, no library
4. Confirm: similar pair scores higher than the unrelated pair

Run it: `npm run step1` (needs `GEMINI_API_KEY` in `.env` — get one free at [Google AI Studio](https://aistudio.google.com/))

## Resources

- [pgvector Tutorial – DataCamp](https://www.datacamp.com/tutorial/pgvector-tutorial) (read only, ~20 min — skip the Postgres parts for now, just the embeddings intro)
- [18 Months of Pgvector Learnings in 47 Minutes (YouTube)](https://www.youtube.com/watch?v=Ua6LDIOVN1s)
- [Gemini API docs – Embeddings](https://ai.google.dev/gemini-api/docs/embeddings)

## After you finish

Fill in [NOTES.md](NOTES.md) in your own words — that's what actually locks the concept in, not just running the script successfully.
