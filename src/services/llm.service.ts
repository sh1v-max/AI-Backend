const API_KEY = process.env.GEMINI_API_KEY
const GENERATE_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent'

export async function generateAnswer(prompt: string): Promise<string> {
  const res = await fetch(`${GENERATE_URL}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  })
  
  if (!res.ok) {
    throw new Error(`Gemini API error: ${res.status} ${await res.text()}`)
  }
  
  const data = await res.json()
  return data.candidates[0].content.parts[0].text
}
