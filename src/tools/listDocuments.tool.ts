import { listDocuments } from '../repositories/documents.repository'
import type { Tool } from './types'

// AG.3 — listDocuments: answers "which documents do I have?", a question
// chunk search can't answer properly (the old pipeline only "knew" the files
// whose chunks happened to win the top-3 search; Step 3.3's known tradeoff).
//
// Takes no arguments. Lists only ctx.userId's documents, so it can't show
// anyone else's, whatever the model or a PDF asks for. It lists every status
// (a "processing" file is still the user's file; the model can say it isn't
// searchable yet).
export const listDocumentsTool: Tool = {
  declaration: {
    name: 'listDocuments',
    description:
      "List the user's uploaded documents: filename, status (ready, processing or failed), number of chunks and upload date. Use it when the user asks which documents or files they have, or how many.",
    // no `parameters`: this tool takes no arguments
  },
  statusText: () => 'Checking your documents…',

  async run(_args, ctx) {
    const rows = await listDocuments(ctx.userId)
    return {
      documents: rows.map((d) => ({
        filename: d.filename,
        status: d.status,
        chunkCount: d.chunkCount,
        uploadedAt: d.createdAt.toISOString().slice(0, 10),
      })),
    }
  },
}
