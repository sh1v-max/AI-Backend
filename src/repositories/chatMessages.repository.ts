import { asc, desc, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { chatMessages, documents } from '../db/schema'
import { ALL_DOCUMENTS, ALL_DOCUMENTS_LABEL } from '../config'

export interface SessionSummary {
  sessionId: string
  documentId: string
  filename: string | null
  title: string
  lastMessage: string
  lastMessageAt: Date
  messageCount: number
}

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

// Full transcript for one session, oldest first — what the frontend renders
// when a history item is opened.
export async function getMessagesForSession(
  sessionId: string,
): Promise<{ role: string; content: string; createdAt: Date }[]> {
  return db
    .select({
      role: chatMessages.role,
      content: chatMessages.content,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(asc(chatMessages.createdAt))
}

// One row per session (conversation), newest activity first — the sidebar's
// history list. Sessions aren't a table of their own; they're derived by
// grouping chat_messages by session_id, so this reduces the full message
// log down to one summary per session rather than adding a new table.
// this fetches the summary of all sessions, newest first
export async function listSessions(): Promise<SessionSummary[]> {
  const rows = await db
    .select({
      sessionId: chatMessages.sessionId,
      documentId: chatMessages.documentId,
      role: chatMessages.role,
      content: chatMessages.content,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .orderBy(asc(chatMessages.createdAt))

  const docRows = await db.select({ id: documents.id, filename: documents.filename }).from(documents)
  const filenameByDocumentId = new Map(docRows.map((d) => [d.id, d.filename]))

  const bySession = new Map<string, SessionSummary>()

  for (const row of rows) {
    const existing = bySession.get(row.sessionId)

    if (!existing) {
      bySession.set(row.sessionId, {
        sessionId: row.sessionId,
        documentId: row.documentId,
        // An "all documents" session (Step 3.3) has no single file, so it gets
        // a fixed label instead of a filename lookup.
        filename:
          row.documentId === ALL_DOCUMENTS
            ? ALL_DOCUMENTS_LABEL
            : (filenameByDocumentId.get(row.documentId) ?? null),
        // First user message doubles as the conversation's title — the same
        // idea ChatGPT uses for naming a thread from its opening message.
        title: row.role === 'user' ? row.content : 'New conversation',
        lastMessage: row.content,
        lastMessageAt: row.createdAt,
        messageCount: 1,
      })
      continue
    }

    existing.lastMessage = row.content
    existing.lastMessageAt = row.createdAt
    existing.messageCount += 1
  }

  return [...bySession.values()].sort(
    (a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime(),
  )
}

// Deletes all messages for one session
export async function deleteSession(sessionId: string): Promise<void> {
  await db.delete(chatMessages).where(eq(chatMessages.sessionId, sessionId))
}
// equivalent sql query:
// DELETE FROM chat_messages WHERE session_id = $1

// Deletes every session's worth of messages for one document — used when
// the document itself is deleted, so no orphaned chat history is left
// pointing at a document_id that no longer exists.
export async function deleteMessagesByDocumentId(documentId: string): Promise<void> {
  await db.delete(chatMessages).where(eq(chatMessages.documentId, documentId))
}
// equivalent sql query:
// DELETE FROM chat_messages WHERE document_id = $1
