# 07 — Streaming (SSE)

**Roadmap: Phase 3**

---

# 1. What is Streaming?

Normally, when we make an API request:

```text
Client → Request → Server
                    ↓
                 processing
                    ↓
Client ← Complete response
```

The browser waits until the server has the **entire answer**.

For an AI chatbot, that can feel slow.

### Streaming

Streaming means:

> The server starts sending the answer as soon as pieces are available instead of waiting for the entire answer.

```text
Client → Request
             ↓
          Server
             ↓
        "RAG"
             ↓
        " stands"
             ↓
        " for"
             ↓
        " Retrieval..."
             ↓
           DONE
```

The AI itself isn't necessarily generating faster.

**The user simply sees the first words sooner.**

---

# 2. Simple Analogy

### Normal response

Imagine ordering food:

> "Wait outside the restaurant. I'll give you the entire meal when everything is ready."

You wait 30 minutes.

### Streaming

The restaurant says:

> "I'll give you each part as soon as it's ready."

```text
Drink → starter → main course → dessert
```

You start receiving things immediately.

That's basically streaming.

---

# 3. What is SSE?

**SSE = Server-Sent Events.**

It's a way for the **server to continuously send events/data to the browser over one HTTP connection.**

The important part:

```text
Server → Browser
```

It is primarily **one-way**.

The client makes the initial request, then the server can keep sending data over that open connection.

---

# 4. Normal HTTP vs Streaming

### Normal HTTP

```text
Browser
   │
   │ GET /shows/1353
   ↓
Server
   │
   │ complete response
   ↓
Browser
   │
   ↓
connection closes
```

One request → one response → done.

For example:

```json
{
  "id": 1353,
  "title": "Some Show"
}
```

---

### Streaming

```text
Browser
   │
   │ GET /chat-stream
   ↓
Server
   │
   ├── "RAG"
   ├── " stands"
   ├── " for"
   ├── " Retrieval"
   ├── " Augmented"
   ├── " Generation"
   │
   ↓
connection closes
```

**Still one HTTP request and one HTTP response.**

We're NOT making a new HTTP request for every piece.

The response simply stays open while the server keeps writing data into it.

---

# 5. The Important Mental Model

Think:

```text
ONE REQUEST
     ↓
ONE OPEN RESPONSE
     ↓
chunk
chunk
chunk
chunk
chunk
     ↓
res.end()
     ↓
connection closes
```

Not:

```text
request → response
request → response
request → response
```

The second one is **polling**, which is different.

---

# 6. Polling vs Streaming

### Polling

The client repeatedly asks:

> "Anything new?"

```text
Client → GET /status
Server → "Not yet"

Client → GET /status
Server → "Not yet"

Client → GET /status
Server → "50% done"

Client → GET /status
Server → "Done"
```

There are **multiple HTTP requests**.

---

### Streaming

The client asks once:

```text
Client → GET /chat-stream
```

The server keeps the connection open:

```text
Server → "RAG"
Server → " stands"
Server → " for"
Server → " Retrieval"
Server → " Augmented"
Server → " Generation"
```

Then:

```text
Server → connection closed
```

### Remember

> **Polling = repeatedly making requests.**

> **Streaming = one connection, progressively receiving data.**

---

# 7. SSE vs WebSocket

### SSE

```text
Server ─────────→ Browser
```

One-way.

Good for:

* AI responses
* notifications
* live updates
* progress updates
* dashboards

### WebSocket

```text
Server ←────────→ Browser
```

Two-way communication.

Good for:

* multiplayer games
* live chat
* collaborative editing
* situations where both sides constantly communicate

For a chatbot where the main requirement is:

> "Server, give me the generated answer piece by piece."

SSE is often enough.

---

# 8. Why Does `/chat-stream` Use GET?

At first it seems strange:

> "I'm sending a chat message. Shouldn't I use POST?"

Usually, yes — **POST is commonly used when submitting data.**

For example:

```http
POST /chat
```

with:

```json
{
  "message": "Explain RAG",
  "documentId": "123"
}
```

But streaming itself does **not require GET**.

You can stream with POST too.

The reason this project uses:

```http
GET /chat-stream
```

is because the frontend uses the browser's native:

```js
EventSource
```

And **native `EventSource` makes GET requests.**

So:

```text
EventSource
     ↓
GET /chat-stream
     ↓
SSE connection
     ↓
server streams events
```

That's why the backend is designed around GET.

---

# 9. GET Doesn't Mean "No Data"

A GET request can absolutely contain input.

For example:

```http
GET /shows/1353
```

The `1353` is input from the client.

Or:

```http
GET /chat-stream?message=Explain+RAG&documentId=123
```

The message is also input.

The difference is **where the input is sent**.

---

# 10. `req.query` vs `req.body`

Your normal chat endpoint:

```ts
chatRouter.post('/chat', async (req, res) => {

    const { message, documentId } = req.body

})
```

The client sends:

```json
{
  "message": "Explain RAG",
  "documentId": "123"
}
```

---

Your streaming endpoint:

```ts
chatRouter.get('/chat-stream', async (req, res) => {

    const documentId = req.query.documentId
    const message = req.query.message
    const sessionId = req.query.sessionId

})
```

The client sends:

```text
/chat-stream?documentId=123&message=Explain%20RAG&sessionId=abc
```

So:

```text
POST /chat
     ↓
req.body

GET /chat-stream?...
     ↓
req.query
```

This is **not because streaming requires `req.query`**.

It's because this particular endpoint uses GET.

---

# 11. Could We Use POST for Streaming?

Absolutely.

For example:

```ts
chatRouter.post('/chat-stream', async (req, res) => {

    const { message, documentId } = req.body

    // streaming...

})
```

And the frontend could send:

```js
fetch('/chat-stream', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        message: 'Explain RAG',
        documentId: '123'
    })
})
```

The server can still do:

```ts
res.write(...)
res.write(...)
res.write(...)
res.end()
```

So:

> **GET/POST and streaming are separate concepts.**

Both GET and POST can have streaming responses.

---

# 12. Why Not POST + EventSource?

Because native:

```js
new EventSource(url)
```

only supports the GET-style SSE connection.

It doesn't let you do:

```js
new EventSource(url, {
    method: 'POST'
})
```

So if we want POST + streaming, we normally use:

```js
fetch()
```

and manually read the streaming response.

---

# 13. EventSource

`EventSource` is a browser API specifically designed for consuming **SSE streams**.

Example:

```js
const eventSource = new EventSource(
    '/chat-stream?message=Explain%20RAG'
)
```

The browser makes:

```http
GET /chat-stream?message=Explain%20RAG
```

Then the connection stays open.

When the server sends:

```text
data: {"text":"RAG"}

```

EventSource receives the event.

You can handle it:

```js
eventSource.onmessage = (event) => {

    const data = JSON.parse(event.data)

    setAnswer(prev => prev + data.text)

}
```

So EventSource makes consuming SSE **very convenient**.

---

# 14. Why EventSource Is Convenient

Without EventSource, we'd have to manually deal with the response stream.

With EventSource:

```text
Server
  ↓
SSE
  ↓
EventSource
  ↓
onmessage()
  ↓
React state
  ↓
UI updates
```

The browser handles the SSE event format for us.

---

# 15. POST + Streaming Without EventSource

We can use:

```js
const response = await fetch('/chat-stream', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        message: 'Explain RAG'
    })
})
```

Then:

```js
const reader = response.body.getReader()
```

`getReader()` gives us a way to **manually read chunks from the open HTTP response**.

Example:

```js
while (true) {

    const { value, done } = await reader.read()

    if (done) break

    console.log(value)
}
```

Conceptually:

```text
POST /chat-stream
       ↓
ONE open response
       ↓
reader.read() → chunk
reader.read() → chunk
reader.read() → chunk
reader.read() → chunk
       ↓
done
```

---

# 16. EventSource vs `getReader()`

They're not exactly the same thing.

### EventSource

Higher-level and SSE-specific:

```text
SSE server
    ↓
EventSource
    ↓
events
    ↓
your callback
```

It understands SSE events.

---

### `getReader()`

Lower-level:

```text
HTTP response
    ↓
response.body
    ↓
getReader()
    ↓
raw chunks
    ↓
you decode/process them
```

You have more manual work.

So remember:

> **EventSource = convenient SSE client.**

> **getReader() = manually read an HTTP response stream.**

---

# 17. Important: Chunks vs Events

These terms are related but aren't exactly identical.

A **chunk** is a piece of data arriving through the network.

An **SSE event** is data formatted according to the SSE protocol.

For example:

```text
data: {"text":"Hello"}

```

The blank line marks the end of the SSE event.

So:

```text
Network
   ↓
chunks of bytes
   ↓
SSE parser
   ↓
events
```

EventSource handles the SSE parsing for you.

---

# 18. SSE Format

A basic SSE event looks like:

```text
data: hello

```

Notice the blank line after it.

Multiple events:

```text
data: hello

data: world

data: goodbye

```

The blank line tells the SSE client:

> "This event is finished."

---

# 19. Named SSE Events

SSE can also have an event name:

```text
event: meta
data: {"sessionId":"abc"}

```

Then:

```text
event: done
data: {}

```

And:

```text
event: error
data: {"error":"Something failed"}

```

Frontend can listen specifically:

```js
eventSource.addEventListener('meta', (event) => {
    // handle metadata
})

eventSource.addEventListener('done', (event) => {
    // stream finished
})

eventSource.addEventListener('error', (event) => {
    // handle error
})
```

---

# 20. Your `/chat-stream` Backend

Your route is roughly:

```ts
chatRouter.get('/chat-stream', async (req, res) => {

    const documentId = req.query.documentId
    const message = req.query.message
    const sessionId =
        req.query.sessionId || randomUUID()

    // prepare prompt...

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    })

    // send metadata

    res.write(
        `event: meta\ndata: ${JSON.stringify({
            sessionId,
            sources
        })}\n\n`
    )

    // stream AI answer

    for await (const piece of streamAnswer(prompt)) {

        res.write(
            `data: ${JSON.stringify({
                text: piece
            })}\n\n`
        )

    }

    // finish

    res.write(`event: done\ndata: {}\n\n`)

    res.end()
})
```

---

# 21. What Does `text/event-stream` Mean?

This header:

```http
Content-Type: text/event-stream
```

tells the client:

> "The response is an SSE stream."

Instead of:

```http
Content-Type: application/json
```

which would normally indicate something like:

```json
{
  "answer": "..."
}
```

We're telling the browser to expect an ongoing stream of SSE events.

---

# 22. What Does `res.write()` Do?

Normally you might do:

```ts
res.json({
    answer: fullAnswer
})
```

That sends the complete response.

With streaming:

```ts
res.write(...)
```

means:

> "Send this piece of data now, but don't close the response yet."

For example:

```ts
res.write(`data: {"text":"RAG"}\n\n`)

res.write(`data: {"text":" stands"}\n\n`)

res.write(`data: {"text":" for"}\n\n`)
```

---

# 23. What Does `res.end()` Do?

```ts
res.end()
```

means:

> "I'm finished sending the response."

So:

```text
res.write()
res.write()
res.write()
res.write()
    ↓
res.end()
```

---

# 24. Your Streaming Order

Your project intentionally sends things in this order:

```text
1. meta
      ↓
2. text
      ↓
3. text
      ↓
4. text
      ↓
5. text
      ↓
6. done
```

### Meta

```json
{
  "sessionId": "abc",
  "sources": [...]
}
```

The frontend can immediately know things like the session ID and retrieved sources.

### Text

```json
{
  "text": "RAG"
}
```

Then:

```json
{
  "text": " stands"
}
```

etc.

### Done

```text
event: done
data: {}
```

This tells the frontend:

> "The answer is completely finished."

---

# 25. Why Accumulate `fullAnswer`?

Even though you're sending pieces immediately:

```ts
let fullAnswer = ''

for await (const piece of streamAnswer(prompt)) {

    fullAnswer += piece

    res.write(...)
}
```

you still keep the complete answer in memory.

Why?

Because after streaming finishes:

```ts
await insertMessage(
    sessionId,
    documentId,
    'assistant',
    fullAnswer
)
```

you can save the **complete assistant message** to the database.

So:

```text
LLM
 ↓
piece → user
piece → user
piece → user
piece → user
 ↓
fullAnswer
 ↓
database
```

---

# 26. Why Save After Streaming?

Because the user can already see the answer while it's being generated.

After the final piece:

```text
Streaming complete
       ↓
fullAnswer complete
       ↓
save to database
```

This keeps the UI responsive while still preserving chat history.

---

# 27. What If Database Saving Fails?

Suppose the user already received:

```text
"RAG stands for Retrieval-Augmented Generation..."
```

Then the database save fails.

The user already has their answer.

So making the UI say:

> "Streaming failed!"

would be misleading.

Instead:

```ts
try {
    await insertMessage(...)
} catch (err) {
    console.error(...)
}
```

Log the database failure.

The answer itself was successfully delivered.

---

# 28. Why Can't We Return a 500 After Streaming Starts?

Before sending the response, you can do:

```ts
return res.status(500).json({
    error: 'Something failed'
})
```

But once you start:

```ts
res.write(...)
```

the HTTP response has already started.

You can't suddenly replace it with:

```http
500 Internal Server Error
```

The client has already received the response headers/status.

So after streaming starts, errors need to be communicated **inside the stream**.

Example:

```text
event: error
data: {"error":"Streaming failed"}

```

---

# 29. Error Before Streaming vs During Streaming

### Before streaming starts

You can return:

```http
500
```

Example:

```ts
if (!prep.ok) {
    return res.status(500).json({
        error: prep.error
    })
}
```

### After streaming starts

Use an SSE event:

```ts
res.write(
    `event: error\ndata: ${JSON.stringify({
        error: 'Streaming failed'
    })}\n\n`
)

res.end()
```

Remember:

> **Before headers are sent → normal HTTP error.**

> **After streaming starts → send an error event through the stream.**

---

# 30. One Real Bug You Encountered

Gemini was ending lines with:

```text
\r\n
```

while your code expected:

```text
\n
```

So your parser was looking for the wrong line ending.

The fix was essentially normalizing:

```ts
text.replace(/\r\n/g, '\n')
```

Then your splitting logic worked.

### Lesson

When dealing with streaming protocols, tiny formatting differences matter.

A stream may look correct when printed but still fail because your parser expects a slightly different delimiter.

---

# 31. `EventSource` Automatically Reconnects

One useful feature of native `EventSource` is that if the connection unexpectedly breaks, the browser can automatically try to reconnect.

That's useful for things like:

```text
live notifications
live dashboards
long-running event streams
```

But for a chatbot, blindly reconnecting after the answer has finished could be undesirable.

So your frontend can close the connection when it receives:

```text
event: done
```

For example:

```js
eventSource.addEventListener('done', () => {
    eventSource.close()
})
```

This prevents the client from continuing/reconnecting when the stream is intentionally finished.

---

# 32. What If the User Closes the Tab?

If the browser closes the SSE connection halfway through:

```text
Browser
   X
   │
   │ connection gone
   ↓
Server
```

The server should ideally detect the disconnected client and stop unnecessary work.

Otherwise, depending on how the backend/LLM integration is implemented, the server may continue processing the LLM request even though nobody is listening anymore.

This is something worth handling in production using request/connection abort signals.

---

# 33. Nginx and Streaming

Sometimes your architecture looks like:

```text
Browser
   ↓
Nginx
   ↓
Node/Express
```

Nginx is a reverse proxy sitting in front of your application.

A problem can occur if Nginx buffers the response.

Instead of:

```text
Node → "RAG" → Browser
Node → " stands" → Browser
Node → " for" → Browser
```

it might collect the pieces and send them together later.

That destroys the whole point of progressive streaming.

That's why you may see:

```http
X-Accel-Buffering: no
```

and/or Nginx configuration such as:

```nginx
proxy_buffering off;
```

The idea is:

> **Don't buffer my SSE response. Forward the pieces immediately.**

---

# 34. The Three Main Server Ingredients

For a basic SSE endpoint, remember these three things:

### 1. Tell the client it's SSE

```ts
'Content-Type': 'text/event-stream'
```

### 2. Keep writing events

```ts
res.write(...)
```

### 3. Finish the stream

```ts
res.end()
```

That's the core.

---

# 35. Complete Mental Model of Your Project

Your entire `/chat-stream` flow:

```text
                    FRONTEND
                       │
                       │ EventSource
                       │
                       │ GET /chat-stream
                       │ ?documentId=123
                       │ &message=Explain+RAG
                       ↓
                 EXPRESS BACKEND
                       │
                       │ req.query
                       ↓
                  prepareChat()
                       │
                       │
                       ↓
                 Build prompt
                       │
                       ↓
                     LLM
                       │
             ┌─────────┼─────────┐
             ↓         ↓         ↓
           piece     piece     piece
             │         │         │
             ↓         ↓         ↓
          res.write  res.write  res.write
             │         │         │
             └─────────┼─────────┘
                       ↓
                  fullAnswer
                       │
                       ↓
                save to database
                       │
                       ↓
                  event: done
                       │
                       ↓
                   res.end()
                       │
                       ↓
                  connection closes
```

---

# 36. The Simplest Analogy

Imagine a teacher dictating an answer to you.

### Normal API

Teacher:

> "Don't write anything until I've finished the entire answer."

Then after 5 minutes:

> "Here is the complete answer."

### Streaming

Teacher:

> "I'll speak, and you write each sentence as I say it."

```text
Teacher → Sentence 1
Teacher → Sentence 2
Teacher → Sentence 3
Teacher → Sentence 4
```

The teacher doesn't become faster.

**You simply don't have to wait for the whole answer.**

---

# 37. Another Analogy: Phone Call

### Normal API

You call someone:

> "Tell me the answer."

They put you on hold.

After 2 minutes:

> "Here is the complete answer."

Call ends.

### Streaming

You call them:

> "Tell me the answer."

They stay on the phone:

> "First..."

> "Second..."

> "Third..."

> "That's everything."

Then the call ends.

The **phone call = HTTP connection**.

The individual sentences = **streamed chunks/events**.

---

# 38. Interview-Level Summary

If asked **"What is SSE?"**:

> SSE, or Server-Sent Events, is a mechanism where the server keeps an HTTP connection open and continuously sends events to the client. It's one-way communication from server to client and is useful for things like AI streaming responses and live updates.

If asked **"How do you implement SSE?"**:

> On the server, I set `Content-Type: text/event-stream`, keep the response open, send events using `res.write()`, and call `res.end()` when the stream is finished.

If asked **"Why GET instead of POST?"**:

> In our implementation, the frontend uses the browser's native `EventSource`, which uses GET. Streaming itself doesn't require GET; POST can also stream if we use `fetch()` and manually read the response stream.

If asked **"How does POST streaming work?"**:

> The client sends a POST with `fetch()`, then reads `response.body` using `getReader()`. The connection remains open while the server writes chunks, and eventually the reader receives `done: true`.

If asked **"SSE vs WebSocket?"**:

> SSE is primarily server-to-client over HTTP. WebSockets provide two-way communication. For a chatbot where the server mainly streams the generated answer to the browser, SSE can be sufficient.

If asked **"Does streaming make the AI faster?"**:

> No. It doesn't necessarily reduce generation time. It reduces perceived latency because the user starts seeing the answer before the complete response is generated.

---

# 39. Your Practical Lessons

### Things that actually bit you:

* SSE isn't just "send text repeatedly" — the formatting matters.
* `data:` and the blank line are important.
* `\r\n` vs `\n` can break a stream parser.
* Once streaming starts, you can't switch to a normal HTTP 500 response.
* Errors during streaming need to be communicated through the stream.
* Database failures after successful streaming shouldn't falsely tell the user the answer failed.
* Proxy buffering can make a working stream appear broken.
* `EventSource` reconnects automatically, so close it intentionally when your stream is done.
* A disconnected browser doesn't automatically mean the backend/LLM stops working; proper cancellation/abort handling is useful.

---

# 40. Final Mental Model

If you remember only this:

```text
                  USER ASKS QUESTION
                         │
                         ↓
                  EventSource()
                         │
                         ↓
              GET /chat-stream
                         │
                         ↓
                    Express
                         │
                         ↓
                   Prepare RAG
                         │
                         ↓
                       LLM
                         │
               ┌─────────┴─────────┐
               ↓                   ↓
           piece 1             piece 2
               ↓                   ↓
           res.write()          res.write()
               ↓                   ↓
               └─────────┬─────────┘
                         ↓
                    more pieces
                         ↓
                    fullAnswer
                         ↓
                    save history
                         ↓
                    event: done
                         ↓
                      res.end()
                         ↓
                  connection closes
```

**Streaming = progressive delivery.**

**SSE = a way to do server → client streaming over HTTP.**

**EventSource = browser API that conveniently consumes SSE.**

**`res.write()` = send another piece without closing.**

**`res.end()` = we're finished.**

**GET = used here because native EventSource uses GET, not because streaming requires GET.**

**POST + streaming = also possible, usually with `fetch()` + `response.body.getReader()`.**

**Polling = completely different; it makes repeated requests instead of keeping one connection open.**
