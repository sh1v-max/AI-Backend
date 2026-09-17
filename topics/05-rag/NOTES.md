# 05 — RAG (Retrieval-Augmented Generation) — In My Own Words

Roadmap: Phase 2, Steps 2.2 & 2.3 · Guide: [README.md](README.md)

## What RAG actually is, simply

The AI doesn't magically "know" my PDF. It's never seen it. So instead of asking it a question and hoping it guesses right, I find the actual pieces of my document that are relevant, and hand those to the AI along with my question. It's basically open-book exam vs. closed-book exam — I'm giving it the book, open to the right page, instead of asking it to answer from memory.

One line I keep coming back to: **"instead of the model guessing, I hand it the relevant text right before asking."**

## The two halves, in plain terms

- **Offline (happens once, when I upload)**: chop the PDF into pieces (chunks), turn each piece into numbers (embed), save them.
- **Online (happens every time I ask something)**: turn my question into numbers too, find which saved pieces are numerically "closest" to my question, hand those pieces + my question to the AI, get an answer back.

I built the offline half first (Step 2.2), then the online half (Step 2.3) — and honestly, once the offline half worked, the online half felt easy, because it reuses the exact same `searchSimilar()` function from way back in Step 1.3. Nothing new to learn there, just pointed at real data instead of test sentences.

## Why chunking exists (in my own words)

If I embedded the *whole* PDF as one giant vector, it'd be like asking "what's the vibe of this entire book" — too blurry to answer a specific question. Chunking keeps pieces small enough that a search can point at the *exact paragraph* that answers my question, not just "somewhere in this document."

## Why `documentId` matters — I actually felt this one

Once I had two PDFs uploaded, I realized: without tagging each chunk with which document it came from, a question about PDF A could accidentally get answered using a chunk from PDF B. That's not a hypothetical — that's literally why `documentId` filtering exists on `searchSimilar()`. Scoped search = no cross-contamination between documents.

## The prompt — what actually keeps it honest

The instruction I send along with the context basically says "only use this text, don't make stuff up." I tested this myself — asked it "who's the president of India" against a resume PDF, and it correctly said it doesn't know, instead of just guessing from its own training data. That one test taught me more about grounding than any explanation could.

Later I also learned: telling it to "answer using only this context" made it say "Based on the provided context..." before every single answer, which got repetitive fast. Fixed by explicitly telling it to answer naturally and only mention the document when it's actually relevant to say so.

## Confirmed by actually running it

- [x] Uploaded a 16k-character PDF → got 6 chunks, embedded and stored
- [x] Asked a real question about my resume → got an accurate answer, correctly grounded
- [x] Asked an off-topic question → got an honest "I don't know" instead of a hallucinated guess
- [x] Two different uploaded documents stayed correctly separated in search results

## What still feels shaky

- Chunking is dumb right now — just cuts every 500 words, no regard for sentences or paragraphs. Known and fine for now, real fix comes later.
- It doesn't yet know the difference between "ask about the document" and "just being chatty" — it'll run the whole search pipeline even for smalltalk. That's a later problem (agents/intent routing), not something I need to fix in RAG itself.
