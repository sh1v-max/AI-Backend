import { Sparkle } from '@phosphor-icons/react'

interface BrandMarkProps {
  size?: number
}

// The small green square used as DocMind's logo in the sidebar and as the
// assistant's avatar next to each answer, so the two read as the same thing.
export function BrandMark({ size = 28 }: BrandMarkProps) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden>
      <Sparkle size={Math.round(size * 0.55)} weight="fill" />
    </span>
  )
}
