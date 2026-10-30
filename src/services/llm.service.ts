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

// Not streamed: AG.3 runs the agent on POST /chat first. AG.4 adds the
// streamed twin (streamTurn) for /chat-stream.
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
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.systemInstruction }] },
      contents: req.contents,
      ...(req.tools?.length && { tools: [{ functionDeclarations: req.tools }] }),
    }),
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
  const u = data.usageMetadata
  return {
    // role is always 'model' here; set explicitly so the type is exact
    turn: { role: 'model', parts: candidate.content.parts },
    usage: u
      ? { promptTokens: u.promptTokenCount ?? 0, outputTokens: u.candidatesTokenCount ?? 0, totalTokens: u.totalTokenCount ?? 0 }
      : null,
    finishReason: candidate.finishReason ?? null,
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

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    // here, done and value are destructured from the result of reader.read(), which reads a chunk of data from the response body. done is a boolean that indicates whether the stream has ended, and value is a Uint8Array containing the bytes read from the stream. If done is true, we break out of the loop, otherwise we decode the bytes into a string and append it to the buffer for processing.
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

      const json = JSON.parse(line.slice('data: '.length))
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text
      if (text) yield text
    }
  }
}
