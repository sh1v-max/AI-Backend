import type { FunctionDeclaration } from '../services/llm.service'
import { summarizeError } from '../utils/errors'
import { searchDocumentsTool } from './searchDocuments.tool'
import { listDocumentsTool } from './listDocuments.tool'
import type { Tool, ToolContext, ToolResult } from './types'

// AG.3 — the agent's whole toolbox, and the ONLY way a tool gets run.
//
// The model sends back a NAME and some ARGS. Running it is a lookup in this
// fixed map: an unknown name finds nothing and becomes { error } data. There
// is no eval, no dynamic import, no "call whatever the model named". These are
// both Kind A tools (read-only, safe to run without asking the user); a tool
// that changes something (Kind B, the quiz in AG.5) is NOT put in here.
const TOOLS: Record<string, Tool> = {
  [searchDocumentsTool.declaration.name]: searchDocumentsTool,
  [listDocumentsTool.declaration.name]: listDocumentsTool,
}

// What the agent hands to the model + how it runs a call. An object (not two
// loose functions) so a test can pass a fake toolbox to runAgent, e.g. one
// whose search always says "try another query" to force the step limit.
export type ToolSet = {
  declarations: FunctionDeclaration[]
  statusText: (name: string) => string
  run: (name: string, args: unknown) => Promise<ToolResult>
}

export function makeToolSet(ctx: ToolContext): ToolSet {
  return {
    declarations: Object.values(TOOLS).map((t) => t.declaration),
    statusText: (name) => TOOLS[name]?.statusText ?? 'Working…',
    async run(name, args) {
      const tool = TOOLS[name]
      if (!tool) return { error: `Unknown tool "${name}". Available: ${Object.keys(TOOLS).join(', ')}` }
      try {
        return await tool.run(args ?? {}, ctx)
      } catch (err) {
        // a tool that throws (the DB is down, the embedding call failed)
        // becomes data the model can react to, and the reason goes to the log
        console.error(`[tool ${name}] ${summarizeError(err)}`)
        return { error: `The ${name} tool failed. Answer with what you have, or say it couldn't be looked up.` }
      }
    },
  }
}
