# AI Backend Learning Journey — Day 8 Context (for LinkedIn + Twitter)

## Instructions for Claude

Use the `post-writer-sms` skill to write both a LinkedIn post and a Twitter/X post (or thread) based on everything below. Tone: genuine, technical but accessible, real hands-on progress — not buzzwords, not "excited to announce." I'm a frontend/full-stack engineer learning AI backend development from scratch, documenting the journey publicly. This is day 8 — see `post1.md` through `post7.md` for continuity (embeddings → pgvector → Drizzle → PDF parsing → the full RAG loop → memory → streaming). Only use facts from this file, and respect the "Don't overclaim" section.

Post 7 ended with "next: Phase 4." Today I deliberately didn't start it — I spent the day making Phase 3 trustworthy first. LinkedIn can be longer and narrative: "the demo worked, so I spent a day making it deserve to be called done." Twitter can be a thread; the orphaned-data bug and "449 lines → 7" are the strongest beats.

---

## What I built today

Continuing **DocMind** (upload a PDF, chat with it, generate a quiz — built from scratch to actually understand AI backends). Streaming "worked" in the sense that words appeared on screen. Today was about everything that hides.

### 1. Making streaming survive real conditions

**A line-ending bug.** Gemini ends each streamed line with `\r\n`, but my parser split events on a blank line (`\n\n`), so it never matched. One line fixed it, applied to the whole buffer so a `\r\n` split across two network reads is still caught:
```ts
buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n')
```

**Errors that hid their cause.** Drizzle's failed-query error embeds the SQL *and every bound parameter* — for a vector search, that's **3,072 embedding numbers** dumped into the log, burying the real reason. I wrote a helper that prints just the first line, the chain of underlying causes (where `ECONNRESET` actually lives), and the first stack frame in my own code.

**A stream can't change its status code.** Once streaming starts, the HTTP status is already sent, and the browser's `EventSource` can't read an error response's body anyway. So stream errors travel *inside* the stream as an `error` event.

### 2. Splitting a 449-line `index.ts` without losing a log line

It did five jobs, and `/chat` and `/chat-stream` repeated ~60 lines of identical code. The next feature would change exactly that part — so *that* was the reason to do it now, not a general urge to tidy. It's now 7 lines, organized as **route → service → repository**: a route only reads the request and writes the response; a service does the work and never touches `req`/`res` (so a background worker can reuse it later); SQL stays in repositories.

My one constraint: don't lose my error logging. So it was "move code, don't change behavior," verified by breaking things on purpose — bad API key, unknown document, empty input — and checking the same readable errors appeared. Going forward: refactor only as much as the next feature needs.

### 3. Multi-document chat — and a bug only real data could find

Chats were pinned to one PDF. Now the default is "search all my PDFs," with "just this one" as the override.
- `documentId` became optional. Because the pipeline was already in one function, the change went in one place, and the streaming route needed nothing.
- **No migration:** the column storing a chat's document is `NOT NULL`, and I didn't want to alter a live table — so "all documents" is stored as the value `'all'`. A little hacky; I never touched live data.
- Sources now name their PDF, and in "all" mode the prompt labels each chunk and asks the model to name the document it used.
- UI: an "All documents" option and a "Searching in ▾" dropdown. Switching starts a *new* chat, so one thread never mixes scopes.

**The bug:** testing on my real data, some answers cited "the first unknown document" — which doesn't exist. A read-only query found **8 groups of stored chunks with no matching document record**, leftovers from early test uploads before I had a documents table. Invisible in the UI (so I couldn't delete them), but "search everything" was retrieving them into answers. Fix: all-documents search only uses chunks whose document exists. I left the orphaned rows in place — deleting them is my call, not a script's.

### 4. Writing down what the project knows

Because I open fresh AI chats when one gets heavy: a `CLAUDE.md` project-memory file that lives *in the repo* (so it travels with the code), and a ~750-line walkthrough of every file with a clickable `file:line` link on each explanation — a script checked all 298 links resolve.

## The bigger takeaway

Nothing today was a headline feature. Every item was about *trust*: in my error messages, in the structure of the code, in the data behind the answers. The multi-document bug is the clearest case — it worked perfectly on clean test data and failed only on the messy thing I'd forgotten I'd left in my own database. "It works" and "it's done" are different milestones, and the gap between them is edge cases you only find with real data.

## What's next

Phase 4 — structured output: making an LLM return a quiz as reliable, validated data (Zod) instead of prose. The one part that goes back to *not* streaming, on purpose.

---

## Numbers you can quote
- `index.ts`: **449 → 7 lines**; ~60 duplicated lines → one function
- **3,072** numbers in a single error log
- **8** orphaned chunk groups in my own database; **5** PDFs in the test; **0** browser console errors
- **298** code links in the walkthrough, all script-checked

## Don't overclaim
- "All documents" shares the top 3 chunks across every PDF, so a vague question like "which documents do you have?" was answered from just one file. Retrieval answers "what does the document say," not "what documents do I have." Intent routing is the planned fix.
- Better error handling covers only the two chat routes; a wrong API key still shows a misleading "check your connection." Errors go to the terminal, not a file.
- The orphaned chunks are excluded from search, **not deleted**.
- No automated tests yet — verified by hand (curl, plus a headless browser for the UI).
- `CLAUDE.md` and the walkthrough are working aids, not product features. Quiz generation hasn't started.

## Hook ideas
1. "My chatbot answered from 'the first unknown document.' It didn't exist."
2. "One character (`\r`) broke my streaming parser."
3. "An error log with 3,072 numbers in it is not a log."
4. "I cut a 449-line file to 7 without losing a single log line."
5. "The demo worked. So I spent a day making it deserve to be called done."
