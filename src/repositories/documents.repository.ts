import { and, count, desc, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { documents } from '../db/schema'

// Auth.3 — every function here that reads or deletes takes a userId, and it's
// REQUIRED, not optional. That's deliberate: if a new route forgets to pass
// one, TypeScript refuses to compile, instead of the query quietly returning
// everyone's documents. The filter lives here, in the SQL, so no caller can
// skip it.

// insert a new document
// Auth.3 — userId records who uploaded it; it's what every read below filters on.
export async function insertDocument(
  id: string,
  userId: string,
  filename: string,
  fileSizeBytes: number,
  textLength: number,
  chunkCount: number,
) {
  const [document] = await db
    .insert(documents)
    .values({ id, userId, filename, fileSizeBytes, textLength, chunkCount })
    // returning() is used to return the inserted document row after the insert operation. this allows the caller to get the document metadata without having to query the database again. it returns as an array with one element, so we destructure it to get the first element (the inserted document)
    .returning()
  return document
}
// equivalent sql query:
// INSERT INTO documents (id, user_id, filename, file_size_bytes, text_length, chunk_count) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *

// list one user's documents, newest first
export async function listDocuments(userId: string) {
  return db
    .select()
    .from(documents)
    .where(eq(documents.userId, userId))
    .orderBy(desc(documents.createdAt))
}
// equivalent sql query:
// SELECT * FROM documents WHERE user_id = $1 ORDER BY created_at DESC

// Auth.3 — "does this document exist AND belong to this user?" in one query.
// Returns null for both "no such document" and "someone else's document" —
// the caller answers 404 either way, so a stranger can't even learn that an
// id exists.
export async function getDocumentForUser(
  id: string,
  userId: string,
): Promise<{ id: string; filename: string } | null> {
  const [document] = await db
    .select({ id: documents.id, filename: documents.filename })
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.userId, userId)))
    .limit(1)
  return document ?? null
}
// equivalent sql query:
// SELECT id, filename FROM documents WHERE id = $1 AND user_id = $2 LIMIT 1

// Auth.7 — how many documents this user has, for the upload cap. count() makes
// Postgres do the counting and send back one number, instead of sending every
// row over the network just to measure the array's length.
export async function countDocuments(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(documents)
    .where(eq(documents.userId, userId))
  return row.n
}
// equivalent sql query:
// SELECT count(*) FROM documents WHERE user_id = $1

// this function deletes a document by its id — only if it belongs to userId
export async function deleteDocument(id: string, userId: string): Promise<void> {
  // and(...) combines both conditions into one WHERE. (Chaining a second
  // .where() would NOT add to the first one, it would replace it.)
  await db
    .delete(documents)
    .where(and(eq(documents.id, id), eq(documents.userId, userId)))
}
// equivalent sql query:
// DELETE FROM documents WHERE id = $1 AND user_id = $2
