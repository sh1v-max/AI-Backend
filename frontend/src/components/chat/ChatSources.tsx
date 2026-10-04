import { useState, type ReactNode } from 'react'
import { CaretDown, Quotes } from '@phosphor-icons/react'
import type { ChatSource } from '../../types/chat'

interface ChatSourcesProps {
  sources: ChatSource[]
  // other small buttons for the same row (the Copy button), so the toggle and
  // the actions sit on one line and the opened list spans the full width below
  actions?: ReactNode
}

// Was a <details> element. It's now a button + state so the sources toggle
// can share a row with other actions while the opened list still gets the
// full width underneath (a <details> box can't split itself like that).
export function ChatSources({ sources, actions }: ChatSourcesProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="sources">
      <div className="sources-row">
        {sources.length > 0 && (
          <button
            type="button"
            className={`sources-summary ${open ? 'sources-summary--open' : ''}`}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            <Quotes size={13} weight="fill" aria-hidden />
            {sources.length} source{sources.length === 1 ? '' : 's'}
            <CaretDown size={12} weight="bold" className="sources-caret" aria-hidden />
          </button>
        )}
        {actions}
      </div>

      {open && (
        <div className="sources-list">
          {sources.map((s, i) => (
            <div key={i} className="source-card">
              <div className="source-meta">
                {s.filename && <span className="source-file">{s.filename}</span>}
                <span className="source-distance">distance {s.distance.toFixed(3)}</span>
              </div>
              <p className="source-content">{s.content.slice(0, 220)}…</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
