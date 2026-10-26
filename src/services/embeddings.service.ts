const API_KEY = process.env.GEMINI_API_KEY
const EMBED_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent'

export async function getEmbedding(text: string): Promise<number[]> {
  const res = await fetch(`${EMBED_URL}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: { parts: [{ text }] },
    }),
  })

  if (!res.ok) {
    throw new Error(`Gemini API error: ${res.status} ${await res.text()}`)
  }

  const data = await res.json()
  return data.embedding.values
}

// AG.1 — many texts in ONE request (the router's ~30 example phrases, the
// eval's 40 messages). Same model and same settings as getEmbedding() above
// (no taskType), which matters: the router compares a message embedded by
// getEmbedding() against phrases embedded here, and vectors made differently
// aren't comparable (More_on §28). step7 checks that the two give the same
// vector for the same text.
//
// The API takes up to 100 texts per call; every caller here sends fewer.
//
// One call, but NOT one request for the rate limit: measured in AG.1, each
// text in the batch counts as one request against the free tier's 100
// embedding requests/minute (two eval runs back to back = 28 + 41 + 1 + 28 +
// 41 → 429 "embed_content_free_tier_requests, limit: 100"). So a batch saves
// round trips and latency, not quota. The router's ~28 phrases cost 28 of the
// minute's 100, once per process.
const BATCH_EMBED_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents'

export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []

  const res = await fetch(`${BATCH_EMBED_URL}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // one request object per text; the model name is repeated in each
      requests: texts.map((text) => ({
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text }] },
      })),
    }),
  })

  if (!res.ok) {
    throw new Error(`Gemini API error: ${res.status} ${await res.text()}`)
  }

  // the vectors come back in the same order as the texts went in
  const data = (await res.json()) as { embeddings: { values: number[] }[] }
  return data.embeddings.map((e) => e.values)
}