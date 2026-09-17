# 07 — Streaming (SSE)

Right now, `/chat` makes you wait. You send a question, then nothing happens for 1-3 seconds while embedding, search, and generation all run — then the *entire* answer appears at once. Every real chat product you've used (ChatGPT, Claude, Gemini) doesn't work this way — the reply types itself out, word by word, starting almost immediately. This topic is how that actually works.

---

## Why stream at all — it's about *perceived* speed, not real speed

Streaming doesn't make the LLM generate the answer any faster. The total time to produce the full response is roughly the same either way. What changes is **when the user sees the first sign of progress**. Waiting 2 seconds staring at a blank screen feels slow and broken. Watching words appear starting at 200ms, even if the *whole* answer still takes 2 seconds to finish, feels fast and alive. This is a genuinely well-studied UX principle — perceived latency matters as much as actual latency, sometimes more.

## What SSE actually is

**SSE (Server-Sent Events)** is a simple, one-directional streaming protocol built directly into HTTP — the server keeps a connection open and sends pieces of data to the client over time, instead of one complete response and then closing. It's *not* the same as WebSockets: WebSockets are full duplex (both sides can send anytime, more complex to set up), SSE is server-to-client only, which is exactly what a streaming chat reply needs — the client already sent its question, now it just needs to *receive* pieces.

The wire format is deliberately simple — plain text, each chunk looks like:
```
data: Hello
data: there

```
(a `data:` line, then a blank line to mark "end of this event"). The browser's built-in `EventSource` API understands this format natively — you don't need a library to parse it.

## The mechanics on the server side

Three things distinguish a streaming Express response from a normal one:

```ts
res.writeHead(200, {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
})
```
- `text/event-stream` — the header that tells the browser "this is SSE, keep the connection open and hand me pieces as they arrive," not "wait for the full response."
- `no-cache` — nothing about a live stream should be cached.
- `keep-alive` — don't close the connection after one write.

```ts
res.write(`data: ${chunk}\n\n`)
```
Instead of `res.json(...)` once at the end, you call `res.write(...)` **multiple times**, once per piece of data, each formatted as an SSE event. The connection stays open between writes.

```ts
res.end()
```
Called once, after the last piece — this is what actually closes the connection and tells the client "that's everything."

## Why the roadmap does this in two steps

**Step 3.1 — a throwaway `/tick` endpoint** that just writes "tick 1", waits a second, "tick 2", etc. — no LLM, no real logic. This exists purely to get comfortable with the *mechanics* (headers, `res.write`, the connection staying open, what `EventSource` looks like on the client) in total isolation, before mixing it with everything `/chat` already does. Once it clicks, delete it — it's scaffolding, not part of DocMind.

**Step 3.2 — the real thing**: `GET /chat-stream`, same logic as `/chat` (embed, search, load history, build prompt) but instead of one `generateAnswer()` call that waits for the full text, you call Gemini's **streaming** generation endpoint and forward each piece to the client as it arrives.

## The one real API difference: GET, not POST

Here's a genuine constraint worth knowing, not a style choice: the browser's built-in `EventSource` only supports **GET** requests — it can't send a JSON body or custom headers the way `fetch(..., { method: 'POST' })` can. So `/chat-stream` has to take its parameters as **query string parameters**, not a JSON body:

```
GET /chat-stream?sessionId=...&documentId=...&message=...
```

This is a real, practical reason `/chat` (POST, JSON body) and `/chat-stream` (GET, query params) can't share the exact same request shape, even though their internal logic is nearly identical.

## Streaming from Gemini itself

Gemini's API has a separate streaming endpoint — `:streamGenerateContent` instead of `:generateContent` — which returns its response as a stream of partial pieces instead of one complete JSON object. The mechanical shape: read the response body as a stream (Node's `fetch` gives you a `ReadableStream`/async-iterable body), and as each piece of generated text arrives from Gemini, immediately `res.write()` it out to your own client as an SSE event — you're relaying one stream into another, not buffering the whole thing first.

**Still gotta save the full message afterward.** Streaming changes *how* the answer reaches the client, not what needs to happen once it's done — you still accumulate the full answer text as it streams (concatenating each piece), and once the stream ends, call `insertMessage(sessionId, documentId, 'assistant', fullAnswer)` exactly like Step 2.4 already does. History doesn't care whether the reply arrived all at once or piece by piece — by the time it's saved, it's just a string either way.

## Where this connects

```
2.3/2.4 (done)  → /chat: full request/response, memory-aware, but the client waits for everything
07 (here)       → /chat-stream: same logic, but the answer arrives progressively
08 structured   → the next phase (quiz generation) goes back to non-streaming — a quiz needs to
                   arrive as one complete, valid JSON object, not word-by-word text
```

---

## What you need to learn

- [ ] **Streaming is about perceived latency, not total speed** — the answer doesn't finish faster, it just starts appearing sooner
- [ ] **SSE vs WebSocket** — SSE is one-directional (server → client), simpler, built on plain HTTP, exactly enough for this use case
- [ ] **The three server-side pieces**: streaming headers, multiple `res.write()` calls, one final `res.end()`
- [ ] **Why `/chat-stream` has to be GET with query params** — `EventSource` can't send a POST body
- [ ] **Streaming doesn't change what gets saved to history** — you still accumulate the full text and save it once the stream completes, same as before

## What to build

**Step 3.1** — a throwaway `GET /tick` endpoint: write "tick 1", wait ~1s, "tick 2", etc., for a few ticks, then end. Open it directly in a browser tab and watch it. Delete once understood.

**Step 3.2** — `GET /chat-stream?sessionId=...&documentId=...&message=...`: same embed → search → load history → build prompt pipeline as `/chat`, but call Gemini's streaming endpoint and forward each piece via SSE as it arrives. Save the complete accumulated answer to history once the stream ends, same as `/chat` already does.

**Frontend**: swap the chat UI's `fetch()` call for `EventSource`, appending each incoming piece to the in-progress reply as it streams in.

## Resources

- [Crash Course: SSE with Express.js & EventSource (YouTube)](https://www.youtube.com/watch?v=ieUsuDsQY0o)
- [Gemini API docs – Text generation & streaming](https://ai.google.dev/gemini-api/docs/text-generation) — look for `stream: true` / the `:streamGenerateContent` endpoint

## After you finish

Fill in [NOTES.md](NOTES.md) — specifically, be able to explain in your own words why `/chat-stream` needed to become a GET endpoint when `/chat` is POST. That's the detail most likely to come up if someone asks "why do you have two different chat endpoints instead of one?"
