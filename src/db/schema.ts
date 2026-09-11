import { pgTable, serial, text, vector } from 'drizzle-orm/pg-core'

// defined the table as typescript type
export const chunks = pgTable('chunks', {
  // The 'id' column is defined as a serial type and is the primary key of the table, always incremented by 1 for each new row
  id: serial('id').primaryKey(),
  // The 'content' column is defined as a text type and cannot be null
  content: text('content').notNull(),
  // The 'embedding' column is defined as a vector type with 3072 dimensions
  embedding: vector('embedding', { dimensions: 3072 }),
})

// every other file will import this file (chunks) and use it to access the table and its columns in a type-safe manner
// this allows for better code completion and type checking when working with the database schema in TypeScript