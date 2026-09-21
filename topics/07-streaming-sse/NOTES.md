# 07 — Streaming (SSE)

Roadmap: Phase 3

## What is it?

Streaming means the answer shows up as it's being written, word by word, instead of me staring at a blank screen until the whole thing is ready. The AI doesn't actually get faster. The first words just appear sooner, so it *feels* fast.

I did it with SSE (Server-Sent Events): the server keeps the connection open and keeps writing small pieces into it, and the browser's `EventSource` reads them as they arrive.

## Key facts

- SSE goes one way only (server → browser) over plain HTTP. WebSockets go both ways and are more work. I don't need that for a chat reply.
- On the server it's three things: the `text/event-stream` header, lots of `res.write()` calls instead of one `res.json()`, and one `res.end()` at the end.
- Each piece looks like `data: ...` followed by a blank line. The blank line is what marks the end of one event.
- `/chat-stream` is GET, not POST like `/chat`, because `EventSource` can only send GET. So the question goes in the URL.
- I still save the *full* answer to the database once the stream ends. I just add up the pieces as they go past.
- Order I send things: `meta` first (session id + sources), then the text pieces, then `done`.
- The bug that got me: Gemini ends its lines with `\r\n`, not `\n`, so my code that splits on a blank line never matched anything. One line to fix (replace `\r\n` with `\n`), way longer to find.
- Once a stream has started, the status code is already sent, so I can't turn it into a 500 anymore. Errors have to go *inside* the stream as an `error` event.
- I built a throwaway `/tick` route first (tick 1... tick 5) just to get the basics, then deleted it.

## Questions / things that felt unclear

- `EventSource` reconnects by itself if the connection ends. I close it after `done` so it can't re-send my question, but I still want to understand that properly.
- If someone closes the tab halfway through an answer, does my server keep going until Gemini finishes? I think yes, but I haven't checked.
