import { ChatCircleDots, TrashSimple } from '@phosphor-icons/react'
import type { SessionSummary } from '../../types/chat'

interface HistoryListProps {
  sessions: SessionSummary[]
  activeSessionId: string | null
  onSelectSession: (session: SessionSummary) => void
  onDeleteSession: (session: SessionSummary) => void
}

function groupLabel(isoDate: string): string {
  const date = new Date(isoDate)
  const now = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

  const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)

  if (dayDiff <= 0) return 'Today'
  if (dayDiff === 1) return 'Yesterday'
  if (dayDiff <= 7) return 'Previous 7 days'
  return 'Older'
}

export function HistoryList({
  sessions,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
}: HistoryListProps) {
  if (sessions.length === 0) {
    return (
      <div className="history-empty">
        <ChatCircleDots size={20} weight="regular" aria-hidden />
        <p>Your conversations will show up here.</p>
      </div>
    )
  }

  const groups: { label: string; items: SessionSummary[] }[] = []
  for (const session of sessions) {
    const label = groupLabel(session.lastMessageAt)
    const group = groups.find((g) => g.label === label)
    if (group) group.items.push(session)
    else groups.push({ label, items: [session] })
  }

  return (
    <nav className="history-list" aria-label="Chat history">
      {groups.map((group) => (
        <div key={group.label} className="history-group">
          <h3 className="history-group-label">{group.label}</h3>
          {group.items.map((session) => {
            const isActive = session.sessionId === activeSessionId
            return (
              <div
                key={session.sessionId}
                className={`history-item ${isActive ? 'history-item--active' : ''}`}
              >
                <button
                  type="button"
                  className="history-item-button"
                  onClick={() => onSelectSession(session)}
                  title={session.title}
                  aria-current={isActive}
                >
                  <span className="history-item-title">{session.title}</span>
                </button>
                <button
                  type="button"
                  className="history-item-delete"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteSession(session)
                  }}
                  aria-label={`Delete conversation "${session.title}"`}
                  title="Delete conversation"
                >
                  <TrashSimple size={14} weight="regular" />
                </button>
              </div>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
