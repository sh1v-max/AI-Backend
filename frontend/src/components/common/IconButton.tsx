import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  mobileOnly?: boolean
}

export function IconButton({ children, mobileOnly, className = '', ...rest }: IconButtonProps) {
  const classes = ['icon-button', mobileOnly ? 'icon-button--mobile-only' : '', className]
    .filter(Boolean)
    .join(' ')

  return (
    <button type="button" className={classes} {...rest}>
      {children}
    </button>
  )
}
