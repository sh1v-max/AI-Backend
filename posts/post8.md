# Post 8 — Source notes

Source notes for a LinkedIn post and a Twitter/X post. Only use facts from this file.

**Project:** DocMind — upload a PDF, chat with it (with memory), watch the answer stream in live. Built from scratch to understand how AI backends work: Node + TypeScript + Express, Postgres/pgvector, Drizzle, Gemini, React. No AI framework.

---

## What I did today

**1. Fixed streaming for real**
- The streamed answer comes from Gemini as Server-Sent Events. Gemini ends each line with `\r\n`, but my parser split on `\n\n`, so events weren't parsed properly. Fix: normalize `\r\n` → `\n` on the whole buffer (so a `\r\n` split across two network chunks is still caught).
- Errors were hiding their own cause. Drizzle's failed-query error includes every bound parameter — for a vector search that's **3,072 embedding numbers** dumped into the log. I wrote a small helper that prints just the first line, the chain of underlying causes, and the first stack frame in my own code.
- A stream can't change its HTTP status once it starts, and the browser's `EventSource` can't read the body of an error response. So stream errors are sent *inside* the stream as an `error` event.

**2. Split a 449-line `index.ts` into 7 lines**
- It did five jobs and repeated ~60 lines of identical code between `/chat` and `/chat-stream`.
- Now: routes (read request, write response) → services (the actual work, never touch `req`/`res`) → repositories (all SQL).
- Rule I set: refactor only what the next feature needs; new features get their own files from the start.
- I tested by breaking things on purpose (bad API key, bad IDs, empty input) and checked the error output was unchanged.

**3. Multi-document chat**
- Before: every chat was pinned to one PDF. Now the default is "search all my PDFs", with "one specific PDF" as the override.
- Each source now shows which PDF it came from, and the model is told to name the document it used.
- I stored an `'all'` marker in an existing column instead of migrating a live database.
- UI: an "All documents" option and a "Searching in ▾" dropdown in the chat header.
- **Bug found by testing on real data:** some answers cited "the first unknown document". My database had old test chunks with no matching document record — invisible in the UI, but retrieved by "search everything". Fix: all-documents search only uses chunks whose document exists.

**4. Documentation**
- Wrote `CLAUDE.md` (project context file for AI chats) and a ~750-line walkthrough of the whole codebase with a clickable `file:line` link for every explanation — 298 links, all checked by a script.

---

## Numbers
- `index.ts`: **449 → 7 lines**
- ~60 lines of duplicated pipeline code → one function
- **3,072** numbers in a single error log
- **298** verified code links in the walkthrough
- 5 PDFs in the multi-document test, 0 browser console errors

## Lessons (quotable)
- "A stream can't change its status code after it starts — errors have to travel inside it."
- "An error log with 3,072 numbers in it is not a log."
- "Testing on real data finds bugs clean test data never will."
- "RAG can answer what a document says — not which documents you have."
- "Refactor before the next feature, and only as much as it needs."

## Don't overclaim
- Tradeoff found: searching all PDFs shares the top 3 chunks across them, so a vague question like "which documents do you have?" was answered from only one file.
- Error logs go to the terminal only for now; there are no automated tests yet (checked manually with curl and a headless browser).
- Quiz generation hasn't started.

## Next
Phase 4: getting an LLM to return reliable structured data (a quiz generator) using Zod.

## Hook ideas
1. "My chatbot answered from 'the first unknown document.' It didn't exist."
2. "One character (`\r`) broke my streaming parser."
3. "An error log with 3,072 numbers in it is not a log."
4. "I cut a 449-line file to 7 without losing a single log line."
