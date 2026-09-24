import { useEffect, useState } from 'react'
import { ArrowClockwise, CheckCircle, Spinner, WarningCircle, X, XCircle } from '@phosphor-icons/react'
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
// buttons.
// Step 4.3/4.3F — grading. `correctIndex` is already sitting right here in
// `quiz`, sent down with the original response, so checking an answer is
// just comparing two numbers — no `POST /quiz/check` needed. A real "is this
// answer right" endpoint would only be meaningful once quizzes are stored
// server-side (a later phase); grading a quiz the browser already holds
// entirely, against data the browser already has, teaches nothing extra by
// round-tripping it.
export function QuizModal({ open, loading, error, quiz, filename, onClose, onRegenerate }: QuizModalProps) {
  // Which option the user picked per question index — kept local to this
  // modal, never sent anywhere.
  const [selected, setSelected] = useState<Record<number, number>>({})
  // Once true, options are locked and each one shows right/wrong instead of
  // just being selectable — a quiz doesn't grade itself until you ask it to.
  const [checked, setChecked] = useState(false)

  // A fresh generation replaces `quiz` with a new array — clear old picks
  // and any previous grading when that happens, so nothing from the last
  // quiz lingers on the new one.
  useEffect(() => {
    setSelected({})
    setChecked(false)
  }, [quiz])

  if (!open) return null

  const score = quiz ? quiz.filter((q, qi) => selected[qi] === q.correctIndex).length : 0

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
                    {q.options.map((option, oi) => {
                      // Once checked: the correct option is always marked
                      // right (even if nobody picked it), and a wrong pick
                      // is marked wrong — so the answer is visible either way.
                      const isCorrectOption = checked && oi === q.correctIndex
                      const isWrongPick = checked && selected[qi] === oi && oi !== q.correctIndex
                      return (
                        <label
                          key={oi}
                          className={`quiz-option${isCorrectOption ? ' quiz-option--correct' : ''}${isWrongPick ? ' quiz-option--incorrect' : ''}`}
                        >
                          <input
                            type="radio"
                            name={`quiz-question-${qi}`}
                            checked={selected[qi] === oi}
                            disabled={checked}
                            onChange={() => setSelected((prev) => ({ ...prev, [qi]: oi }))}
                          />
                          <span>{option}</span>
                          {isCorrectOption && <CheckCircle size={16} weight="fill" className="quiz-option-icon" aria-hidden />}
                          {isWrongPick && <XCircle size={16} weight="fill" className="quiz-option-icon" aria-hidden />}
                        </label>
                      )
                    })}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        {!loading && !error && quiz && (
          <footer className="quiz-modal-footer">
            {checked ? (
              <span className="quiz-modal-score">
                {score} of {quiz.length} correct
              </span>
            ) : (
              <span className="quiz-modal-progress">
                {Object.keys(selected).length} of {quiz.length} answered
              </span>
            )}

            <div className="quiz-modal-footer-actions">
              {!checked && (
                <button type="button" className="quiz-check-button" onClick={() => setChecked(true)}>
                  Check answers
                </button>
              )}
              <button type="button" className="quiz-retry-button" onClick={onRegenerate}>
                <ArrowClockwise size={14} weight="bold" aria-hidden />
                Regenerate
              </button>
            </div>
          </footer>
        )}
      </div>
    </div>
  )
}
