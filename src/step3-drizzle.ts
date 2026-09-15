import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db } from './db/client'
import { insertChunk, searchSimilar } from './repositories/chunks.repository'
import { getEmbedding } from './services/embeddings.service'

// Step 1.3 — same result as step2-pgvector.ts, but through typed repository
// functions instead of raw SQL strings. Reuses the `chunks` table already
// created in step2 (same VECTOR(3072) shape) — Drizzle doesn't need to
// recreate it, just needs its schema definition to match.
// getEmbedding now lives in one shared file (services/embeddings.service.ts)
// instead of being copy-pasted in every step file.

const TEST_DOCUMENT_ID = 'step3-test'

async function main() {
  console.log('Clearing table...')
  await db.execute(sql`DELETE FROM chunks`)

  const sentences = [
    'The cat sat quietly on the mat.',
    'A kitten was resting on the rug.',
    'The stock market crashed on Tuesday.',
    'Investors panicked as share prices fell.',
    'Web development is fun.',
    'Building websites and applications can be rewarding.',
    'Coding is a creative problem-solving process.',
    'Problem-solving is a fundamental skill for software developers.',
    'The chef prepared a delicious three-course meal.',
    'Recipes often call for fresh herbs and spices.',
  ]

  console.log('Embedding and inserting via insertChunk()...')
  for (const content of sentences) {
    const embedding = await getEmbedding(content)
    await insertChunk(content, embedding, TEST_DOCUMENT_ID)
  }

  console.log('\nSearching via searchSimilar()...\n')
  const queryEmbedding = await getEmbedding('a cat napping on a blanket')
  const results = await searchSimilar(queryEmbedding, 2, TEST_DOCUMENT_ID)

  for (const row of results) {
    console.log(`  distance ${row.distance.toFixed(4)} — "${row.content}"`)
  }

  console.log(
    '\n✅ Same result as step2, but the caller never wrote a line of SQL — insertChunk() and searchSimilar() did.'
  )

  process.exit(0)
}

main().catch(console.error)
