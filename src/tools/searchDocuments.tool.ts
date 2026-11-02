import { z } from 'zod'
import { searchSimilar } from '../repositories/chunks.repository'
import { SEARCH_TOP_K } from '../config'
import type { Tool } from './types'

// AG.3 — searchDocuments: the agent's version of the old fixed "top 3 chunks
// for the raw message" step.
//
// The big difference: the MODEL writes the query. After reading the
// conversation it can turn "and who founded it?" into "who founded the
// Lantern Festival", which the old pipeline could never do (it embedded the
// raw words). That's agentic RAG, and it's why follow-ups get better.
//
// What it deliberately does NOT have: a documentId or userId parameter. Both
// come from ctx (see types.ts).

// Zod checks the model's arguments the same way it checks a request body:
// the model is just another untrusted client. 500 chars is plenty for a
// search query and stops a runaway one.
const Args = z.object({ query: z.string().trim().min(1).max(500) })

export const searchDocumentsTool: Tool = {
  declaration: {
    name: 'searchDocuments',
    description:
      "Search the user's uploaded documents for passages relevant to a query. Use it for ANY question about the documents' content, before answering. You can call it more than once with different queries, e.g. once per part of a multi-part question.",
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description:
            'A standalone search query in plain words. Resolve "it", "that", "the second one" etc. from the conversation first, e.g. "who founded the Lantern Festival" instead of "who founded it".',
        },
      },
      required: ['query'],
    },
  },
  // AG.4 — shows the query the MODEL wrote, so the user sees the follow-up
  // rewrite happen ("and who founded it?" → Searching for "who founded the
  // Lantern Festival"…). Bad args fall back to a generic line; the run below
  // then turns them into { error } as before.
  statusText(args) {
    const parsed = Args.safeParse(args)
    if (!parsed.success) return 'Searching the documents…'
    const q = parsed.data.query
    return `Searching for "${q.length > 60 ? `${q.slice(0, 59)}…` : q}"…`
  },

  async run(args, ctx) {
    const parsed = Args.safeParse(args)
    if (!parsed.success) {
      return { error: 'query must be a non-empty string of at most 500 characters' }
    }

    const embedding = await ctx.embed(parsed.data.query)
    // userId + scope from ctx: only this user's ready documents, one or all
    const chunks = await searchSimilar(embedding, SEARCH_TOP_K, ctx.userId, ctx.documentId)

    // collect for the `sources` list, skipping chunks an earlier search in
    // this turn already returned
    for (const chunk of chunks) {
      const seen = ctx.sources.some((s) => s.documentId === chunk.documentId && s.content === chunk.content)
      if (!seen) ctx.sources.push(chunk)
    }

    if (chunks.length === 0) {
      return { results: [], note: 'Nothing relevant was found in the documents.' }
    }
    // The model gets the text and which file it came from (so it can cite the
    // file in all-documents chats). Not the distance: a number it would only
    // be tempted to over-read.
    return {
      results: chunks.map((c) => ({ filename: c.filename ?? 'unknown document', content: c.content })),
    }
  },
}
