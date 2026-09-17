import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  vector,
} from 'drizzle-orm/pg-core'

// schema for the database tables used in this project, defined using Drizzle ORM's pgTable function. Each table is represented as a TypeScript constant, allowing for type-safe access to the table's columns and their types. The schema includes three tables: documents, chunks, and chatMessages, each with its own set of columns and constraints.

// the documents table schema
// One row per uploaded PDF — tracks metadata so the frontend (or Postman,
// or any other client) can list "what documents exist" without deriving it
// from chunk rows, and without depending on whoever uploaded it.
export const documents = pgTable('documents', {
  id: text('id').primaryKey(), // same UUID used as chunks.document_id
  filename: text('filename').notNull(),
  fileSizeBytes: integer('file_size_bytes').notNull(),
  textLength: integer('text_length').notNull(),
  chunkCount: integer('chunk_count').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// the chunks table schema
// defined the table as typescript type
export const chunks = pgTable('chunks', {
  // The 'id' column is defined as a serial type and is the primary key of the table, always incremented by 1 for each new row
  id: serial('id').primaryKey(),
  // The 'content' column is defined as a text type and cannot be null
  content: text('content').notNull(),
  // The 'embedding' column is defined as a vector type with 3072 dimensions
  embedding: vector('embedding', { dimensions: 3072 }),
  // document_id keeps track of which document the chunk belongs to, allowing for grouping and retrieval of chunks by document
  documentId: text('document_id').notNull(),
})

// every other file will import this file (chunks) and use it to access the table and its columns in a type-safe manner
// this allows for better code completion and type checking when working with the database schema in TypeScript

// the chatMessages table
// Step 2.4 — one row per message in a conversation. sessionId groups
// messages into one conversation thread; documentId is stored too so a
// session's history is always tied back to which document it's about.
export const chatMessages = pgTable('chat_messages', {
  id: serial('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  // documentId keeps track of which document the message belongs to
  documentId: text('document_id').notNull(),
  // 
  role: text('role').notNull(), // 'user' | 'assistant'
  content: text('content').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
// equivalent sql query:
// CREATE TABLE chat_messages (
//   id SERIAL PRIMARY KEY,
//   session_id TEXT NOT NULL,
//   document_id TEXT NOT NULL,
//   role TEXT NOT NULL,
//   content TEXT NOT NULL,
//   created_at TIMESTAMP NOT NULL DEFAULT NOW()
// )