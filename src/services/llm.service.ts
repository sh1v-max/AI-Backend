const API_KEY = process.env.GEMINI_API_KEY
const GENERATE_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent'
const STREAM_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:streamGenerateContent'

// `generationConfig` is optional (Step 4.1): plain chat leaves it out, while
// structured output passes { responseMimeType: 'application/json',
// responseSchema } to make Gemini return JSON in a given shape.
export async function generateAnswer(
  prompt: string,
  generationConfig?: Record<string, unknown>,
): Promise<string> {
  const res = await fetch(`${GENERATE_URL}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      ...(generationConfig && { generationConfig }),
    }),
  })

  if (!res.ok) {
    throw new Error(`Gemini API error: ${res.status} ${await res.text()}`)
  }

  const data = await res.json()
  return data.candidates[0].content.parts[0].text
}

// ── AG.3 — multi-turn calls with tools (the agent's building block) ─────────
//
// generateAnswer() sends ONE string and gets back text. An agent needs more:
//   - a CONVERSATION (`contents`): a list of turns with roles. Roles are only
//     'user' and 'model'; a tool result is sent back in a 'user' turn.
//   - a SYSTEM INSTRUCTION: the rules, in their own field instead of glued to
//     the top of a big prompt string (the model weighs it as "how to behave",
//     not as part of the conversation).
//   - TOOLS: function declarations the model may ask us to call.
//   - the model's WHOLE turn back, exactly as sent. It can contain text,
//     functionCall parts and thoughtSignatures; AG.0 measured that dropping a
//     signature when the turn is sent back gets a 400. So the caller pushes
//     `turn` into `contents` untouched.
//
// The shapes below are the parts of Gemini's REST types this code uses
// (generateContent reference, agents-plan §13).
export type Part = {
  text?: string
  // a "thought summary" part, not part of the answer (never shown to users)
  thought?: boolean
  // opaque, must be sent back unchanged with the part it came on
  thoughtSignature?: string
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> }
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> }
}
export type Content = { role: 'user' | 'model'; parts: Part[] }
export type FunctionDeclaration = {
  name: string
  description: string
  parameters?: Record<string, unknown>
}
export type TurnUsage = { promptTokens: number; outputTokens: number; totalTokens: number }

// The request body every agent call sends, streamed or not
function turnRequestBody(req: { systemInstruction: string; contents: Content[]; tools?: FunctionDeclaration[] }) {
  return JSON.stringify({
    systemInstruction: { parts: [{ text: req.systemInstruction }] },
    contents: req.contents,
    ...(req.tools?.length && { tools: [{ functionDeclarations: req.tools }] }),
  })
}

function toUsage(u: any): TurnUsage | null {
  return u
    ? { promptTokens: u.promptTokenCount ?? 0, outputTokens: u.candidatesTokenCount ?? 0, totalTokens: u.totalTokenCount ?? 0 }
    : null
}

// Not streamed. AG.3 ran the agent on this; since AG.4 the agent uses
// streamTurn() below for BOTH routes, so nothing in the app calls this any
// more. Kept because it's the simplest version of "one agent step" (one
// request, one JSON reply) — the easiest thing to read first, and handy for
// a script.
export async function generateTurn(req: {
  systemInstruction: string
  contents: Content[]
  // omitted = the model can't call anything and must answer with text. That's
  // how the loop's LAST step is sent: AG.0 found `mode: 'NONE'` is ignored on
  // this model, so leaving the tools out is the only reliable "answer now".
  tools?: FunctionDeclaration[]
}): Promise<{ turn: Content; usage: TurnUsage | null; finishReason: string | null }> {
  const res = await fetch(`${GENERATE_URL}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: turnRequestBody(req),
  })

  if (!res.ok) {
    throw new Error(`Gemini API error: ${res.status} ${await res.text()}`)
  }

  const data = await res.json()
  const candidate = data.candidates?.[0]
  // No content = the model produced nothing usable (blocked, or a malformed
  // function call). Throw, so withErrorHandling answers like any Gemini failure.
  if (!candidate?.content?.parts?.length) {
    throw new Error(`Gemini returned no content (finishReason: ${candidate?.finishReason ?? 'none'})`)
  }
  return {
    // role is always 'model' here; set explicitly so the type is exact
    turn: { role: 'model', parts: candidate.content.parts },
    usage: toUsage(data.usageMetadata),
    finishReason: candidate.finishReason ?? null,
  }
}

// ── AG.4 — the same step, streamed ─────────────────────────────────────────
//
// generateTurn() waits for the whole turn. On /chat-stream that would mean
// the final answer arrives in one lump, so every agent call is a streaming
// call instead (decision D2, confirmed by AG.0):
//
//   - while Gemini streams, every piece of answer TEXT is yielded at once
//     ({ type: 'text' }), so the route can forward it to the browser
//   - everything else (a functionCall, a thoughtSignature) is only collected
//   - when the stream ends, the generator RETURNS the model's whole turn,
//     rebuilt from the pieces, for the loop to push back into `contents`
//
// "yields text, returns the turn" is a generator with a return value:
// AsyncGenerator<TurnEvent, TurnResult>. A `for await` loop only sees the
// yields; `yield*` in the agent loop forwards the yields AND hands back the
// return value (see agent.service.ts).
export type TurnEvent = { type: 'text'; text: string }
export type TurnResult = { turn: Content; usage: TurnUsage | null; finishReason: string | null }

// a part that is ONLY text: no call, no signature, not a thought
const isPlainText = (p: Part) =>
  typeof p.text === 'string' && !p.thought && !p.thoughtSignature && !p.functionCall && !p.functionResponse

// Rebuilding the turn from stream pieces. Each SSE event carries a few parts;
// sent back as 40 one-word text parts the turn would still work, but AG.0
// worked out the rule that keeps it identical to the non-streamed turn:
//   - plain text pieces next to each other are JOINED into one text part
//   - a part with a functionCall or a thoughtSignature is kept EXACTLY as
//     sent, never merged with anything (merging would separate a signature
//     from the part it belongs to → a 400 on the next request)
//   - an empty plain-text piece carries nothing and is dropped (one with a
//     signature is not plain, so the answer's trailing signature is kept)
function addPart(parts: Part[], part: Part) {
  if (isPlainText(part)) {
    if (!part.text) return
    const last = parts[parts.length - 1]
    if (last && isPlainText(last)) last.text += part.text
    else parts.push({ text: part.text })
    return
  }
  parts.push(part)
}

export async function* streamTurn(req: {
  systemInstruction: string
  contents: Content[]
  // omitted = the model can only answer (same as generateTurn)
  tools?: FunctionDeclaration[]
}): AsyncGenerator<TurnEvent, TurnResult> {
  const res = await fetch(`${STREAM_URL}?alt=sse&key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: turnRequestBody(req),
  })

  if (!res.ok || !res.body) {
    throw new Error(`Gemini API error: ${res.status} ${await res.text()}`)
  }

  const parts: Part[] = []
  let usage: TurnUsage | null = null
  let finishReason: string | null = null

  for await (const data of readSseJson(res.body)) {
    const candidate = data.candidates?.[0]
    for (const part of (candidate?.content?.parts ?? []) as Part[]) {
      // answer text goes out the moment it arrives; thought parts never do
      if (part.text && !part.thought) yield { type: 'text', text: part.text }
      addPart(parts, part)
    }
    // both only come on the last event(s); keep the latest
    if (candidate?.finishReason) finishReason = candidate.finishReason
    if (data.usageMetadata) usage = toUsage(data.usageMetadata)
  }

  // same as generateTurn: nothing usable → throw
  if (parts.length === 0) {
    throw new Error(`Gemini returned no content (finishReason: ${finishReason ?? 'none'})`)
  }
  return { turn: { role: 'model', parts }, usage, finishReason }
}

// The SSE reading both streaming functions share: bytes → text → complete
// `data: {...}` events → parsed JSON objects, one at a time. (This loop used
// to live inside streamAnswer; AG.4 needed it a second time.)
async function* readSseJson(body: ReadableStream<Uint8Array>): AsyncGenerator<any> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    // done = the stream has ended; value = the next chunk of raw bytes
    // (a Uint8Array). Chunks don't line up with events: one chunk can hold
    // half an event, or three.
    const { done, value } = await reader.read()
    if (done) break

    // Gemini sends raw bytes, not JSON, so we need to decode them.
    // Gemini terminates SSE lines with \r\n — normalize to \n so the
    // blank-line split below matches (done on the whole buffer so a \r\n
    // split across two chunks is still caught).
    buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n')

    // SSE events are separated by a blank line — process every complete
    // one currently in the buffer, keep any trailing partial event for
    // the next chunk (a chunk of raw bytes doesn't always end on an event
    // boundary).
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''

    for (const event of events) {
      const line = event.trim()
      if (!line.startsWith('data: ')) continue
      yield JSON.parse(line.slice('data: '.length))
    }
  }
}

// The answer text of a model turn: its text parts, minus "thought" parts.
export function textOfTurn(turn: Content): string {
  return turn.parts
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join('')
}

// Step 3.2 — this function is similar to generateAnswer(), but it streams the response back piece by piece instead of waiting for the whole answer to be generated. This is useful for long answers, as it allows us to display the answer as it's being generated, rather than waiting for the entire answer to be ready before showing anything
// same call, but Gemini streams the answer back piece by piece
// instead of one complete response. `?alt=sse` makes it return real SSE
// ("data: {...}\n\n"), so we decode raw bytes, split on SSE event boundaries,
// parse each JSON payload, and yield just the new text out of it.
export async function* streamAnswer(prompt: string): AsyncGenerator<string> {
  const res = await fetch(`${STREAM_URL}?alt=sse&key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  })

  if (!res.ok || !res.body) {
    throw new Error(`Gemini API error: ${res.status} ${await res.text()}`)
  }

  // the byte → event → JSON reading is shared with streamTurn (readSseJson
  // above); here we only pull the new text out of each event
  for await (const json of readSseJson(res.body)) {
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text
    if (text) yield text
  }
}
