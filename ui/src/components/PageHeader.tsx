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
    <header className="flex flex-col gap-3 border-b border-neutral-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">{title}</h1>
        <p className="text-sm text-neutral-500">{description}</p>
      </div>
      {children ? <div className="flex items-center gap-2">{children}</div> : null}
    </header>
  )
}
