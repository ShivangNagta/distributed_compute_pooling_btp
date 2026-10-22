import type { ReactNode } from 'react'

import type { BadgeTone } from '../lib/status'

export function StatusBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}
