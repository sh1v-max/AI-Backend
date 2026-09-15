import { desc } from 'drizzle-orm'
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

export async function listDocuments() {
  return db.select().from(documents).orderBy(desc(documents.createdAt))
}
