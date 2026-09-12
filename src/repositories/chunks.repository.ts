import { cosineDistance } from 'drizzle-orm'
import { db } from '../db/client'
import { chunks } from '../db/schema'

// this file is responsible for defining the repository functions that will be used to interact with the chunks
export async function insertChunk(
  content: string,
  embedding: number[],
): Promise<void> {
  // <void> indicates that this function doesn't return any value, it just performs the insert operation
  // Promise indicates that this function is async and will return a promise that resolves when the insert operation is complete
  // Promise<void> is basically return type of the function, indicating that it returns a promise that resolves to void (no value)
  await db.insert(chunks).values({ content, embedding })
}
// insertChunk is a function that takes in a content string and an embedding array of numbers, and inserts a new row into the chunks table with the provided values
// No SQL string, no $1/$2, no manually formatting the vector as '[0.1,0.2,...]'

export async function searchSimilar(
  queryEmbedding: number[],
  limit: number,
): Promise<{ content: string; distance: number }[]> {
  // searchSimilar is a function that takes in a queryEmbedding array of numbers and a limit number, and returns an array of objects containing the content and distance of the most similar chunks to the queryEmbedding
  const distance = cosineDistance(chunks.embedding, queryEmbedding).mapWith(Number)
  // cosineDistance(chunks.embedding, queryEmbedding) — builds the same <=> SQL expression as a reusable TypeScript value
  // mapWith(Number) — ensures that the distance values are returned as numbers instead of strings, which is important for accurate sorting and comparison

  return db
    .select({ content: chunks.content, distance })
    .from(chunks)
    .orderBy(distance)
    .limit(limit)
}
