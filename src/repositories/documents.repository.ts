import { desc, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { documents } from '../db/schema'

// insert a new document
export async function insertDocument(
  id: string,
  filename: string,
  fileSizeBytes: number,
  textLength: number,
  chunkCount: number,
) {
  const [document] = await db
    .insert(documents)
    .values({ id, filename, fileSizeBytes, textLength, chunkCount })
    // returning() is used to return the inserted document row after the insert operation. this allows the caller to get the document metadata without having to query the database again. it returns as an array with one element, so we destructure it to get the first element (the inserted document)
    .returning()
  return document
}
// equivalent sql query:
// INSERT INTO documents (id, filename, file_size_bytes, text_length, chunk_count) VALUES ($1, $2, $3, $4, $5) RETURNING *

// list all documents
export async function listDocuments() {
  return db.select().from(documents).orderBy(desc(documents.createdAt))
}
// equivalent sql query:
// SELECT * FROM documents ORDER BY created_at DESC

// this function deletes a document by its id
export async function deleteDocument(id: string): Promise<void> {
  await db.delete(documents).where(eq(documents.id, id))
}
// equivalent sql query:
// DELETE FROM documents WHERE id = $1
