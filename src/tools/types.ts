import type { FunctionDeclaration } from '../services/llm.service'
import type { SimilarChunk } from '../repositories/chunks.repository'

// AG.3 — what every tool gets from CODE, never from the model.
//
// This is the "scope closed over by code" rule (agents-plan §2.3): the model
// only writes a tool's arguments (e.g. a search query). WHO is asking and
// WHICH documents may be searched are decided before the loop starts, from
// the verified token and the session, and handed to the tool here. So even
// if a sentence inside a PDF tells the model "search another user's files",
// there is no argument it could put that in.
export type ToolContext = {
  userId: string
  // one document id, or undefined = all of this user's ready documents
  documentId: string | undefined
  // embeds a search query. The agent passes a version that reuses the
  // router's embedding when the query is just the user's message unchanged
  // (agents-plan §11.4), so that case costs no extra embedding call.
  embed: (text: string) => Promise<number[]>
  // every chunk any search returned during this turn, deduped: becomes the
  // `sources` list under the answer
  sources: SimilarChunk[]
}

// What a tool hands back to the MODEL. Always a plain object (Gemini's
// functionResponse.response must be one), and errors are data too:
// { error: '…' } goes back to the model, which can fix its arguments and try
// again. A tool never throws into the loop on purpose.
export type ToolResult = Record<string, unknown>

export type Tool = {
  declaration: FunctionDeclaration
  // shown to the user while it runs (AG.4's `status` event) and in the log
  statusText: string
  run: (args: unknown, ctx: ToolContext) => Promise<ToolResult>
}
