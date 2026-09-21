import { cosineDistance, eq, isNotNull } from 'drizzle-orm'
import { db } from '../db/client'
import { chunks, documents } from '../db/schema'

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
// instead of this, we can also write the same above code in SQL as:
// INSERT INTO chunks (content, embedding, document_id) VALUES ($1, $2, $3)

// this function deletes all chunks for one document
export async function deleteChunksByDocumentId(documentId: string): Promise<void> {
  await db.delete(chunks).where(eq(chunks.documentId, documentId))
}
// equivalent sql query:
// DELETE FROM chunks WHERE document_id = $1

// Step 3.3 — each result also carries which document it came from, so an
// answer built from several PDFs can say which PDF each piece came from.
export interface SimilarChunk {
  content: string
  distance: number
  documentId: string
  filename: string | null
}

// `documentId` is optional: pass one to search inside a single PDF, omit it to
// search every chunk of every document (Step 3.3).
export async function searchSimilar(
  queryEmbedding: number[],
  limit: number,
  documentId?: string,
): Promise<SimilarChunk[]> {
  // searchSimilar is a function that takes in a queryEmbedding array of numbers and a limit number, and returns an array of objects containing the content and distance of the most similar chunks to the queryEmbedding
  const distance = cosineDistance(chunks.embedding, queryEmbedding).mapWith(Number)
  // cosineDistance(chunks.embedding, queryEmbedding) — builds the same <=> SQL expression as a reusable TypeScript value
  // mapWith(Number) — ensures that the distance values are returned as numbers instead of strings, which is important for accurate sorting and comparison

  return db
    .select({
      content: chunks.content,
      distance,
      documentId: chunks.documentId,
      // LEFT JOIN so a chunk whose documents row is missing still comes back
      // (filename is then null) instead of silently disappearing from search.
      filename: documents.filename,
    })
    .from(chunks)
    .leftJoin(documents, eq(chunks.documentId, documents.id))
    // All-documents mode only searches chunks whose document actually exists
    // in the documents table — i.e. the ones the user can see and delete in
    // the UI. Older "orphan" chunks (uploaded before the documents table
    // existed) would otherwise surface in answers as an "unknown document".
    // Single-document mode is left alone, so a session pinned to an orphan
    // id keeps working.
    .where(documentId ? eq(chunks.documentId, documentId) : isNotNull(documents.id))
    .orderBy(distance)
    .limit(limit)
}
// equivalent sql query (single document):
// SELECT c.content, c.embedding <=> $1 AS distance, c.document_id, d.filename
// FROM chunks c
// LEFT JOIN documents d ON c.document_id = d.id
// WHERE c.document_id = $2
// ORDER BY distance
// LIMIT $3
// (all documents: WHERE d.id IS NOT NULL instead — only chunks with a documents row)
