import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  CheckSquare, Mic, BarChart2, Target, Palette,
  RefreshCw, Settings, AlertTriangle, MessageSquare
} from 'lucide-react'

const NAV_ALON = [
  { id: 'tasks',   icon: CheckSquare, label: 'Tasks'   },
  { id: 'standup', icon: Mic,         label: 'Standup' },
]
const NAV_TEAM = [
  { id: 'weekly',   icon: BarChart2, label: 'Weekly' },
  { id: 'status',   icon: Target,    label: 'Status' },
  { id: 'studio',   icon: Palette,   label: 'Studio' },
  { id: 'settings', icon: Settings,  label: 'Settings' },
]

export function Sidebar({ status, onSync, isSyncing, onReset, isResetting, followUps }) {
  const navigate = useNavigate()
  const location = useLocation()
  const activePage = location.pathname.replace('/', '') || 'tasks'
  const [showGear, setShowGear] = useState(false)
  const gearRef = useRef(null)
  useEffect(() => {
    const handler = (e) => { if (gearRef.current && !gearRef.current.contains(e.target)) setShowGear(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  const openCount = followUps.filter(f => f.status !== 'done' && f.status !== 'finished').length
  return (
    <aside style={{ width: 220, minWidth: 220 }} className="flex flex-col h-screen bg-sidebar border-r-2 border-[rgba(255,255,255,0.10)]">
      <div className="px-4 py-4 flex items-center gap-2.5 border-b border-border/40">
        <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center">
          <MessageSquare size={14} className="text-primary" />
        </div>
        <div>
          <div className="text-sm font-semibold text-foreground leading-none">Katz World</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </div>
        </div>
      </div>
      <nav className="flex-1 px-2 py-3 flex flex-col gap-0.5 overflow-y-auto">
        <div className="px-2 pt-1 pb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Alon</span>
        </div>
        {NAV_ALON.map(item => {
          const isActive = activePage === item.id
          const Icon = item.icon
          const badge = item.id === 'tasks' && openCount > 0 ? openCount : null
          return (
            <button key={item.id} onClick={() => navigate('/' + item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-[13px] transition-colors text-left border-l-2 ${
                isActive
                  ? 'border-primary bg-primary/10 text-foreground font-medium'
                  : 'border-transparent text-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
              }`}>
              <Icon size={16} className="shrink-0" />
              <span className="flex-1">{item.label}</span>
              {badge && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/20 text-primary min-w-[18px] text-center">{badge}</span>
              )}
            </button>
          )
        })}
        <div className="px-2 pt-4 pb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Team</span>
        </div>
        {NAV_TEAM.map(item => {
          const isActive = activePage === item.id
          const Icon = item.icon
          return (
            <button key={item.id} onClick={() => navigate('/' + item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-[13px] transition-colors text-left border-l-2 ${
                isActive
                  ? 'border-primary bg-primary/10 text-foreground font-medium'
                  : 'border-transparent text-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
              }`}>
              <Icon size={16} className="shrink-0" />
              <span className="flex-1">{item.label}</span>
            </button>
          )
        })}
      </nav>
      <div className="px-3 py-3 border-t-2 border-[rgba(255,255,255,0.10)] flex flex-col gap-2">
        {status?.stats && (
          <div className="flex gap-3 px-1">
            <div className="text-center">
              <div className="text-xs font-semibold text-foreground">{status.stats.totalMessages?.toLocaleString() || 0}</div>
              <div className="text-[10px] text-muted-foreground">msgs</div>
            </div>
            <div className="text-center">
              <div className="text-xs font-semibold text-foreground">{status.stats.totalChannels || 0}</div>
              <div className="text-[10px] text-muted-foreground">ch</div>
            </div>
            <div className="text-center">
              <div className={`text-xs font-semibold ${status.stats.unanalyzedCount > 0 ? 'text-amber-400' : 'text-foreground'}`}>
                {status.stats.unanalyzedCount ?? 0}
              </div>
              <div className="text-[10px] text-muted-foreground">new</div>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <button onClick={onSync} disabled={isSyncing}
            className="flex items-center justify-center gap-1.5 w-full px-3 py-1.5 rounded-md bg-primary/20 hover:bg-primary/30 text-primary text-xs font-medium transition-colors disabled:opacity-50">
            <RefreshCw size={11} className={isSyncing ? 'animate-spin' : ''} />
            {isSyncing ? 'Syncing…' : 'Sync Slack'}
          </button>
          <div ref={gearRef} className="relative">
            <button onClick={() => setShowGear(v => !v)}
              className="flex items-center justify-center gap-1.5 w-full px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-muted-foreground text-xs transition-colors">
              <Settings size={12} /> Settings
            </button>
            {showGear && (
              <div className="absolute bottom-full left-0 right-0 mb-1 bg-card border border-border rounded-lg shadow-xl p-2 flex flex-col gap-1 z-50">
                <button onClick={() => { onReset(); setShowGear(false) }} disabled={isResetting}
                  className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 rounded-md transition-colors disabled:opacity-50 flex items-center gap-1.5">
                  <AlertTriangle size={11} />
                  {isResetting ? 'Resetting…' : 'Reset All Data'}
                </button>
              </div>
            )}
          </div>
        </div>
        {status?.sync && (
          <div className="text-[10px] text-muted-foreground/60 px-1">
            {status.sync.lastSyncAt ? `Last sync: ${new Date(status.sync.lastSyncAt).toLocaleTimeString()}` : 'Never synced'}
          </div>
        )}
      </div>
    </aside>
  )
}
