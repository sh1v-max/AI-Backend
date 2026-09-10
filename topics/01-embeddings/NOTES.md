# 01 — Embeddings — Quick Revision

Roadmap: Phase 1, Step 1.1 · Code: [src/step1-embeddings.ts](../../src/step1-embeddings.ts)

- **Embedding** = text → list of numbers, similar meaning → similar numbers
- Model used: `gemini-embedding-001` → **3072 numbers** per embedding (not 768, that model's retired)
- Individual numbers mean nothing alone — only their *position relative to other vectors* matters
- One-way: can't turn a vector back into text
- Same length output regardless of input length (1 word or 1 paragraph → still 3072 numbers)
- **Cosine similarity** = `dot(a,b) / (|a| * |b|)` — measures angle/direction, not magnitude
  - `dot(a,b)` → multiply matching positions, sum them
  - `|a|` → `sqrt(sum of each number squared)`
  - Range: -1 to 1 → 1 = same meaning, 0 = unrelated, -1 = opposite
- Why cosine not raw subtraction → cares about *direction* (meaning), ignores vector length
- **Confirmed by running the script:**
  - "cat sat on mat" vs "kitten on rug" → **0.7628**
  - "cat sat on mat" vs "stock market crashed" → **0.5879**
  - Similar pair scored higher ✅
