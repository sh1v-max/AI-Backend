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
