import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db } from './db/client'
import { insertChunk, searchSimilar } from './repositories/chunks.repository'

// Step 1.3 — same result as step2-pgvector.ts, but through typed repository
// functions instead of raw SQL strings. Reuses the `chunks` table already
// created in step2 (same VECTOR(3072) shape) — Drizzle doesn't need to
// recreate it, just needs its schema definition to match.

const API_KEY = process.env.GEMINI_API_KEY
const EMBED_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent'

async function getEmbedding(text: string): Promise<number[]> {
  const res = await fetch(`${EMBED_URL}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: { parts: [{ text }] } }),
  })

  if (!res.ok) {
    throw new Error(`Gemini API error: ${res.status} ${await res.text()}`)
  }

  const data = await res.json()
  return data.embedding.values
}

async function main() {
  console.log('Clearing table...')
  await db.execute(sql`DELETE FROM chunks`)

  const sentences = [
    'The cat sat quietly on the mat.',
    'A kitten was resting on the rug.',
    'The stock market crashed on Tuesday.',
    'Investors panicked as share prices fell.',
  ]

  console.log('Embedding and inserting via insertChunk()...')
  for (const content of sentences) {
    const embedding = await getEmbedding(content)
    await insertChunk(content, embedding)
  }

  console.log('\nSearching via searchSimilar()...\n')
  const queryEmbedding = await getEmbedding('a cat napping on a blanket')
  const results = await searchSimilar(queryEmbedding, 2)

  for (const row of results) {
    console.log(`  distance ${row.distance.toFixed(4)} — "${row.content}"`)
  }

  console.log(
    '\n✅ Same result as step2, but the caller never wrote a line of SQL — insertChunk() and searchSimilar() did.'
  )

  process.exit(0)
}

main().catch(console.error)
