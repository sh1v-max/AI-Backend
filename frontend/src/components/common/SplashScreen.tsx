import { ArrowClockwise, Spinner, WarningCircle } from '@phosphor-icons/react'

interface SplashScreenProps {
  error?: string
  onRetry?: () => void
}

// Auth.4 — shown while useAuth works out who the user is, before the real app
// mounts. On the live site the API runs on Render's free tier, which sleeps
// when idle, so this can sit here for 30+ seconds on a cold start. The hint
// says so, otherwise it just looks broken.
export function SplashScreen({ error, onRetry }: SplashScreenProps) {
  return (
    <div className="splash">
      <span className="splash-brand">DocMind</span>

      {error ? (
        <>
          <WarningCircle size={24} weight="fill" className="splash-error-icon" aria-hidden />
          <p>Could not connect to the server.</p>
          <p className="splash-hint">{error}</p>
          <button type="button" className="quiz-retry-button" onClick={onRetry}>
            <ArrowClockwise size={14} weight="bold" aria-hidden />
            Try again
          </button>
        </>
      ) : (
        <>
          <Spinner size={24} weight="bold" className="spin" aria-hidden />
          <p>Waking up the server…</p>
          <p className="splash-hint">The free server sleeps when idle, so the first load can take up to a minute.</p>
        </>
      )}
    </div>
  )
}
