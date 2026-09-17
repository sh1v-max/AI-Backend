import { desc, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { documents } from '../db/schema'

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
    .returning()
  return document
}
// equivalent sql query:
// INSERT INTO documents (id, filename, file_size_bytes, text_length, chunk_count) VALUES ($1, $2, $3, $4, $5) RETURNING *

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
