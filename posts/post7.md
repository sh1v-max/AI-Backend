# AI Backend Learning Journey — Day 7 Context (for LinkedIn + Twitter)

## Instructions for Claude

Use the `post-writer-sms` skill to write both a LinkedIn post and a Twitter/X post (or thread) based on everything below. Tone: genuine, technical but accessible, real hands-on progress — not buzzwords. I'm a frontend/full-stack engineer learning AI backend development from scratch, documenting the journey publicly. This is day 7 — see `post1.md` through `post6.md` for continuity (embeddings → pgvector → Drizzle → PDF parsing → the full RAG loop → conversation memory + session persistence). Today was streaming — the thing that makes a chatbot's reply type itself out word by word instead of appearing all at once. LinkedIn can go longer/narrative. Twitter can be a thread — the "words typing themselves out for the first time" moment is a good visual/demo-able beat even in text form.

---

## What I built today

Every real chat product — ChatGPT, Claude, Gemini — streams its replies. Up to today, mine didn't: you'd send a question and wait 1-3 seconds staring at nothing, then the *entire* answer would appear at once. Today I built the real thing: word-by-word streaming, from the raw mechanics up to a working end-to-end feature.

### 1. Learned the mechanics in total isolation first

Before touching any real logic, I built a throwaway endpoint that does nothing but count — `tick 1`, `tick 2`, `tick 3`, one per second. No AI, no database, just the three things that make a streaming HTTP response actually work: special headers (`text/event-stream`), calling `res.write()` multiple times instead of `res.json()` once, and keeping the connection open between writes instead of closing it. Getting comfortable with that in isolation, before mixing it with everything `/chat` already does, made the real version much less overwhelming to build.

### 2. Verified the real streaming API before writing code against it

Instead of trusting docs blindly (learned that lesson a few days ago the hard way), I made a real test call to Gemini's streaming endpoint first and inspected the raw response. Found that adding `?alt=sse` makes Gemini return genuine Server-Sent Events directly — `data: {...}` lines, same format as what I'd need to send to my own frontend. That one discovery made relaying the stream straightforward: decode bytes, split on event boundaries, parse each JSON payload, forward just the text piece.

### 3. Built the real thing — same brain, different delivery

`GET /chat-stream` runs the *exact* same pipeline as `/chat` — embed the question, search the document's chunks, load conversation history, build the grounding prompt — the only thing that changes is how the answer gets delivered: piece by piece over an open connection instead of one complete JSON response at the end. Extracted the prompt-building logic into a shared function so both endpoints use the identical instructions, instead of maintaining two copies of the same 15-line prompt template.

One real, non-obvious constraint I had to design around: the browser's built-in `EventSource` (what actually consumes an SSE stream) can only send GET requests — no JSON body, no custom headers. So `/chat-stream` takes its parameters as query params instead of a POST body, which is a genuine API-shape difference from `/chat`, not a style choice.

### 4. The frontend — text typing itself into existence

Wired up `EventSource` on the frontend, with one message bubble that gets created once and then grows in place as each chunk arrives — same array slot, content appended incrementally. Hit one genuine gotcha: `EventSource` fires its own native `error` event both for real connection failures *and* for my own custom server-sent error messages — had to distinguish them by checking whether the event actually carried data or not.

Conversation memory still works exactly the same underneath — the full answer gets accumulated as it streams and saved to history once done, same as before. Streaming changed *how* the reply travels, not what gets remembered.

## The bigger takeaway

Streaming looked intimidating from the outside — a completely different way of thinking about HTTP responses. It turned out to be mechanically simple (three lines of setup, a loop of writes, one close) wrapped around logic I'd already built days ago. The actual hard part wasn't streaming itself — it was correctly relaying *someone else's* stream (Gemini's) into *my own* stream (to the browser), and that only became easy once I stopped guessing at the API shape and actually looked at what Gemini was sending back.

## What's next

Phase 4 — structured output. Forcing an LLM to reliably return valid JSON (a multiple-choice quiz, specifically) instead of free-form text, validated with Zod. The one part of this project that goes back to *not* streaming, on purpose — a quiz needs to arrive as one complete, valid object, not word by word.
