# Advanced 02 — Chunking Strategy

**Roadmap: Phase 12** · **Revisits:** Step 2.2 (upload → chunk → embed → store) · **Status in DocMind:** the simplest possible chunker is live, a 12-line fixed-size splitter with no overlap. The roadmap said "don't overthink chunking", which was right for building. This file is the tradeoffs an interviewer will ask about.

Model limits and "typical" numbers below vary by model and change over time. Treat them as starting points to measure against, not facts to quote.

Code this file talks about: [chunkText.ts](../../../src/utils/chunkText.ts), [ingestion.service.ts](../../../src/services/ingestion.service.ts) (`ingestPdf`), [chunks.repository.ts](../../../src/repositories/chunks.repository.ts) (`searchSimilar`, `sampleChunks`), [chat.service.ts](../../../src/services/chat.service.ts)

---

# 1. What is Chunking?

A PDF is too big to embed as one vector or to paste into every prompt. So it's cut into pieces:

```text
PDF text (50,000 words)
        ↓ chunk
[chunk 0] [chunk 1] [chunk 2] ... [chunk 99]
        ↓ embed each
[vector 0] [vector 1] ...
        ↓ store
searchable
```

At question time, only the few most similar chunks are retrieved and given to the model.

> **A chunk is the unit of retrieval.** Whatever you cut is what you can find, and what the model gets to read.

---

# 2. Why It Matters So Much

```text
bad chunking → wrong or partial chunks retrieved → wrong or partial answer
```

The model can only answer from what it was handed. Retrieval quality puts a ceiling on answer quality, and chunking is the first thing that decides retrieval quality.

It's also the most *boring-looking* part of a RAG system, which is exactly why it's a good interview question: it separates people who built one from people who watched a tutorial.

---

# 3. Simple Analogy

You're making index cards from a textbook so you can find things later.

* **One card per chapter**: the card is about ten things at once. Its "topic" is a blur. And reading it takes forever.
* **One card per sentence**: each card is precise, but "It increased by 40% that year" means nothing on its own. What increased? Which year?
* **One card per paragraph**, with the section title written at the top: precise *and* self-contained.

Chunking is deciding where to cut the cards, and what to write at the top of each.

---

# 4. What DocMind Does Today

```ts
export function chunkText(text: string, wordsPerChunk = 500): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const chunks: string[] = []
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    chunks.push(words.slice(i, i + wordsPerChunk).join(' '))
  }
  return chunks
}
```

What that means concretely:

* **Fixed size**: every 500 words, cut. No matter what's there.
* **No overlap**: chunk 2 starts exactly where chunk 1 ended.
* **Structure destroyed**: `split(/\s+/)` then `join(' ')` flattens every newline. Paragraph breaks, headings, list items, and table rows all become one run of words.
* **No metadata**: a chunk row is `content`, `embedding`, `document_id`. No page number, no section, no position (order is implied by the serial `id`).
* **The last chunk** can be tiny (a 1,003-word document gives 500 + 500 + 3).

And at query time: top **3** chunks, so roughly 1,500 words of context per question.

It works. The limits are the next sections.

---

# 5. The Core Tradeoff: Chunk Size

```text
SMALL chunks (100–200 words)             LARGE chunks (800–1500 words)
─────────────────────────────            ──────────────────────────────
+ each is about ONE thing                + enough context to make sense
+ precise similarity matches             + fewer chunks, fewer embedding calls
+ less irrelevant text in the prompt     − the vector is an AVERAGE of many topics
− may lack context to be understood      − a specific question matches weakly
− an answer may span several chunks      − lots of irrelevant text in the prompt
− more rows, more embedding calls        − may exceed the embedding model's limit
```

Why large chunks match weakly: one embedding has to represent the whole chunk. If a 500-word chunk covers pricing, refunds, and shipping, its vector sits somewhere *between* those topics. A sharp question about refunds is only a partial match. That effect is sometimes called **dilution**.

There's no universally right size. It depends on the documents and the questions:

| Content | Tends to want |
|---|---|
| FAQ, short facts, definitions | small |
| Narrative, explanations, legal clauses | medium to large |
| Code | split by function/class |
| Tables | keep the whole table together |

Commonly used starting points are a few hundred tokens with some overlap. **Start there and measure** ([advanced/04](../04-evaluation/More_on_Evaluation.md)).

---

# 6. The Boundary Problem and Overlap

Fixed cuts land in the middle of things:

```text
chunk 4: "...The refund window is 30 days from delivery. To qualify, the item"
chunk 5: "must be unused and in original packaging. Refunds are issued to..."
```

The question "what are the conditions for a refund?" needs both halves. Neither chunk has the complete answer, and each is a weaker match than the whole sentence would be.

**Overlap** repeats the end of one chunk at the start of the next:

```text
chunk 4: words 0   – 500
chunk 5: words 450 – 950      ← 50 words shared with chunk 4
chunk 6: words 900 – 1400
```

Now anything cut at a boundary appears whole in at least one chunk.

Adding it to `chunkText` is a small change:

```ts
export function chunkText(text: string, wordsPerChunk = 500, overlap = 50): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const step = wordsPerChunk - overlap            // must be > 0
  const chunks: string[] = []
  for (let i = 0; i < words.length; i += step) {
    chunks.push(words.slice(i, i + wordsPerChunk).join(' '))
    if (i + wordsPerChunk >= words.length) break  // don't emit a tail that's pure overlap
  }
  return chunks
}
```

Costs of overlap:

* more chunks → more embedding calls and storage (10% overlap ≈ 11% more chunks)
* near-duplicate text can be retrieved twice, wasting prompt space
* `sampleChunks` for quizzes would see repeated material

Typical overlap: 10–20% of the chunk size.

---

# 7. Chunking Strategies

From simplest to most involved.

### 7.1 Fixed-size (what DocMind has)

Cut every N words / characters / tokens. Trivial, predictable, ignores meaning.

### 7.2 Fixed-size with overlap

Same, with §6's overlap. The cheapest real improvement.

### 7.3 Sentence-aware

Split into sentences first, then pack sentences into a chunk until the size limit. Never cuts mid-sentence.

### 7.4 Recursive splitting (the common default)

Try the biggest natural separator first; only fall back to smaller ones when a piece is still too large:

```text
split on "\n\n" (paragraphs)
   piece too big? → split on "\n" (lines)
      still too big? → split on ". " (sentences)
         still too big? → split on " " (words)
```

Then merge small neighbours back up to the target size. Result: chunks end at the most natural boundary available. This is what LangChain's `RecursiveCharacterTextSplitter` does, and it's about 40 lines to write yourself.

**Prerequisite:** the text must still have its newlines. DocMind's `split(/\s+/)` throws them away, so a recursive splitter would need the raw `result.text` from `pdf-parse`, not the whitespace-flattened version.

### 7.5 Structure-aware

Use the document's own structure: headings, sections, list items, markdown headers, HTML tags, PDF pages.

```text
## Refund Policy          ← a chunk boundary, and a title to attach to its chunks
...
## Shipping
...
```

Best quality when structure is available. PDFs are the hard case: a PDF stores positioned glyphs, not "this is a heading". Extracting structure means layout-aware parsing.

### 7.6 Semantic chunking

Embed every sentence, then cut where the similarity between neighbouring sentences drops (a topic change).

```text
s1 ─ s2 ─ s3 ┊ s4 ─ s5 ┊ s6 ─ s7 ─ s8
            drop      drop
```

Chunks follow topics instead of word counts. Cost: an embedding call per sentence at ingestion, and sizes become uneven. Often not better enough than recursive splitting to justify it. Measure before adopting.

### 7.7 LLM-based / agentic chunking

Ask a model to split the document into self-contained sections. Highest quality potential, slowest and most expensive, and non-deterministic.

---

# 8. Adding Context to Chunks

A chunk cut out of a document loses its surroundings:

```text
"It increased by 40% that year."
```

Fixes, cheapest first:

**Metadata prefix.** Put the document title and section heading at the top of the chunk text before embedding:

```text
[Annual Report 2024 › Revenue]
It increased by 40% that year.
```

Now both the embedding and the model know what "it" refers to.

**Parent–child (small-to-big) retrieval.** Embed **small** chunks for precise matching, but hand the model the **larger parent** section they came from.

```text
search over: small child chunks (precise)
return:      the parent section (complete)
```

Precision of small, context of large. Needs a `parent_id` column.

**Sentence-window retrieval.** Same idea: match on one sentence, return it plus N sentences either side.

**Contextual retrieval.** At ingestion, an LLM writes one or two sentences situating each chunk within the whole document, and that's prepended before embedding. Effective; costs an LLM call per chunk.

**Late chunking.** Embed the whole document with a long-context embedding model, then pool token embeddings per chunk, so each chunk's vector already "knows" the rest of the document. Needs a model and API that support it.

---

# 9. Metadata Worth Storing

DocMind stores only `content`, `embedding`, `document_id`. Useful additions:

| Column | What it enables |
|---|---|
| `chunk_index` | explicit order (instead of relying on serial `id`); fetch neighbours |
| `page_number` | citations like "page 12"; a "jump to page" link |
| `section` / `heading` | better citations, filtering |
| `token_count` | budget the prompt precisely |
| `content_hash` | skip re-embedding unchanged chunks |
| `embedding_model` | know which chunks need re-embedding after a model change |

`chunk_index` enables a neat trick: after retrieving chunk 17, also fetch 16 and 18. That fixes boundary problems at **query** time, without re-ingesting anything.

`pdf-parse` v2 can give text per page as well as the combined `text` (check the shape of the `getText()` result in its docs), so page numbers should be available at parse time; `ingestPdf` only uses `result.text`.

---

# 10. Limits That Constrain Chunk Size

**The embedding model's input limit.** Every embedding model accepts at most N tokens. Text beyond the limit is either rejected or **silently truncated**: the tail of the chunk simply isn't represented in the vector. Check the current limit for `gemini-embedding-001` in the docs.

500 English words is roughly 650–700 tokens, comfortably inside typical limits. But word-based chunking is only a proxy:

* code, URLs, numbers, and non-English text can be far more tokens per word
* text with no spaces (some languages, or a broken PDF extraction) can turn "one word" into thousands of tokens

Token-based chunking (count tokens, not words) is the precise way. See [advanced/03](../03-token-counting-cost/More_on_Tokens_Cost.md).

**The LLM's context window.** `top_k × chunk_size` plus history plus instructions must fit. For DocMind: 3 × ~700 tokens ≈ 2,100 tokens of context. Tiny against a modern context window. So the window isn't the constraint; **cost and attention** are (§11).

---

# 11. Chunk Size and `top_k` Are One Decision

```text
context given to the model = top_k × chunk_size
```

| Config | Context | Character |
|---|---|---|
| 3 × 500 words (today) | ~1,500 words | few, broad pieces |
| 8 × 200 words | ~1,600 words | more, sharper pieces from more places |
| 3 × 1,500 words | ~4,500 words | lots of text, much of it irrelevant |

Same budget can be spent as "few large" or "many small". Many-small usually wins for specific questions because the evidence can come from more places in the document.

Why not just send 20 chunks? More context isn't free:

* more tokens → higher cost and latency on every request
* the relevant passage gets buried among irrelevant ones, and models use the middle of a long context less reliably
* more chances for a conflicting or misleading passage

This matters more in DocMind's all-documents mode: the top 3 are shared across **all** PDFs, so one document can take all three slots. That's the known Step 3.3 tradeoff.

---

# 12. Different Tasks Want Different Chunks

DocMind already has two consumers of the same chunks:

```text
chat  → searchSimilar()  → wants chunks that are precise for ONE question
quiz  → sampleChunks()   → wants broad, representative coverage, in reading order
```

Small precise chunks help chat. For a quiz, five 150-word chunks would be thin material for five questions. So one chunk size is already a compromise between two features.

Other tasks have other needs: summarising a whole document doesn't want retrieval at all (it wants map-reduce over all chunks, or a long-context model).

---

# 13. Beyond Chunking: Retrieval Add-Ons

These aren't chunking, but they're the usual next answers when "how would you improve retrieval?" comes up.

**Hybrid search.** Vector search finds meaning; keyword search (BM25, Postgres full-text) finds exact terms. Embeddings are weak at exact identifiers: product codes, names, error numbers, rare acronyms. Run both and merge the rankings (reciprocal rank fusion). Postgres can do both in one database (`tsvector` + pgvector).

**Reranking.** Retrieve a wider set (say 20) cheaply with vectors, then use a more accurate model (a cross-encoder reranker, or an LLM) to pick the best 3.

```text
vector search → 20 candidates → reranker → top 3 → prompt
```

**Relevance threshold.** Don't send a chunk whose distance is too high, even if it's in the top 3. Today the top 3 are always sent, however bad. That's PI.6 in [prompt-improvement.md](../../../prompt-improvement.md).

**Query rewriting.** Fix the *query* instead of the chunks (PI.1).

**Diversity (MMR).** Avoid returning three near-identical chunks; trade a little relevance for coverage. More relevant once overlap exists.

---

# 14. PDF-Specific Problems

Chunking quality is capped by extraction quality. Garbage in, garbage chunks.

* **Headers and footers** repeat on every page and end up mid-chunk: "…the refund window is Page 12 of 40 ACME Corp Confidential 30 days…"
* **Multi-column layouts** can be read straight across both columns, interleaving two unrelated texts.
* **Tables** become a stream of cell values with no structure.
* **Hyphenation** at line ends: "retrie-\nval".
* **Scanned PDFs** have no text layer at all. `pdf-parse` returns nothing; you'd need OCR. DocMind doesn't do OCR.
* **Images, charts, formulas** are lost.

Cheap improvements: strip lines that repeat on most pages, rejoin hyphenated words, drop chunks that are almost empty.

Always **look at actual chunks** from a real document before tuning anything. `ingestPdf` already prints a `preview` of every chunk at upload time, which is exactly the right habit.

---

# 15. Re-Chunking Is Expensive

Changing chunk size or strategy isn't a config flip:

```text
new chunking → every document must be re-parsed, re-chunked, RE-EMBEDDED, re-stored
```

Embedding is the costly part (one API call per chunk today), and old and new chunks shouldn't be mixed in one search.

Consequences:

* **DocMind doesn't keep the original PDFs or the extracted text.** Only chunks. So re-chunking isn't even possible without re-uploading. Storing the raw extracted text per document would fix that.
* Record `chunk_size`, `overlap`, and the strategy/version per document.
* Re-chunking a large corpus is a natural **background job** (topic 09).
* Decide before the corpus is large, and experiment on a small sample.

The same applies to changing the **embedding model**: vectors from different models aren't comparable, so everything must be re-embedded. (DocMind's docs still mention `text-embedding-004` / 768 dimensions in places; the code uses `gemini-embedding-001` / 3072. A change like that means re-embedding everything.)

---

# 16. How to Actually Choose

Not by opinion. By measuring.

```text
1. Write 15–20 real questions for a real document.
2. For each, note which passage contains the answer.
3. For each chunking config:
      ingest → run every question → is the right passage in the top k?
4. Compare hit rates. Read the misses.
5. Pick the config with the best hit rate at acceptable cost.
```

That's a retrieval evaluation ([advanced/04](../04-evaluation/More_on_Evaluation.md)). The misses teach more than the score: "the answer was cut across two chunks" → overlap. "The right chunk ranked 5th" → raise k or rerank. "The chunk had the answer but was 90% other topics" → smaller chunks.

Sensible order of experiments for DocMind, cheapest first:

1. add overlap (a few lines)
2. keep newlines and split on paragraphs/sentences (recursive)
3. retrieve more, smaller chunks (e.g. 5–8 × 200–300 words)
4. store `chunk_index` and fetch neighbours
5. prefix chunks with the filename / heading
6. hybrid search or reranking, only if measurement says retrieval is still the problem

---

# 17. Interview-Level Summary

If asked **"How do you chunk documents?"**:

> In my project, fixed-size chunks of about 500 words, which was a deliberate starting point. The known weaknesses are that it cuts mid-sentence, has no overlap so an answer split across a boundary is in neither chunk fully, and it flattens the document's structure. The next step would be recursive splitting on paragraph and sentence boundaries with 10–20% overlap, sized in tokens.

If asked **"What's the tradeoff in chunk size?"**:

> Small chunks give precise matches because each embedding represents one idea, but they can lack the context needed to be understood. Large chunks carry context but the embedding becomes an average of several topics, so specific questions match weakly, and more irrelevant text goes into the prompt. Chunk size and top-k are really one decision: together they set how much context the model gets.

If asked **"Why overlap?"**:

> So that information straddling a boundary appears complete in at least one chunk. The cost is more chunks to embed and store, and some duplicate text in results.

If asked **"What's semantic chunking?"**:

> Splitting where the meaning changes instead of at a fixed count: embed sentences and cut where similarity between neighbours drops. It follows topics, but costs many more embedding calls and isn't always better than a good recursive splitter, so I'd measure first.

If asked **"How do you get both precision and context?"**:

> Parent-child retrieval: embed small chunks for matching, but return the larger parent section to the model. Or store a chunk index and pull in the neighbouring chunks at query time.

If asked **"How would you decide on a strategy?"**:

> Empirically. A small set of real questions with the passages that answer them, then measure for each configuration whether the right passage lands in the top k. And read the failures, because they tell you which knob to turn.

If asked **"What else improves retrieval besides chunking?"**:

> Hybrid search, combining keyword and vector results, since embeddings are weak on exact identifiers. Reranking a wider candidate set. A relevance threshold so poor matches aren't sent. And rewriting follow-up questions into standalone ones before embedding.

---

# 18. Things to Remember

* The chunk is the unit of retrieval. Cut badly, find badly.
* One vector per chunk = an average. Big chunks blur.
* No overlap means boundary answers get split.
* `split(/\s+/)` destroyed the paragraph structure; structure-aware chunking needs it back.
* Word counts are a proxy for tokens. Sometimes a poor one.
* Embedding models may truncate silently.
* Changing chunking means re-embedding everything, and needs the original text.
* Look at real chunks. Measure with real questions.

---

# 19. Final Mental Model

```text
            DOCUMENT
               │
               ▼
        ┌─────────────┐
        │   EXTRACT   │  quality ceiling #1 (headers, columns, tables, scans)
        └─────────────┘
               │
               ▼
        ┌─────────────┐     SIZE      small = precise, less context
        │    CHUNK    │               large = context, blurry vector
        └─────────────┘     OVERLAP   protects boundaries, costs storage
               │            WHERE     fixed → sentence → paragraph → heading → topic
               │            CONTEXT   title/heading prefix, parent-child, neighbours
               ▼
        ┌─────────────┐
        │    EMBED    │  one vector per chunk (an average of its content)
        └─────────────┘
               │
               ▼
        ┌─────────────┐
        │  RETRIEVE   │  top_k × chunk_size = context budget
        └─────────────┘  (+ hybrid, rerank, threshold)
               │
               ▼
            PROMPT  →  answer can only be as good as what arrived here
```

**Chunking decides what can be found.**

**Size is a precision-vs-context dial; overlap protects the cuts.**

**Cut at natural boundaries when you can.**

**Small to match, big to read (parent-child).**

**Chunk size and top-k are one budget.**

**Don't argue about it. Measure it.**
