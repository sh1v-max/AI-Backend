import { and, asc, desc, eq } from 'drizzle-orm'
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

// Auth.3 — why EVERY function below filters on session_id AND user_id:
// the client picks the sessionId (the frontend makes one with
// crypto.randomUUID()), so a sessionId alone proves nothing. If user B sends
// user A's sessionId, B's queries still only match rows with B's user_id —
// B reads none of A's messages, and B's new messages are saved under B. The
// two never mix, without needing a separate "is this session yours?" check.

// this function inserts a new chat message into the chatMessages table in the db. it takes the sessionId, documentId, role, and content of the message as parameters and returns a Promise that resolves when the insertion is complete. it uses the db.insert method provided by Drizzle ORM to perform the insertion in a type-safe manner.
export async function insertMessage(
  sessionId: string,
  userId: string,
  documentId: string,
  role: 'user' | 'assistant',
  content: string,
): Promise<void> {
  await db.insert(chatMessages).values({ sessionId, userId, documentId, role, content })
}
// instead of this, we can also write the same above code in SQL as:
// INSERT INTO chat_messages (session_id, user_id, document_id, role, content) VALUES ($1, $2, $3, $4, $5)

// Returns the last `limit` messages for a session, oldest first — the
// order a prompt needs them in to read as a real conversation.
//
// Auth.3 — the easiest one to forget, because it never returns anything to
// the client: it feeds the PROMPT. Without the user_id filter, B could send
// A's sessionId and ask "summarise our conversation so far", and the model
// would answer from A's history. A leak through the LLM is still a leak.
export async function getRecentMessages(
  sessionId: string,
  userId: string,
  limit: number,
): Promise<{ role: string; content: string }[]> {
  const rows = await db
    .select({ role: chatMessages.role, content: chatMessages.content })
    .from(chatMessages)
    .where(and(eq(chatMessages.sessionId, sessionId), eq(chatMessages.userId, userId)))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit)

  return rows.reverse()
}
// equivalent sql query:
// SELECT role, content
// FROM chat_messages
// WHERE session_id = $1 AND user_id = $2
// ORDER BY created_at DESC
// LIMIT $3

// Full transcript for one session, oldest first — what the frontend renders
// when a history item is opened. Someone else's sessionId returns [] — it
// looks exactly like a session that doesn't exist.
export async function getMessagesForSession(
  sessionId: string,
  userId: string,
): Promise<{ role: string; content: string; createdAt: Date }[]> {
  return db
    .select({
      role: chatMessages.role,
      content: chatMessages.content,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(and(eq(chatMessages.sessionId, sessionId), eq(chatMessages.userId, userId)))
    .orderBy(asc(chatMessages.createdAt))
}
// equivalent sql query:
// SELECT role, content, created_at FROM chat_messages
// WHERE session_id = $1 AND user_id = $2 ORDER BY created_at

// One row per session (conversation), newest activity first — the sidebar's
// history list. Sessions aren't a table of their own; they're derived by
// grouping chat_messages by session_id, so this reduces the full message
// log down to one summary per session rather than adding a new table.
// this fetches the summary of all sessions, newest first
// Auth.3 — two queries here (messages, then filenames), and both are filtered
// to this user. The filename lookup leaking wouldn't show other users'
// messages, but it would still pull every user's filenames into memory.
export async function listSessions(userId: string): Promise<SessionSummary[]> {
  const rows = await db
    .select({
      sessionId: chatMessages.sessionId,
      documentId: chatMessages.documentId,
      role: chatMessages.role,
      content: chatMessages.content,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(eq(chatMessages.userId, userId))
    .orderBy(asc(chatMessages.createdAt))

  const docRows = await db
    .select({ id: documents.id, filename: documents.filename })
    .from(documents)
    .where(eq(documents.userId, userId))
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

// Deletes all of this user's messages for one session. Someone else's
// sessionId matches no rows, so the delete quietly does nothing.
export async function deleteSession(sessionId: string, userId: string): Promise<void> {
  await db
    .delete(chatMessages)
    .where(and(eq(chatMessages.sessionId, sessionId), eq(chatMessages.userId, userId)))
}
// equivalent sql query:
// DELETE FROM chat_messages WHERE session_id = $1 AND user_id = $2

// Deletes every session's worth of messages for one document — used when
// the document itself is deleted, so no orphaned chat history is left
// pointing at a document_id that no longer exists.
export async function deleteMessagesByDocumentId(documentId: string, userId: string): Promise<void> {
  await db
    .delete(chatMessages)
    .where(and(eq(chatMessages.documentId, documentId), eq(chatMessages.userId, userId)))
}
// equivalent sql query:
// DELETE FROM chat_messages WHERE document_id = $1 AND user_id = $2
