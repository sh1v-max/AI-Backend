# 06 — Conversation Memory

`/chat` works, but try this right now: ask "what projects has this person built?", get a real answer, then ask "tell me more about the first one." The second question will fail — not because retrieval is broken, but because the model has no idea what "the first one" refers to. This topic fixes that.

---

## The core problem: LLM calls are stateless

Every call to `generateAnswer(prompt)` is a completely fresh, isolated request. The model doesn't remember your previous message — it has *zero* awareness that a previous message even existed, unless you explicitly include it in the current prompt. There's no hidden session, no server-side memory on Google's end tracking "this is the same conversation as five seconds ago." Each API call starts from nothing.

So "the chatbot remembers what I said" isn't actually a property of the LLM — it's an illusion created by *you* re-sending the relevant history every single time. ChatGPT, Claude, every chat product you've used — all of them work this way under the hood: the app maintains a message history, and re-sends the recent messages as part of every new request.

## What "giving it memory" actually means, concretely

1. **Store every message** — both what the user asked and what the assistant replied — in a database table, not just in memory
2. **On each new `/chat` call, pull the recent history** for this specific conversation
3. **Build the prompt as three layered pieces**, not just "context + question" like Step 2.3 currently does:
   ```
   [system: RAG context from searchSimilar()]
   [last N messages from history]
   [new user message]
   ```
4. **Save the new exchange** (user message + assistant reply) back to the table once the response is generated, so the *next* call has it available too

## The missing piece: a session

Right now, `/chat` only takes `documentId` + `message` — there's no concept of "which conversation is this part of." If you're chatting about the same document from two different browser tabs (or the same tab, twice), there's currently no way to tell those apart, and no way to know which messages belong together as one conversation thread.

This is what a **`sessionId`** solves — a separate identifier from `documentId`. One document can have multiple independent chat sessions against it (two different users, or the same user starting a fresh conversation). The table needs both: `documentId` says *what* is being discussed, `sessionId` says *which conversation thread* this message belongs to.

```sql
chat_messages (id, sessionId, documentId, role, content, createdAt)
```
- `role` — `'user'` or `'assistant'`, so you know who said what when reconstructing history
- Ordered by `createdAt` (or `id`, since it increments in order) to reconstruct the conversation in the right sequence

## Why cap the history instead of sending everything?

A conversation that's gone on for 50 turns can't reasonably have all 50 turns re-sent on message 51 — every single message would cost more tokens (money) than the last, and eventually you'd hit the model's context window limit entirely (the hard ceiling on how much text it can process in one request). The practical fix for this project: cap it — only pull the **last 6-10 messages**, not the full history.

This is a real, deliberate simplification, not a bug. Real production systems handle long conversations differently — usually by *summarizing* older messages into a compact form instead of dropping them outright, so the model retains the gist of a long conversation without paying full token cost for every word of it. That's a genuinely deeper topic (`topics/advanced/03-token-counting-cost` touches this), and capping at N recent messages is the right-sized version for what this project needs right now.

## How this changes the `/chat` prompt from Step 2.3

**Before (Step 2.3):**
```
Answer using only this context: {chunks}
Question: {message}
```

**After (Step 2.4):**
```
Answer using only this context: {chunks}

Conversation so far:
user: what projects has this person built?
assistant: TaskForge, WatchFlix, BiteSwift, BookVerse...

New question: tell me more about the first one
```

The RAG-retrieved context still grounds the answer in the document (unchanged from Step 2.3). What's new is the conversation history sitting between the context and the new question — that's what lets "the first one" resolve to "TaskForge," because the model can now see what was discussed a moment ago.

## Where this connects

```
2.3 (done)  → single-turn: question in, grounded answer out, no memory between calls
2.4 (here)  → add a sessionId + chat_messages table, pull recent history into every prompt
07 streaming → the next phase streams this same memory-aware response token by token instead of all at once
```

---

## What you need to learn

- [ ] **LLMs are stateless between calls** — "memory" is an illusion built by the application, not a property of the model itself
- [ ] **Why a `sessionId` is needed, separate from `documentId`** — one document can have multiple independent conversation threads
- [ ] **The three-part prompt structure** — RAG context, then history, then the new question — and why order matters (context grounds the facts, history grounds the *conversation*, the question is what's actually being asked right now)
- [ ] **Why history gets capped, not sent in full** — token cost and context window limits, deferred to a deeper pass in `advanced/03-token-counting-cost`
- [ ] **Save-after-generate, not save-then-generate** — the assistant's reply only gets stored *after* the LLM successfully responds, so a failed request doesn't leave a phantom/incomplete turn in history

## What to build (Step 2.4 of the roadmap)

1. Add a `chat_messages` table: `id, sessionId, documentId, role, content, createdAt`
2. Add repository functions: `insertMessage(sessionId, documentId, role, content)` and `getRecentMessages(sessionId, limit)`
3. Update `/chat` to accept a `sessionId` (generate one client-side or server-side if not provided — decide which when building)
4. On each call: save the incoming user message, pull the last 6-10 messages for that session, build the layered prompt, call the LLM, save the assistant's reply too
5. Test the actual thing this is for: ask a question, then a vague follow-up ("what about the next part?"), and confirm the model resolves it correctly because it can now see the earlier turn

## Resources

No new external tool here — this is entirely about prompt construction and one new table, using everything already built (Drizzle, the repository pattern, `generateAnswer`).

## After you finish

Fill in [NOTES.md](NOTES.md) — specifically, test the failure case first (ask a vague follow-up *before* this step exists, confirm it fails) so the fix is provably meaningful, not just assumed to work.
