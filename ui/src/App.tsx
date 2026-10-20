import { useEffect, useState } from 'react'
import ClientPage from './pages/ClientPage'
import WorkerPage from './pages/WorkerPage'

function HomePage({ onSelectMode }: { onSelectMode: (mode: 'client' | 'worker') => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-8 text-slate-800">
      <section className="w-full max-w-4xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-medium uppercase tracking-[0.22em] text-slate-500">Distributed compute pooling</p>
        <h1 className="mt-3 text-4xl font-semibold text-slate-900">Choose your operating mode</h1>
        <p className="mt-3 max-w-2xl text-base text-slate-600">
          Clients create rooms and monitor connected workers. Workers join by room ID and room token, then share their available resources.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <button
            type="button"
            onClick={() => onSelectMode('client')}
          className="group rounded-2xl border border-slate-200 bg-slate-900 p-6 text-left text-white transition hover:-translate-y-0.5 hover:border-slate-700 hover:bg-slate-800"
          >
            <div className="text-sm font-medium uppercase tracking-[0.2em] text-slate-300">Client mode</div>
            <div className="mt-4 text-2xl font-semibold">Create rooms</div>
            <div className="mt-2 text-sm text-slate-300">
              Generate a room, share a token, and monitor the workers connected to that room.
            </div>
          </button>

          <button
            type="button"
            onClick={() => onSelectMode('worker')}
            className="group rounded-2xl border border-slate-200 bg-white p-6 text-left text-slate-900 transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50"
          >
            <div className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Worker mode</div>
            <div className="mt-4 text-2xl font-semibold">Join a room</div>
            <div className="mt-2 text-sm text-slate-600">
              Connect using the room reference, then share CPU, memory, and GPU information with the client.
            </div>
          </button>
        </div>
      </section>
    </main>
  )
}

function App() {
  const [mode, setMode] = useState<'home' | 'client' | 'worker'>(() => {
    const path = window.location.pathname
    if (path === '/client') {
      return 'client'
    }
    if (path === '/worker') {
      return 'worker'
    }
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

  const onSelectMode = (nextMode: 'client' | 'worker') => {
    const path = nextMode === 'client' ? '/client' : '/worker'
    window.history.pushState({}, '', path)
    setMode(nextMode)
  }

  if (mode === 'client') {
    return (
      <ClientPage
        onBack={() => {
          window.history.pushState({}, '', '/')
          setMode('home')
        }}
      />
    )
  }

  if (mode === 'worker') {
    return (
      <WorkerPage
        onBack={() => {
          window.history.pushState({}, '', '/')
          setMode('home')
        }}
      />
    )
  }

  return <HomePage onSelectMode={onSelectMode} />
}

export default App
