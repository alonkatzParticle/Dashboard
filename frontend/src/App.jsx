import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import TasksPage from './pages/TasksPage'
import StandupPage from './pages/StandupPage'
import WeeklyPage from './pages/WeeklyPage'
import StatusReportPage from './pages/StatusReportPage'
import StudioPage from './pages/StudioPage'

export default function App() {
  const [status, setStatus] = useState(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [followUps, setFollowUps] = useState([])

  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(setStatus).catch(() => {})
    fetch('/api/follow-ups').then(r => r.json()).then(d => {
      setFollowUps(d.followUps ?? [])
    }).catch(() => {})
  }, [])

  const handleSync = async () => {
    setIsSyncing(true)
    try {
      await fetch('/api/sync', { method: 'POST' })
      // Poll until done — check immediately first, then every 2s, max 10 min
      const maxWait = Date.now() + 10 * 60 * 1000
      while (Date.now() < maxWait) {
        // Fetch with a 5s timeout so a hung backend doesn't freeze the loop
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), 5000)
        const s = await fetch('/api/sync/status', { signal: ctrl.signal })
          .then(r => r.json())
          .catch(() => ({ running: false }))
        clearTimeout(t)
        if (!s.running) break
        await new Promise(r => setTimeout(r, 2000))
      }
      const [s, fu] = await Promise.all([
        fetch('/api/status').then(r => r.json()),
        fetch('/api/follow-ups').then(r => r.json()),
      ])
      setStatus(s)
      setFollowUps(fu.followUps ?? [])
    } catch (e) {
      console.error('Sync error:', e)
    } finally {
      setIsSyncing(false)
    }
  }

  const handleReset = async () => {
    if (!confirm('Reset all data? This cannot be undone.')) return
    setIsResetting(true)
    try { await fetch('/api/reset', { method: 'POST' }) } catch {}
    setIsResetting(false)
    window.location.reload()
  }

  return (
    <BrowserRouter>
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        <Sidebar status={status}
          onSync={handleSync} isSyncing={isSyncing}
          onReset={handleReset} isResetting={isResetting}
          followUps={followUps} />
        <main className="flex-1 overflow-auto p-6">
          <Routes>
            <Route path="/" element={<Navigate to="/tasks" replace />} />
            <Route path="/tasks"   element={<TasksPage />} />
            <Route path="/standup" element={<StandupPage />} />
            <Route path="/weekly"  element={<WeeklyPage />} />
            <Route path="/status"  element={<StatusReportPage />} />
            <Route path="/studio"  element={<StudioPage />} />
            <Route path="*"        element={<Navigate to="/tasks" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
