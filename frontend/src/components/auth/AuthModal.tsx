import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Spinner, WarningCircle, X } from '@phosphor-icons/react'
import { BrandMark } from '../common/BrandMark'

export type AuthMode = 'login' | 'register'

interface AuthModalProps {
  mode: AuthMode
  onModeChange: (mode: AuthMode) => void
  onClose: () => void
  onLogin: (email: string, password: string) => Promise<void>
  onRegister: (email: string, password: string) => Promise<void>
  // the current user is a guest who has uploaded something
  guestDocumentCount: number
}

// Same rule as the backend's auth.schema.ts — checked here too only so the
// form can say so before a round trip. The server still decides.
const PASSWORD_MIN_LENGTH = 8

// Auth.6 — one modal, two modes: sign in, or create an account.
export function AuthModal({ mode, onModeChange, onClose, onLogin, onRegister, guestDocumentCount }: AuthModalProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)

  // focus the first field when the modal opens; Escape closes it
  useEffect(() => {
    emailRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function switchMode(next: AuthMode) {
    setError(null)
    onModeChange(next)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (mode === 'register' && password.length < PASSWORD_MIN_LENGTH) {
      setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      if (mode === 'login') await onLogin(email, password)
      else await onRegister(email, password)
      onClose()
    } catch (err) {
      // the server's own message: "Invalid email or password", "An account
      // with this email already exists", "Too many attempts…"
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setSubmitting(false)
    }
  }

  const isLogin = mode === 'login'

  return (
    <div className="auth-overlay" onClick={onClose} role="presentation">
      <div
        className="auth-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
        aria-labelledby="auth-title"
      >
        <button type="button" className="icon-button auth-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>

        <BrandMark size={36} />
        <h2 id="auth-title">{isLogin ? 'Welcome back' : 'Create your account'}</h2>
        <p className="auth-subtitle">
          {isLogin
            ? 'Sign in to see your documents and chats on any device.'
            : 'Keep your documents and chats, and use them from any device.'}
        </p>

        {/* Signing up upgrades the guest in place, so their files come along.
            Logging in to a DIFFERENT account can't merge them — say so before
            they're left behind, and point at the option that keeps them. */}
        {guestDocumentCount > 0 && (
          <div className={`auth-note ${isLogin ? 'auth-note--warn' : ''}`}>
            {isLogin ? (
              <>
                Your {guestDocumentCount} guest document{guestDocumentCount === 1 ? '' : 's'} won't move to the
                account you sign in to. To keep {guestDocumentCount === 1 ? 'it' : 'them'},{' '}
                <button type="button" className="auth-link" onClick={() => switchMode('register')}>
                  create an account
                </button>{' '}
                instead.
              </>
            ) : (
              <>
                Your {guestDocumentCount} document{guestDocumentCount === 1 ? '' : 's'} and chats will be saved to
                your new account.
              </>
            )}
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field">
            <span>Email</span>
            <input
              ref={emailRef}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              // tells password managers whether to fill a saved password or offer to make one
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {!isLogin && <small>At least {PASSWORD_MIN_LENGTH} characters</small>}
          </label>

          {error && (
            <div className="auth-error" role="alert">
              <WarningCircle size={16} weight="fill" aria-hidden />
              {error}
            </div>
          )}

          <button type="submit" className="auth-submit" disabled={submitting}>
            {submitting && <Spinner size={16} weight="bold" className="spin" aria-hidden />}
            {isLogin ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="auth-switch">
          {isLogin ? "Don't have an account? " : 'Already have an account? '}
          <button type="button" className="auth-link" onClick={() => switchMode(isLogin ? 'register' : 'login')}>
            {isLogin ? 'Create one' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  )
}
