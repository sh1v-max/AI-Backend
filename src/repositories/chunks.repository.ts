import { cosineDistance } from 'drizzle-orm'
import { db } from '../db/client'
import { chunks } from '../db/schema'

// this file is responsible for defining the repository functions that will be used to interact with the chunks
export async function insertChunk(content: string, embedding: number[]): Promise<void> {
  await db.insert(chunks).values({ content, embedding })
}
// insertChunk is a function that takes in a content string and an embedding array of numbers, and inserts a new row into the chunks table with the provided values
// No SQL string, no $1/$2, no manually formatting the vector as '[0.1,0.2,...]'

export async function searchSimilar(
  queryEmbedding: number[],
  limit: number
): Promise<{ content: string; distance: number }[]> {
  const distance = cosineDistance(chunks.embedding, queryEmbedding).mapWith(Number)
  // cosineDistance(chunks.embedding, queryEmbedding) — builds the same <=> SQL expression as a reusable TypeScript value

  return db
    .select({ content: chunks.content, distance })
    .from(chunks)
    .orderBy(distance)
    .limit(limit)
}
