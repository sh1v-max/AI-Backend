// Split text into ~500-word chunks. Deliberately simple — chunking strategy
// tradeoffs (semantic boundaries, overlap) are a later, deeper topic.
export function chunkText(text: string, wordsPerChunk = 500): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const chunks: string[] = []

  for (let i = 0; i < words.length; i += wordsPerChunk) {
    chunks.push(words.slice(i, i + wordsPerChunk).join(' '))
  }

  return chunks
}
