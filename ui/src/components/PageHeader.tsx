import type { ReactNode } from 'react'

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-tx-primary">{title}</h1>
        <p className="mt-1 text-sm text-tx-muted">{description}</p>
      </div>
      {children ? <div className="flex items-center gap-2">{children}</div> : null}
    </header>
  )
}
