# Stack & What We're Learning

Companion doc to [ai-backend-roadmap.md](../ai-backend-roadmap.md) — the tools involved and the concepts each phase teaches.

## Stack

| Piece | Tool | Why |
|---|---|---|
| Runtime | Node.js + TypeScript | already comfortable here |
| Server | Express | already comfortable here |
| LLM + embeddings | Gemini API (free tier) | `text-embedding-004` + text generation, no card required |
| Database | Postgres (Neon or Supabase, free) | relational data + vectors in one place |
| Vector search | pgvector | stores embeddings, does similarity search with `<=>` |
| ORM | Drizzle | typed SQL instead of hand-written queries |
| File parsing | pdf-parse | extract text from uploaded PDFs |
| Validation | Zod | already know it for request bodies — reused here to validate LLM output |
| Streaming | Server-Sent Events (SSE) | stream chat replies word by word |
| Job queue *(later)* | BullMQ + Upstash Redis | background PDF ingestion, offline vs online work |
| Agents / tool calling *(later)* | Gemini function calling | LLM decides when to search vs. answer directly |
| Workflows *(later)* | hand-rolled state machine, then LangGraph.js | multi-step flows with suspend/resume |
| Testing *(later)* | Vitest | mock the LLM boundary, test everything deterministic |
| Deploy *(later)* | Render (free tier) | API + background worker |

Everything is free — no credit card needed anywhere in this plan.

## What each concept teaches

- **Embeddings** — turning text into numbers so "similar meaning" becomes "similar vectors"
- **Vector search** — using a database to find the closest vectors fast (pgvector)
- **RAG** — handing the LLM the relevant text right before asking, instead of it guessing from memory
- **Conversation memory** — how a chatbot "remembers" earlier turns (it's just replaying history in the prompt)
- **Streaming** — sending the reply piece by piece instead of waiting for the whole thing
- **Structured output** — forcing an LLM to return reliable JSON (Zod-validated), not just prose
- **Background jobs** — why slow, nobody's-waiting work runs on a queue instead of blocking a request
- **Agents & tool calling** — letting the LLM decide *when* to call a tool instead of always running the same flow
- **Suspend/resume workflows** — multi-step flows that pause, save state, and continue on the next message

## Progress

Tracked in one place, in order: [../PROGRESS.md](../PROGRESS.md). That file is the single source of truth for what to do next — don't track progress here or anywhere else.
