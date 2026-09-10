import 'dotenv/config'
import { Pool } from 'pg'

// Step 1.2 — Postgres + pgvector
// Same embedding call as step1, now storing vectors in a real database
// and letting Postgres do the cosine-distance math via the <=> operator.

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
  return data.embedding.values
}

// pgvector expects a vector literal as text: '[0.1,0.2,0.3,...]'
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  console.log('Setting up table...')
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector;')
  await pool.query('DROP TABLE IF EXISTS chunks;')
  await pool.query(`
    CREATE TABLE chunks (
      id SERIAL PRIMARY KEY,
      content TEXT NOT NULL,
      embedding VECTOR(3072)
    );
  `)

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

  console.log('Embedding and inserting sentences...')
  for (const content of sentences) {
    const embedding = await getEmbedding(content)
    await pool.query(
      'INSERT INTO chunks (content, embedding) VALUES ($1, $2)',
      [content, toVectorLiteral(embedding)],
    )
    // VALUES ($1, $2) are parameterized queries, which help prevent SQL injection attacks. The $1 and $2 are placeholders for the actual values provided in the array that follows.
  }

  console.log('\nQuerying: what\'s closest to "a cat napping on a blanket"?\n')
  const queryEmbedding = await getEmbedding('a cat napping on a blanket')
  const result = await pool.query(
    `SELECT content, embedding <=> $1 AS distance
     FROM chunks
     ORDER BY embedding <=> $1
     LIMIT 2`,
    [toVectorLiteral(queryEmbedding)],
  )

  for (const row of result.rows) {
    console.log(
      `  distance ${Number(row.distance).toFixed(4)} — "${row.content}"`,
    )
  }

  console.log(
    '\n✅ If the two cat-related sentences came back first (lowest distance), the DB is doing the same cosine math as step1 — just at scale.',
  )

  await pool.end()
}

main().catch(console.error)
