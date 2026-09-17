import { CaretDown, Quotes } from '@phosphor-icons/react'
import type { ChatSource } from '../../types/chat'

interface ChatSourcesProps {
  sources: ChatSource[]
}

export function ChatSources({ sources }: ChatSourcesProps) {
  if (sources.length === 0) return null

  return (
    <details className="sources">
      <summary className="sources-summary">
        <Quotes size={13} weight="fill" aria-hidden />
        {sources.length} source{sources.length === 1 ? '' : 's'}
        <CaretDown size={12} weight="bold" className="sources-caret" aria-hidden />
      </summary>
      <div className="sources-list">
        {sources.map((s, i) => (
          <div key={i} className="source-card">
            <span className="source-distance">distance {s.distance.toFixed(3)}</span>
            <p className="source-content">{s.content.slice(0, 220)}…</p>
          </div>
        ))}
      </div>
    </details>
  )
}
