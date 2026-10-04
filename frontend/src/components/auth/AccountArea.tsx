import { SignIn, SignOut, UserCircle } from '@phosphor-icons/react'
import type { User } from '../../types/auth'
import type { AuthMode } from './AuthModal'

interface AccountAreaProps {
  user: User
  collapsed: boolean
  onOpenAuth: (mode: AuthMode) => void
  onLogout: () => void
}

// Auth.6 — the bottom of the sidebar: who you are, and the way to change it.
//
// A guest gets no "Log out": logging out throws the guest's token away, and
// with no email or password there'd be no way back to their files. So a guest
// is offered sign up (keeps everything) or sign in instead.
export function AccountArea({ user, collapsed, onOpenAuth, onLogout }: AccountAreaProps) {
  if (collapsed) {
    return (
      <div className="account-area account-area--collapsed">
        {user.isGuest ? (
          <button type="button" className="icon-button" onClick={() => onOpenAuth('register')} title="Sign up" aria-label="Sign up">
            <SignIn size={18} />
          </button>
        ) : (
          <button type="button" className="icon-button" onClick={onLogout} title={`Log out (${user.email})`} aria-label="Log out">
            <SignOut size={18} />
          </button>
        )}
      </div>
    )
  }

  if (user.isGuest) {
    return (
      <div className="account-area">
        <div className="account-guest">
          <UserCircle size={20} aria-hidden />
          <div>
            <strong>Guest</strong>
            <span>Your files are saved in this browser only</span>
          </div>
        </div>
        <button type="button" className="account-signup" onClick={() => onOpenAuth('register')}>
          Sign up to keep them
        </button>
        <button type="button" className="account-signin" onClick={() => onOpenAuth('login')}>
          I already have an account
        </button>
      </div>
    )
  }

  return (
    <div className="account-area">
      <div className="account-user">
        <span className="account-avatar" aria-hidden>
          {(user.email ?? '?').charAt(0).toUpperCase()}
        </span>
        <span className="account-email" title={user.email ?? ''}>
          {user.email}
        </span>
        <button type="button" className="icon-button" onClick={onLogout} title="Log out" aria-label="Log out">
          <SignOut size={18} />
        </button>
      </div>
    </div>
  )
}
