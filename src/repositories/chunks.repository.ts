import { and, asc, cosineDistance, eq } from 'drizzle-orm'
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
// sampleChunks() is used in the quiz endpoint to pick a few chunks from a PDF to ask questions about
//
// Auth.3 — chunks have no owner column of their own; the owner is on the
// document. So this now JOINs documents and keeps only chunks whose document
// belongs to userId. Someone else's documentId simply matches zero rows,
// which the quiz service already turns into a 404.
export async function sampleChunks(
  documentId: string,
  userId: string,
  count: number,
): Promise<string[]> {
  const rows = await db
    .select({ content: chunks.content })
    .from(chunks)
    // innerJoin = only rows that have a match on BOTH sides. A chunk with no
    // documents row (an old orphan) has no owner, so it can never match.
    .innerJoin(documents, eq(chunks.documentId, documents.id))
    .where(and(eq(chunks.documentId, documentId), eq(documents.userId, userId)))
    .orderBy(asc(chunks.id))

  // if there are fewer chunks than we want, return them all
  if (rows.length <= count) return rows.map((r) => r.content)

  // if there are more chunks than we want, we pick `count` evenly spaced positions, e.g. 8 chunks / 4 wanted -> 0, 2, 4, 6
  return Array.from(
    { length: count },
    (_, i) => rows[Math.floor((i * rows.length) / count)].content,
  )
}
// equivalent sql query (the spacing is done in TypeScript afterwards):
// SELECT c.content FROM chunks c
// INNER JOIN documents d ON c.document_id = d.id
// WHERE c.document_id = $1 AND d.user_id = $2
// ORDER BY c.id

// this function deletes all chunks for one document
// Auth.3 — no userId here: chunks have no owner column to filter on. The
// caller (DELETE /documents/:id) checks the document belongs to the user
// BEFORE calling this, and must keep doing so.
export async function deleteChunksByDocumentId(
  documentId: string,
): Promise<void> {
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
//
// Auth.3 — `userId` is required, and BOTH modes only ever search that user's
// documents: "all documents" now means "all of MY documents". In single-document
// mode the ownership check and the search happen in the same query: someone
// else's documentId returns zero chunks, and prepareChat's existing "No
// document found" 404 fires without any new code.
export async function searchSimilar(
  queryEmbedding: number[],
  limit: number,
  userId: string,
  documentId?: string,
): Promise<SimilarChunk[]> {
  // searchSimilar is a function that takes in a queryEmbedding array of numbers and a limit number, and returns an array of objects containing the content and distance of the most similar chunks to the queryEmbedding
  const distance = cosineDistance(chunks.embedding, queryEmbedding).mapWith(
    Number,
  )
  // cosineDistance(chunks.embedding, queryEmbedding) — builds the same <=> SQL expression as a reusable TypeScript value
  // mapWith(Number) — ensures that the distance values are returned as numbers instead of strings, which is important for accurate sorting and comparison

  return (
    db
      .select({
        content: chunks.content,
        distance,
        documentId: chunks.documentId,
        filename: documents.filename,
      })
      .from(chunks)
      // Auth.3 — was a LEFT JOIN (keep chunks even when their documents row is
      // missing). Now the owner lives on the documents row, so a chunk without
      // one can't belong to anybody: INNER JOIN drops it. This also replaces
      // the old "skip orphan chunks in all-documents mode" filter — orphans
      // can never match a user_id, in either mode.
      .innerJoin(documents, eq(chunks.documentId, documents.id))
      .where(
        documentId
          ? and(eq(chunks.documentId, documentId), eq(documents.userId, userId))
          : eq(documents.userId, userId),
      )
      .orderBy(distance)
      .limit(limit)
  )
}
// equivalent sql query (single document):
// SELECT c.content, c.embedding <=> $1 AS distance, c.document_id, d.filename
// FROM chunks c
// INNER JOIN documents d ON c.document_id = d.id
// WHERE c.document_id = $2 AND d.user_id = $3
// ORDER BY distance
// LIMIT $4
// (all documents: WHERE d.user_id = $2 instead — every chunk of every document this user owns)
// what this mean is that the function will return the content, distance, documentId, and filename of the most similar chunks to the queryEmbedding, ordered by distance, and limited to the specified number of results. If a documentId is provided, it will only search within that document, otherwise, it will search across all documents.
