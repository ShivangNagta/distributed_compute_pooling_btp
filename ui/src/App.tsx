import { useEffect, useState } from 'react'
import ClientPage from './pages/ClientPage'
import DevPage from './pages/DevPage'
import VariancePage from './pages/VariancePage'
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

function HomePage({
  onSelectMode,
  onOpenDev,
}: {
  onSelectMode: (mode: 'client' | 'worker') => void
  onOpenDev: () => void
}) {
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-base px-4 py-8 text-tx-primary">
      <button
        type="button"
        onClick={onOpenDev}
        className="btn btn-secondary absolute right-4 top-4"
      >
        Developer benchmarks
      </button>
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
  const [mode, setMode] = useState<
    'home' | 'client' | 'worker' | 'dev' | 'dev-variance'
  >(() => {
    const path = window.location.pathname
    if (path === '/client') return 'client'
    if (path === '/worker') return 'worker'
    if (path === '/dev') return 'dev'
    if (path === '/dev/variance') return 'dev-variance'
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
      if (path === '/dev') {
        setMode('dev')
        return
      }
      if (path === '/dev/variance') {
        setMode('dev-variance')
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
    window.history.pushState(
      {},
      '',
      nextMode === 'client' ? '/client' : '/worker',
    )
    setMode(nextMode)
  }

  const openDev = () => {
    window.history.pushState({}, '', '/dev')
    setMode('dev')
  }

  const openDevVariance = () => {
    window.history.pushState({}, '', '/dev/variance')
    setMode('dev-variance')
  }

  if (mode === 'client') {
    return <ClientPage onBack={goHome} />
  }

  if (mode === 'worker') {
    return <WorkerPage onBack={goHome} />
  }

  if (mode === 'dev') {
    return <DevPage onBack={goHome} onOpenVariance={openDevVariance} />
  }

  if (mode === 'dev-variance') {
    return <VariancePage onBack={openDev} />
  }

  return <HomePage onSelectMode={onSelectMode} onOpenDev={openDev} />
}

export default App
