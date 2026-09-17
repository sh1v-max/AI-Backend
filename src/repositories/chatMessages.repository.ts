import { desc, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { chatMessages } from '../db/schema'

// this function inserts a new chat message into the chatMessages table in the db. it takes the sessionId, documentId, role, and content of the message as parameters and returns a Promise that resolves when the insertion is complete. it uses the db.insert method provided by Drizzle ORM to perform the insertion in a type-safe manner.
export async function insertMessage(
  sessionId: string,
  documentId: string,
  role: 'user' | 'assistant',
  content: string,
): Promise<void> {
  await db.insert(chatMessages).values({ sessionId, documentId, role, content })
}
// instead of this, we can also write the same above code in SQL as:
// INSERT INTO chat_messages (session_id, document_id, role, content) VALUES ($1, $2, $3, $4)

// Returns the last `limit` messages for a session, oldest first — the
// order a prompt needs them in to read as a real conversation.
export async function getRecentMessages(
  sessionId: string,
  limit: number,
): Promise<{ role: string; content: string }[]> {
  const rows = await db
    .select({ role: chatMessages.role, content: chatMessages.content })
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit)

  return rows.reverse()
}
// equivalent sql query:
// SELECT role, content
// FROM chat_messages
// WHERE session_id = $1
// ORDER BY created_at DESC
// LIMIT $2
