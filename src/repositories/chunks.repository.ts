import { cosineDistance, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { chunks } from '../db/schema'

// this file is responsible for defining the repository functions that will be used to interact with the chunks
export async function insertChunk(
  content: string,
  embedding: number[],
  documentId: string,
): Promise<void> {
  // documentId ties this chunk to the PDF it came from, so search can be
  // scoped to one document instead of finding matches across every upload
  await db.insert(chunks).values({ content, embedding, documentId })
}

export async function searchSimilar(
  queryEmbedding: number[],
  limit: number,
  documentId: string,
): Promise<{ content: string; distance: number }[]> {
  // searchSimilar is a function that takes in a queryEmbedding array of numbers and a limit number, and returns an array of objects containing the content and distance of the most similar chunks to the queryEmbedding
  const distance = cosineDistance(chunks.embedding, queryEmbedding).mapWith(Number)
  // cosineDistance(chunks.embedding, queryEmbedding) — builds the same <=> SQL expression as a reusable TypeScript value
  // mapWith(Number) — ensures that the distance values are returned as numbers instead of strings, which is important for accurate sorting and comparison

  return db
    .select({ content: chunks.content, distance })
    .from(chunks)
    .where(eq(chunks.documentId, documentId))
    .orderBy(distance)
    .limit(limit)
}
