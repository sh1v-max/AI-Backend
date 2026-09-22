# Progress Tracker — follow this file top to bottom

This is the single source of truth for "what do I do next." Don't jump ahead — check things off in order. When you finish a topic, fill in its `NOTES.md` before moving on (that's where the actual learning gets locked in).

Advanced topics are listed **right after the basic topic they relate to** so you know exactly when they're relevant — but don't do them yet. Do all of Part 1 + Part 2 first, top to bottom, ignoring every "advanced" row. Only once you finish Step 13 and feel job-ready, come back to the top and do the advanced rows in the same order.

---

## Part 1 + 2 — do this first, straight through (job-ready track)

| # | Status | Topic | Notes | Related advanced topic (do later, not now) |
|---|---|---|---|---|
| 01 | ✅ | Embeddings | [topics/01-embeddings](topics/01-embeddings/NOTES.md) | — |
| 02 | ✅ | Vector search (pgvector) | [topics/02-vector-search-pgvector](topics/02-vector-search-pgvector/NOTES.md) | — |
| 03 | ✅ | Repository pattern (Drizzle) | [topics/03-repository-pattern-drizzle](topics/03-repository-pattern-drizzle/NOTES.md) | — |
| 04 | ✅ | PDF parsing | [topics/04-pdf-parsing](topics/04-pdf-parsing/NOTES.md) | `advanced/02` Chunking strategy |
| 05 | ✅ | RAG | [topics/05-rag](topics/05-rag/NOTES.md) — `POST /upload` (Step 2.2) done incl. chunk+embed+store+`documents` table+`GET /documents`; frontend (Step 2.2F) synced; `POST /chat` (Step 2.3) done — embed question, `searchSimilar()` scoped to documentId, grounded generation via `generateAnswer()`, verified end to end on real PDFs. | `advanced/06` LLM security (prompt injection) |
| 06 | ✅ | Conversation memory | [topics/06-conversation-memory](topics/06-conversation-memory/NOTES.md) — `chat_messages` table + repository done; `/chat` rewritten as a 7-step pipeline (embed → search → load history → save user msg → build layered prompt → generate → save assistant reply); frontend generates one `sessionId` per document, reused across messages; sources display added to chat UI. Verified end to end in Neon (real session, 8 rows, correct history resolution on a vague follow-up). **Previously-known gap, now fixed:** added `GET /sessions` + `GET /sessions/:sessionId/messages`, and the frontend was redesigned around a ChatGPT-style history sidebar that persists the active `sessionId` to `localStorage` and rehydrates the transcript on reload — a refresh no longer orphans the conversation. **Also added:** `DELETE /documents/:documentId` (+ its chunks and chat history) and `DELETE /sessions/:sessionId`, wired to hover-revealed trash icons in the UI with a confirm step; and the frontend was restructured from one 500+ line `App.tsx` into `api/`, `types/`, `hooks/`, `utils/`, `components/` folders, plus a tagged console logger for tracing the upload/chat/session flow in devtools. | `advanced/03` Token counting & cost |
| 07 | ✅ | Streaming (SSE) | [topics/07-streaming-sse](topics/07-streaming-sse/NOTES.md) — Steps 3.1, 3.2, 3.2F done: throwaway `GET /tick` for the SSE mechanics, then `GET /chat-stream` (shared `buildChatPrompt()`, `streamAnswer()` async generator over Gemini's `streamGenerateContent?alt=sse`, `meta` / data / `done` / `error` events, `withErrorHandling()` for readable failures) and a frontend `EventSource` wrapper so replies type out live. The throwaway `/tick` has been deleted. **Step 3.3 (multi-document chat) also done:** `documentId` is optional — omitted/`'all'` searches every document, a real id searches one; sources carry the PDF filename; the chat header has a "Searching in" dropdown. **Next:** topic 08 (structured output / Zod) | — |
| 08 | ✅ | Structured output (Zod) | [topics/08-structured-output-zod](topics/08-structured-output-zod/NOTES.md) — Step 4.1 (Zod quiz schema, `sampleChunks`, `npm run step4` comparing plain vs structured-output mode, bad-reply gallery), **Step 4.2 `POST /quiz`** (validate → retry once → shuffle options, rejects `'all'`), and **Step 4.2F** (Generate-quiz button + modal UI, tested live in a browser) all done. **Next:** optional Step 4.3 (`POST /quiz/check`) + 4.3F, or move on to Phase 5 | `advanced/01` Prompt engineering |
| — | ⬜ | **Phase 5: tie it together, write it up** | see [ai-backend-roadmap.md](ai-backend-roadmap.md) Phase 5 | — |
| 09 | ⬜ | Background jobs (BullMQ) | [topics/09-background-jobs-bullmq](topics/09-background-jobs-bullmq/NOTES.md) | `advanced/05` Rate limiting & retries |
| 10 | ⬜ | Agents & tool calling | [topics/10-agents-tool-calling](topics/10-agents-tool-calling/NOTES.md) | `advanced/07` Vendor abstraction |
| 11 | ⬜ | Workflows (suspend/resume) | [topics/11-workflows-suspend-resume](topics/11-workflows-suspend-resume/NOTES.md) | — |
| 12 | ⬜ | Testing & observability | [topics/12-testing-observability](topics/12-testing-observability/NOTES.md) | `advanced/04` Evaluation |
| 13 | ⬜ | Deployment | [topics/13-deployment](topics/13-deployment/NOTES.md) | — |

**Milestone: you're job-ready here.** DocMind works end to end, deployed, and you can explain every concept above out loud without notes. Go apply / interview. The advanced pass below is for after that, not instead of it.

---

## Part 2.5 — production web-layer gaps (do these once, before or during interview prep)

Added after comparing this plan against a real production AI backend. The AI-specific concepts above already matched that repo closely — these three fill the remaining gaps: DocMind is REST-only with no auth and no multi-tenancy, but a real job will expect you to at least understand these.

| # | Topic | Notes |
|---|---|---|
| 14 | GraphQL + subscriptions | [topics/14-graphql-subscriptions](topics/14-graphql-subscriptions/NOTES.md) |
| 15 | Auth (JWT) | [topics/15-auth-jwt](topics/15-auth-jwt/NOTES.md) |
| 16 | Idempotency & multi-tenancy | [topics/16-idempotency-multi-tenancy](topics/16-idempotency-multi-tenancy/NOTES.md) |

These don't need a code change to DocMind necessarily — reading + notes is enough to be able to talk about them in an interview. If you want hands-on practice, add JWT auth to the `/chat` endpoint as a small side exercise.

---

## Part 3 — advanced pass (only start once Part 1+2 is fully checked off above)

Go in this order — it retraces the same path as above, just one level deeper each time:

| # | Topic | Notes | Do this after re-reading |
|---|---|---|---|
| A1 | Prompt engineering | [topics/advanced/01-prompt-engineering](topics/advanced/01-prompt-engineering/NOTES.md) | topic 08 |
| A2 | Chunking strategy | [topics/advanced/02-chunking-strategy](topics/advanced/02-chunking-strategy/NOTES.md) | topic 04 |
| A3 | Token counting & cost | [topics/advanced/03-token-counting-cost](topics/advanced/03-token-counting-cost/NOTES.md) | topic 06 |
| A4 | Evaluation | [topics/advanced/04-evaluation](topics/advanced/04-evaluation/NOTES.md) | topic 12 |
| A5 | Rate limiting & retries | [topics/advanced/05-rate-limiting-retries](topics/advanced/05-rate-limiting-retries/NOTES.md) | topic 09 |
| A6 | LLM security | [topics/advanced/06-llm-security](topics/advanced/06-llm-security/NOTES.md) | topic 05 |
| A7 | Vendor abstraction | [topics/advanced/07-vendor-abstraction](topics/advanced/07-vendor-abstraction/NOTES.md) | topic 10 |

---

## How to not get lost

- **Always be on exactly one row.** If you're mid-topic, that's your row — don't open two topics at once.
- **A topic isn't "done" until its `NOTES.md` has real answers in your own words**, not just code that runs. Checking a box here means the notes are filled, not just that you ran a script.
- **If you forget where you are**, just open this file — the last unchecked row in the first table (or second, if Part 1+2 is done) is what you do next. Nothing else to track.
