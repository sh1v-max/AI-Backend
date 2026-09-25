import { asc, cosineDistance, eq, isNotNull } from 'drizzle-orm'
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

// Step 4.1 — `count` chunks spread evenly across one document, in reading
// order. Not a search: chat asks "which chunks are relevant to this question?",
// but a quiz has no question, so it wants broad coverage of the whole PDF
// instead of the few chunks nearest to something. (Chunk ids are serial and
// assigned in document order at upload time, so ordering by id = page order.)
export async function sampleChunks(documentId: string, count: number): Promise<string[]> {
  const rows = await db
    .select({ content: chunks.content })
    .from(chunks)
    .where(eq(chunks.documentId, documentId))
    .orderBy(asc(chunks.id))

  if (rows.length <= count) return rows.map((r) => r.content)

  // pick `count` evenly spaced positions, e.g. 8 chunks / 4 wanted -> 0, 2, 4, 6
  return Array.from({ length: count }, (_, i) => rows[Math.floor((i * rows.length) / count)].content)
}
// equivalent sql query (the spacing is done in TypeScript afterwards):
// SELECT content FROM chunks WHERE document_id = $1 ORDER BY id

// this function deletes all chunks for one document
export async function deleteChunksByDocumentId(documentId: string): Promise<void> {
  await db.delete(chunks).where(eq(chunks.documentId, documentId))
}
// equivalent sql query:
// DELETE FROM chunks WHERE document_id = $1

// Step 3.3 — each result also carries which document it came from, so an
// answer built from several PDFs can say which PDF each piece came from.
// export interface is used to define the shape of the object that will be returned by the searchSimilar function. It includes the content of the chunk, the distance from the query embedding, the documentId of the chunk, and the filename of the document (which can be null if the document is missing)
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
// what this mean is that the function will return the content, distance, documentId, and filename of the most similar chunks to the queryEmbedding, ordered by distance, and limited to the specified number of results. If a documentId is provided, it will only search within that document, otherwise, it will search across all documents.
