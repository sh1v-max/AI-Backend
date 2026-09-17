# 06 — Conversation Memory — In My Own Words

Roadmap: Phase 2, Step 2.4 · Guide: [README.md](README.md)

## What "memory" actually is, simply

The AI doesn't remember anything on its own. Every single call to it is a fresh, blank slate — it has zero idea a previous message even existed unless I physically paste that previous message back into the new request. So "the chatbot remembers what I said" isn't a real feature of the model — it's an illusion *I* create by re-sending the recent conversation every single time. That one realization made the whole topic click.

## What I actually built

- A `chat_messages` table: `id, sessionId, documentId, role, content, createdAt` — one row per message, both mine and the AI's.
- Two functions: `insertMessage()` (save one message) and `getRecentMessages(sessionId, limit)` (pull the last N for one conversation, in the right order).
- `/chat` now does 7 things instead of 5: embed question → search chunks → **load history** → save my message → build a prompt with context + history + question → generate → **save the reply too**.

## The "last N" trick that actually took a second to get

To get "the last 8 messages, oldest first," you can't just sort oldest-first and grab 8 — that gives you the *first* 8 messages of the whole conversation, the opposite of what I want. The actual trick: sort **newest first**, take 8, then `.reverse()` the array back into chronological order in code. Sort-limit-reverse. Small thing, but it wasn't obvious until I actually thought through why "oldest first + limit" gives the wrong 8 messages.

## sessionId vs documentId — finally clear on the difference

- `documentId` = *what* document is this about
- `sessionId` = *which specific conversation thread* is this part of

One document can have many sessions (different tabs, different days, restarting a chat). Without `sessionId`, there'd be no way to keep two separate conversations about the same PDF from bleeding into each other.

## Where sessionId actually lives — and the gap I now know about

The frontend generates one `sessionId` per document, the first time I send a message to it, and reuses it after that — but only in React state, in memory. Nothing gets saved to `localStorage`. So:
- Same tab, same document → same session, memory works
- Different tab → brand new session, even for the same document
- **Refresh the page → I lose it.** Not the data (it's still sitting safely in Postgres, I can literally see it in Neon), just the *connection* to it. The next message after a refresh starts a fresh session with no memory of before.

This is a known, written-down gap (in PROGRESS.md now), not a bug I'm pretending doesn't exist. Fix later = persist sessionId + fetch old history back on load.

## Confirmed by actually running it

- [x] Asked about "3 pipelines in RAG," then asked "what's the first stage?" — a genuinely meaningless question on its own — and it correctly resolved it using history
- [x] Checked Neon directly — 8 rows, all sharing one `session_id`, alternating `user`/`assistant`, in the right order
- [x] Confirmed `HISTORY_LIMIT = 8` is the one single number controlling how much gets remembered — nothing else needs to change if I want more/less memory later

## Bonus thing I fixed while I was in here

The backend was already sending back `sources` (which chunks + distance scores an answer was grounded in) since Step 2.3 — I just never had the frontend read it. Added a collapsible "sources" section under each reply. Good reminder that not every gap is a backend problem — sometimes the data's already there and nothing's reading it.

## What still feels a little shaky

- The refresh-loses-session thing, obviously — known, written down, not fixed yet.
- I capped history at a flat number (8) instead of anything smarter like summarizing old messages. Fine for now, real systems do better — that's a later, deeper topic.
