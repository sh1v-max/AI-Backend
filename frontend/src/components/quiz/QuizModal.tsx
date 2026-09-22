import { useEffect, useState } from 'react'
import { ArrowClockwise, Spinner, WarningCircle, X } from '@phosphor-icons/react'
import type { Quiz } from '../../types/quiz'

interface QuizModalProps {
  open: boolean
  loading: boolean
  error: string | null
  quiz: Quiz | null
  filename: string | null
  onClose: () => void
  onRegenerate: () => void
}

// Step 4.2F — renders each question with its 4 options as selectable radio
// buttons. No right/wrong feedback yet — that's the optional Step 4.3
// (POST /quiz/check); this step is just "can I see and answer the quiz".
export function QuizModal({ open, loading, error, quiz, filename, onClose, onRegenerate }: QuizModalProps) {
  // Which option the user picked per question index — kept local to this
  // modal, not sent anywhere yet, since there's no grading endpoint to send
  // it to (Step 4.3).
  const [selected, setSelected] = useState<Record<number, number>>({})

  // A fresh generation replaces `quiz` with a new array — clear old picks
  // when that happens, so answers from the previous quiz don't linger.
  useEffect(() => {
    setSelected({})
  }, [quiz])

  if (!open) return null

  return (
    <div className="quiz-overlay" onClick={onClose} role="presentation">
      <div className="quiz-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Quiz" aria-modal>
        <header className="quiz-modal-header">
          <div className="quiz-modal-heading">
            <h2>Quiz</h2>
            {filename && <span className="quiz-modal-subtitle">{filename}</span>}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close quiz">
            <X size={18} weight="regular" />
          </button>
        </header>

        <div className="quiz-modal-body">
          {loading && (
            <div className="quiz-state">
              <Spinner size={24} weight="bold" className="spin" aria-hidden />
              <p>Generating a quiz from this document…</p>
              <p className="quiz-state-hint">This calls Gemini — usually takes 10–30 seconds.</p>
            </div>
          )}

          {!loading && error && (
            <div className="quiz-state">
              <WarningCircle size={24} weight="fill" className="quiz-state-error-icon" aria-hidden />
              <p>{error}</p>
              <button type="button" className="quiz-retry-button" onClick={onRegenerate}>
                <ArrowClockwise size={14} weight="bold" aria-hidden />
                Try again
              </button>
            </div>
          )}

          {!loading && !error && quiz && (
            <ol className="quiz-question-list">
              {quiz.map((q, qi) => (
                <li key={qi} className="quiz-question">
                  <p className="quiz-question-text">
                    {qi + 1}. {q.question}
                  </p>
                  <div className="quiz-options" role="radiogroup" aria-label={`Question ${qi + 1} options`}>
                    {q.options.map((option, oi) => (
                      <label key={oi} className="quiz-option">
                        <input
                          type="radio"
                          name={`quiz-question-${qi}`}
                          checked={selected[qi] === oi}
                          onChange={() => setSelected((prev) => ({ ...prev, [qi]: oi }))}
                        />
                        <span>{option}</span>
                      </label>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        {!loading && !error && quiz && (
          <footer className="quiz-modal-footer">
            <span className="quiz-modal-progress">
              {Object.keys(selected).length} of {quiz.length} answered
            </span>
            <button type="button" className="quiz-retry-button" onClick={onRegenerate}>
              <ArrowClockwise size={14} weight="bold" aria-hidden />
              Regenerate
            </button>
          </footer>
        )}
      </div>
    </div>
  )
}
