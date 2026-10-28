import { useEffect, useState } from 'react'
import ClientPage from './pages/ClientPage'
import WorkerPage from './pages/WorkerPage'

function ModeCard({
  title,
  description,
  onSelect,
}: {
  title: string
  description: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="card card-interactive p-4"
    >
      <span className="block text-lg font-medium text-tx-primary">{title}</span>
      <span className="mt-1 block text-sm text-tx-muted">{description}</span>
    </button>
  )
}

function HomePage({ onSelectMode }: { onSelectMode: (mode: 'client' | 'worker') => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-base px-4 py-8 text-tx-primary">
      <div className="w-full max-w-xl">
        <h1 className="text-3xl font-semibold">Browser Compute Pool</h1>
        <p className="mt-2 text-sm text-tx-secondary">
          Pool browser CPU and GPU resources to run jobs remotely.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <ModeCard
            title="Client"
            description="Create a room and monitor connected workers."
            onSelect={() => onSelectMode('client')}
          />
          <ModeCard
            title="Worker"
            description="Join a room and contribute CPU, memory, and GPU."
            onSelect={() => onSelectMode('worker')}
          />
        </div>
      </div>
    </main>
  )
}

function App() {
  const [mode, setMode] = useState<'home' | 'client' | 'worker'>(() => {
    const path = window.location.pathname
    if (path === '/client') return 'client'
    if (path === '/worker') return 'worker'
    return 'home'
  })

  useEffect(() => {
    const onPopState = () => {
      const path = window.location.pathname
      if (path === '/client') {
        setMode('client')
        return
      }
      if (path === '/worker') {
        setMode('worker')
        return
      }
      setMode('home')
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const goHome = () => {
    window.history.pushState({}, '', '/')
    setMode('home')
  }

  const onSelectMode = (nextMode: 'client' | 'worker') => {
    window.history.pushState({}, '', nextMode === 'client' ? '/client' : '/worker')
    setMode(nextMode)
  }

  if (mode === 'client') {
    return <ClientPage onBack={goHome} />
  }

  if (mode === 'worker') {
    return <WorkerPage onBack={goHome} />
  }

  return <HomePage onSelectMode={onSelectMode} />
}

export default App
