import 'dotenv/config'

// Step 1.1 — What is an embedding, really?
// We turn sentences into arrays of numbers, then measure how "close" those
// arrays are to each other. Similar-meaning sentences should land close together.

const API_KEY = process.env.GEMINI_API_KEY
const EMBED_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent'

async function getEmbedding(text: string): Promise<number[]> {
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
  // console.log(data.embedding.values)
  return data.embedding.values
}

// cosine similarity formula, it's a measure of how similar two vectors are, ranging from -1 (opposite) to 1 (identical)
// cosine_similarity(a, b) = dot(a, b) / (|a| * |b|)
// cosine_similarity(a, b) = (a1*b1 + a2*b2 + ... + an*bn) / (sqrt(a1^2 + a2^2 + ... + an^2) * sqrt(b1^2 + b2^2 + ... + bn^2))
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let magA = 0
  let magB = 0

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }

  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

async function main() {
  const similarPair = [
    'The cat sat on the mat.',
    'A kitten was resting on the rug.',
  ]

  const unrelatedPair = [
    'The cat sat on the mat.',
    'The stock market crashed on Tuesday.',
  ]

  console.log('Fetching embeddings...\n')

  const [a1, a2] = await Promise.all(similarPair.map(getEmbedding))
  const [b1, b2] = await Promise.all(unrelatedPair.map(getEmbedding))

  console.log(`Embedding length: ${a1.length} numbers`)
  console.log(`First 5 values of "${similarPair[0]}":`, a1.slice(0, 5))
  console.log()

  const similarScore = cosineSimilarity(a1, a2)
  const unrelatedScore = cosineSimilarity(b1, b2)

  console.log(`Similar pair:   "${similarPair[0]}" <-> "${similarPair[1]}"`)
  console.log(`  cosine similarity = ${similarScore.toFixed(4)}`)
  console.log()
  console.log(`Unrelated pair: "${unrelatedPair[0]}" <-> "${unrelatedPair[1]}"`)
  console.log(`  cosine similarity = ${unrelatedScore.toFixed(4)}`)
  console.log()

  console.log(
    similarScore > unrelatedScore
      ? '✅ Confirmed: the similar pair scored higher.'
      : '❌ Something is off — the similar pair should score higher.'
  )
}

main().catch(console.error)
