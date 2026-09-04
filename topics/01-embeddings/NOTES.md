# 01 — Embeddings

Roadmap: Phase 1, Step 1.1 · Code: [src/step1-embeddings.ts](../../src/step1-embeddings.ts)

## What is an embedding?

_write this in your own words once step1 runs and makes sense_

## Key facts

- A sentence becomes a list of numbers (768 numbers for `text-embedding-004`)
- Similar-meaning sentences → similar numbers (close vectors)
- Similarity is measured with cosine similarity: `dot(a,b) / (|a| * |b|)`

## Questions / things that felt unclear

-

## Confirmed by running the script

- [ ] Similar pair scored higher than the unrelated pair
