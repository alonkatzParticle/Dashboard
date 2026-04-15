import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AdminProvider } from './lib/useAdmin'
import { Sidebar }       from './components/Sidebar'
import { AdminGuard, UnlockButton } from './components/AdminGuard'
import TasksPage        from './pages/TasksPage'
import StandupPage      from './pages/StandupPage'
import WeeklyPage       from './pages/WeeklyPage'
import StatusReportPage from './pages/StatusReportPage'
import StudioPage       from './pages/StudioPage'
import SettingsPage     from './pages/SettingsPage'

export default function App() {
  // Frame.io OAuth: Adobe redirects back here with ?code=... regardless of path.
  // Forward it to /weekly so WeeklyPage handles the exchange.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    if (code && !window.location.pathname.includes('/weekly')) {
      window.location.replace('/weekly?' + params.toString())
    }
  }, [])

  const [status, setStatus]       = useState(null)
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
      const maxWait = Date.now() + 10 * 60 * 1000
      while (Date.now() < maxWait) {
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
    <AdminProvider>
      <BrowserRouter>
        <div className="flex h-screen overflow-hidden bg-background text-foreground">
          <Sidebar status={status}
            onSync={handleSync} isSyncing={isSyncing}
            onReset={handleReset} isResetting={isResetting}
            followUps={followUps} />
          <main className="flex-1 overflow-auto p-6">
            <Routes>
              {/* Default redirect — restricted users land on /weekly */}
              <Route path="/"        element={<Navigate to="/weekly" replace />} />
              <Route path="/weekly"  element={<WeeklyPage />} />

              {/* Admin-only routes — redirect to /weekly if restricted & not unlocked */}
              <Route path="/tasks"    element={<AdminGuard><TasksPage /></AdminGuard>} />
              <Route path="/standup"  element={<AdminGuard><StandupPage /></AdminGuard>} />
              <Route path="/status"   element={<AdminGuard><StatusReportPage /></AdminGuard>} />
              <Route path="/studio"   element={<AdminGuard><StudioPage /></AdminGuard>} />
              <Route path="/settings" element={<AdminGuard><SettingsPage /></AdminGuard>} />

              {/* Catch-all also goes to weekly (not tasks) so restricted users never redirect to a protected page */}
              <Route path="*"         element={<Navigate to="/weekly" replace />} />
            </Routes>
          </main>
        </div>
        {/* Fixed lock icon — only visible when ADMIN_PASSWORD is set */}
        <UnlockButton />
      </BrowserRouter>
    </AdminProvider>
  )
}
