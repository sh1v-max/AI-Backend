const API_KEY = process.env.GEMINI_API_KEY
const EMBED_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent'

export async function getEmbedding(text: string): Promise<number[]> {
  const res = await fetch(`${EMBED_URL}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: { parts: [{ text }] },
    }),
  })

  if (!res.ok) {
    throw new Error(`Gemini API error: ${res.status} ${await res.text()}`)
  }

  const data = await res.json()
  return data.embedding.values
}
