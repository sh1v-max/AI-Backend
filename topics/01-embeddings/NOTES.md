# 01: Embeddings, In My Own Words

Roadmap: Phase 1, Step 1.1 · Code: [src/step1-embeddings.ts](../../src/step1-embeddings.ts) · Shared version now: [src/services/embeddings.service.ts](../../src/services/embeddings.service.ts)

## What an embedding actually is, simply

A computer can't compare the *meaning* of two sentences. It can only compare numbers. So an embedding model turns a piece of text into a long list of numbers, and it does it in a way where sentences that mean similar things end up with similar lists. That's it. Everything else in this project (search, RAG, even the quiz) sits on top of that one idea.

I used Gemini's `gemini-embedding-001`, and every piece of text comes back as **3072 numbers**. Doesn't matter if it's one word or a whole paragraph, always 3072. (The roadmap mentions `text-embedding-004` with 768 numbers, that model got retired, so I'm on the newer one.)

## Things that surprised me

- The individual numbers mean nothing on their own. Number #42 isn't "catness" or anything. Only the *position* of the whole list compared to other lists matters.
- It's one way. You can't turn the 3072 numbers back into the original sentence.

## Cosine similarity, written by hand

Didn't import a library for this on purpose, I wanted to actually type the formula once:

```
cosine_similarity(a, b) = dot(a, b) / (|a| * |b|)
```

- `dot(a, b)` = multiply each matching pair of numbers and add them all up
- `|a|` = square every number, add them, take the square root (the "length" of the vector)
- result goes from -1 to 1. 1 = same meaning, around 0 = unrelated, -1 = opposite

Why cosine and not just subtracting the numbers: cosine looks at the *direction* the vectors point, not how long they are. Direction is where the meaning lives.

## Confirmed by actually running it

- [x] "cat sat on mat" vs "kitten on rug" → **0.7628**
- [x] "cat sat on mat" vs "stock market crashed" → **0.5879**
- [x] The similar pair scored higher, so the whole idea actually works, not just in theory

## What still feels a little shaky

- The unrelated pair still scored 0.58, not close to 0. So "unrelated" doesn't mean near zero with this model, it means *lower than the related ones*. Scores only make sense compared to each other, not as absolute numbers.
