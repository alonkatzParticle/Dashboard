import { useState, useEffect, useRef, useCallback } from 'react'
import React from 'react'
import ReactMarkdown from 'react-markdown'

function cn(...classes) { return classes.filter(Boolean).join(' ') }

// ── Markdown renderer ─────────────────────────────────────────────────────────
function renderBoldLine(line, key) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g)
  return (
    <span key={key}>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
        return part
      })}
    </span>
  )
}
function MarkdownText({ text }) {
  const lines = text.split('\n')
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-2" />
        if (/^#{1,3} /.test(line)) {
          const content = line.replace(/^#{1,3} /, '')
          return <h3 key={i} className="font-semibold text-sm mt-3 mb-0.5 first:mt-0 text-foreground">{renderBoldLine(content, i)}</h3>
        }
        if (/^\s{2,}-\s/.test(line)) {
          return (
            <div key={i} className="flex gap-1.5 pl-5 text-muted-foreground">
              <span className="shrink-0">◦</span>
              <span>{renderBoldLine(line.replace(/^\s+-\s/, ''), i)}</span>
            </div>
          )
        }
        if (/^[-•]\s/.test(line)) {
          return (
            <div key={i} className="flex gap-1.5">
              <span className="shrink-0 text-primary">•</span>
              <span>{renderBoldLine(line.replace(/^[-•]\s/, ''), i)}</span>
            </div>
          )
        }
        return <p key={i}>{renderBoldLine(line, i)}</p>
      })}
    </div>
  )
}

const NAV_ALON = [
  { id: 'tasks',    icon: '✓',  label: 'Tasks'    },
  { id: 'standup',  icon: '🗣️', label: 'Standup'  },
  { id: 'waiting',  icon: '⏳', label: 'Waiting'  },
  { id: 'people',   icon: '👤', label: 'People'   },
]
const NAV_TEAM = [
  { id: 'weekly',  icon: '📊', label: 'Weekly'  },
  { id: 'status',  icon: '🎯', label: 'Status'  },
  { id: 'studio',  icon: '🎨', label: 'Studio'  },
]

function Sidebar({ activePage, onNavigate, status, onSync, isSyncing, onReset, isResetting, followUps, finished = [] }) {
  const [showGear, setShowGear] = useState(false)
  const gearRef = useRef(null)
  useEffect(() => {
    const handler = (e) => { if (gearRef.current && !gearRef.current.contains(e.target)) setShowGear(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  const urgentCount = followUps.filter(f => f.priority === 'high' && f.status !== 'done').length
  return (
    <aside style={{ width: 220, minWidth: 220 }} className="flex flex-col h-screen bg-sidebar border-r-2 border-[rgba(255,255,255,0.10)]">
      <div className="px-4 py-4 flex items-center gap-2.5 border-b border-border/40">
        <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center text-base">💬</div>
        <div>
          <div className="text-sm font-semibold text-foreground leading-none">Slack Summary</div>
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
          return (
            <button key={item.id} onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-[15px] transition-colors text-left ${isActive ? 'bg-white/[0.08] text-white font-medium' : 'text-[#888892] hover:bg-white/[0.04] hover:text-[#c8c8d0]'}`}>
              <span className="text-[17px] w-6 flex-shrink-0 flex items-center justify-center">{item.icon}</span>
              <span className="flex-1 font-medium">{item.label}</span>
            </button>
          )
        })}
        <div className="px-2 pt-4 pb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Team</span>
        </div>
        {NAV_TEAM.map(item => {
          const isActive = activePage === item.id
          return (
            <button key={item.id} onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-[15px] transition-colors text-left ${isActive ? 'bg-white/[0.08] text-white font-medium' : 'text-[#888892] hover:bg-white/[0.04] hover:text-[#c8c8d0]'}`}>
              <span className="text-[17px] w-6 flex-shrink-0 flex items-center justify-center">{item.icon}</span>
              <span className="flex-1 font-medium">{item.label}</span>
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
            {isSyncing ? '⟳ Syncing…' : '⟳ Sync Slack'}
          </button>
          <div ref={gearRef} className="relative">
            <button onClick={() => setShowGear(v => !v)}
              className="flex items-center justify-center gap-1.5 w-full px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-muted-foreground text-xs transition-colors">
              ⚙ Settings
            </button>
            {showGear && (
              <div className="absolute bottom-full left-0 right-0 mb-1 bg-card border border-border rounded-lg shadow-xl p-2 flex flex-col gap-1 z-50">
                <button onClick={() => { onReset(); setShowGear(false) }} disabled={isResetting}
                  className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 rounded-md transition-colors disabled:opacity-50">
                  {isResetting ? 'Resetting…' : '⚠ Reset All Data'}
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

// ── App root ──────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState('tasks')
  const [status, setStatus] = useState(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [followUps, setFollowUps] = useState([])
  const [finished, setFinished] = useState([])

  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(setStatus).catch(() => {})
    fetch('/api/follow-ups').then(r => r.json()).then(d => {
      setFollowUps(d.followUps ?? [])
      setFinished(d.finished ?? [])
    }).catch(() => {})
  }, [])

  const handleSync = async () => {
    setIsSyncing(true)
    try {
      await fetch('/api/sync', { method: 'POST' })
      const s = await fetch('/api/status').then(r => r.json())
      setStatus(s)
    } catch {}
    setIsSyncing(false)
  }

  const handleReset = async () => {
    if (!confirm('Reset all data? This cannot be undone.')) return
    setIsResetting(true)
    try { await fetch('/api/reset', { method: 'POST' }) } catch {}
    setIsResetting(false)
    window.location.reload()
  }

  const renderPage = () => {
    switch (page) {
      case 'tasks':    return <TasksPage />
      case 'standup':  return <StandupPage />
      case 'waiting':  return <WaitingPage followUps={followUps} setFollowUps={setFollowUps} />
      case 'people':   return <PeoplePage followUps={followUps} setFollowUps={setFollowUps} />
      case 'weekly':   return <WeeklyPage />
      case 'status':   return <StatusReportPage />
      case 'studio':   return <StudioPage />
      default:         return <TasksPage />
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar activePage={page} onNavigate={setPage} status={status}
        onSync={handleSync} isSyncing={isSyncing}
        onReset={handleReset} isResetting={isResetting}
        followUps={followUps} finished={finished} />
      <main className="flex-1 overflow-auto p-6">{renderPage()}</main>
    </div>
  )
}

// ── Messages Page ─────────────────────────────────────────────────────────────
function MessagesPage() {
  const [messages, setMessages] = useState([])
  const [channels, setChannels] = useState([])
  const [selectedChannel, setSelectedChannel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [userMap, setUserMap] = useState({})

  useEffect(() => {
    fetch('/api/users').then(r => r.json()).then(setUserMap).catch(() => {})
    fetch('/api/channels').then(r => r.json()).then(data => setChannels(data || [])).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    const url = selectedChannel
      ? `/api/messages?limit=200&channel=${encodeURIComponent(selectedChannel)}`
      : '/api/messages?limit=200'
    fetch(url).then(r => r.json()).then(data => {
      setMessages(Array.isArray(data) ? data : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [selectedChannel])

  const resolveUser = (id) => userMap[id] || id

  // Group by channel
  const grouped = {}
  messages.forEach(m => {
    const ch = m.channel_name || m.channel_id || 'Unknown'
    if (!grouped[ch]) grouped[ch] = []
    grouped[ch].push(m)
  })

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex items-center justify-between shrink-0">
        <h1 className="text-2xl font-bold text-foreground">Messages</h1>
        <select
          value={selectedChannel || ''}
          onChange={e => setSelectedChannel(e.target.value || null)}
          className="px-3 py-1.5 rounded-lg border border-border bg-card/50 text-sm text-foreground focus:outline-none focus:border-primary/50"
        >
          <option value="">All Channels</option>
          {channels.map(ch => (
            <option key={ch.channel_id} value={ch.channel_id}>{ch.name}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-muted-foreground">Loading messages...</div>
      ) : messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <p className="text-4xl">💬</p>
          <p className="text-lg font-semibold text-foreground">No messages yet</p>
          <p className="text-sm text-muted-foreground">Sync Slack to load messages.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-6 custom-scrollbar pr-1">
          {Object.entries(grouped).map(([ch, msgs]) => (
            <div key={ch}>
              <h3 className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-widest mb-3 sticky top-0 bg-background/80 backdrop-blur py-1">
                #{ch}
              </h3>
              <div className="space-y-1">
                {msgs.map((m, i) => {
                  const name = resolveUser(m.user_id) || 'Unknown'
                  const initials = name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase()
                  const time = m.ts ? new Date(parseFloat(m.ts) * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : ''
                  return (
                    <div key={m.id || i} className="flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-white/[0.03] transition-colors group">
                      <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary shrink-0 mt-0.5">{initials}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-semibold text-foreground">{name}</span>
                          <span className="text-[10px] text-muted-foreground/50">{time}</span>
                        </div>
                        <p className="text-sm text-foreground/80 leading-relaxed mt-0.5 break-words">{m.text}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Summary Page ───────────────────────────────────────────────────────────────
function SummaryPage() {
  const [status, setStatus] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState(null)

  const load = () => {
    fetch('/api/summary/status').then(r => r.json()).then(setStatus).catch(() => {})
  }

  useEffect(() => { load() }, [])

  const generate = async (force = false) => {
    setGenerating(true)
    setProgress(null)
    const es = new EventSource(`/api/summary/generate${force ? '?force=true' : ''}`)
    es.addEventListener('progress', e => {
      try { setProgress(JSON.parse(e.data)) } catch {}
    })
    es.addEventListener('done', () => {
      es.close()
      setGenerating(false)
      setProgress(null)
      load()
    })
    es.addEventListener('error', () => {
      es.close()
      setGenerating(false)
    })
  }

  const result = status?.result || {}
  const summary = result.summary
  const candidates = result.candidates || []
  const followUps = result.followUps || []

  const confirmCandidate = async (id) => {
    await fetch(`/api/follow-ups/${id}/confirm`, { method: 'PATCH' })
    load()
  }
  const dismissCandidate = async (id) => {
    await fetch(`/api/follow-ups/${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Daily Summary</h1>
        <div className="flex gap-2">
          <button onClick={() => generate(false)} disabled={generating}
            className="px-3 py-1.5 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-sm font-medium transition-colors disabled:opacity-40">
            {generating ? (progress ? `Processing ${progress.channelsDone||0}/${progress.channelsTotal||'?'} channels...` : 'Starting...') : '⟳ Refresh with Claude'}
          </button>
          <button onClick={() => generate(true)} disabled={generating}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-muted-foreground transition-colors disabled:opacity-40">
            Force Reanalyze
          </button>
        </div>
      </div>

      {/* AI Summary */}
      <div className="rounded-xl border border-border/40 bg-card/30 p-6">
        {!summary ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground/60 text-sm">No summary yet. Click "Refresh with Claude" to generate.</p>
          </div>
        ) : (
          <p className="text-foreground leading-relaxed">{summary}</p>
        )}
        {result.generatedAt && (
          <p className="text-[11px] text-muted-foreground/40 mt-4">Generated {new Date(result.generatedAt).toLocaleString()}</p>
        )}
      </div>

      {/* Candidate Triage */}
      {candidates.length > 0 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5">
          <div className="px-5 py-3 border-b border-amber-500/20 flex items-center gap-2">
            <span className="text-amber-400 text-sm font-semibold">⚡ {candidates.length} AI Suggestions</span>
            <span className="text-xs text-muted-foreground">Review and confirm tasks the AI extracted from your messages</span>
          </div>
          <div className="divide-y divide-border/20">
            {candidates.map(c => (
              <div key={c.id} className="px-5 py-4 flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground font-medium">{c.text}</p>
                  {c.context && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.context}</p>}
                  {c.channel_name && <span className="text-[10px] text-muted-foreground/50 mt-1 block">#{c.channel_name}</span>}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => confirmCandidate(c.id)}
                    className="px-3 py-1.5 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-xs font-semibold transition-colors">
                    ✓ Confirm
                  </button>
                  <button onClick={() => dismissCandidate(c.id)}
                    className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-red-500/10 text-muted-foreground hover:text-red-400 text-xs font-semibold transition-colors">
                    ✕ Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Open Follow-ups */}
      {followUps.length > 0 && (
        <div className="rounded-xl border border-border/40 bg-card/30">
          <div className="px-5 py-3 border-b border-border/30">
            <span className="text-sm font-semibold text-foreground">{followUps.length} Open Follow-ups</span>
          </div>
          <div className="divide-y divide-border/20">
            {followUps.map(f => (
              <div key={f.id} className="px-5 py-3">
                <p className="text-sm text-foreground">{f.text}</p>
                {f.channel_name && <span className="text-[10px] text-muted-foreground/50">#{f.channel_name}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// -- Task Detail Drawer
function TaskDetailModal({ task, onClose }) {
  const rawMessages = (() => {
    if (!task.source_messages) return []
    try { return JSON.parse(task.source_messages) } catch { return [] }
  })()

  // Parse messages whether they're strings "[#Ch] [User]: text" or objects
  const messages = rawMessages.map(msg => {
    if (typeof msg === 'string') {
      const match = msg.match(/^\[([^\]]+)\] \[([^\]]+)\]: (.+)$/)
      if (match) return { channel: match[1], sender: match[2], text: match[3] }
      return { text: msg }
    }
    return {
      sender: msg.user_name || msg.username || msg.user || null,
      text: msg.text || msg.message || msg.content || JSON.stringify(msg),
      ts: msg.ts || null,
    }
  })

  const priority = (task.priority || 'medium').toLowerCase()
  const taskType = (task.task_type || 'task').toLowerCase()
  const priorityStyle = {
    high: 'bg-red-500/20 text-red-300 border-red-500/40',
    critical: 'bg-red-500/20 text-red-300 border-red-500/40',
    medium: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    low: 'bg-slate-500/20 text-slate-300 border-slate-400/40',
  }[priority] || 'bg-amber-500/20 text-amber-300 border-amber-500/40'
  const typeStyle = {
    task: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
    followup: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
    decision: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
  }[taskType] || 'bg-blue-500/20 text-blue-300 border-blue-500/40'
  const typeLabel = { task: 'Task', followup: 'Follow-up', decision: 'Decision' }[taskType] || taskType

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative h-full w-[480px] bg-slate-900 border-l border-slate-700 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-700 shrink-0 bg-slate-800">
          <div className="flex-1 min-w-0 pr-4">
            <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-1.5 font-semibold">Task Detail</p>
            <h2 className="text-base font-semibold text-white leading-snug">{task.text}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1 -mr-1 -mt-1 text-lg leading-none">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-slate-900">
          {/* Badges */}
          <div className="flex gap-1.5 flex-wrap">
            <span className={`text-[11px] px-2.5 py-0.5 rounded-full border font-semibold ${priorityStyle}`}>
              {priority.charAt(0).toUpperCase() + priority.slice(1)}
            </span>
            <span className={`text-[11px] px-2.5 py-0.5 rounded-full border font-semibold ${typeStyle}`}>{typeLabel}</span>
            <span className="text-[11px] px-2.5 py-0.5 rounded-full border font-semibold bg-slate-700 text-slate-300 border-slate-600 capitalize">{task.status}</span>
            {task.source === 'claude' && <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-violet-500/20 border border-violet-500/40 text-violet-300 font-semibold">✦ Claude</span>}
            {task.resolved_by === 'claude' && <span className="text-[11px] px-2.5 py-0.5 rounded-full border font-semibold bg-teal-500/20 text-teal-300 border-teal-500/40">✦ Auto-resolved</span>}
            {task.resolved_by === 'user' && <span className="text-[11px] px-2.5 py-0.5 rounded-full border font-semibold bg-green-500/20 text-green-300 border-green-500/40">✓ Resolved by you</span>}
          </div>

          {/* Fields */}
          <div className="space-y-4">
            {task.context && (
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Context</p>
                <p className="text-sm text-slate-200 leading-relaxed">{task.context}</p>
              </div>
            )}
            {task.channel_name && (
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Channel</p>
                <p className="text-sm text-slate-200">#{task.channel_name}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              {task.created_at && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Created</p>
                  <p className="text-xs text-slate-300">{new Date(task.created_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                </div>
              )}
              {task.resolved_at && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Resolved</p>
                  <p className="text-xs text-slate-300">{new Date(task.resolved_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                </div>
              )}
            </div>
          </div>

          {/* Source messages */}
          {messages.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Source Messages ({messages.length})</p>
              <div className="space-y-2">
                {messages.map((msg, i) => (
                  <div key={i} className="p-3 rounded-lg bg-slate-800 border border-slate-600">
                    {msg.sender && (
                      <p className="text-[11px] font-bold text-violet-400 mb-1.5">@{msg.sender}</p>
                    )}
                    <p className="text-sm text-slate-100 leading-relaxed">{msg.text}</p>
                    {msg.ts && (
                      <p className="text-[10px] text-slate-500 mt-1.5">
                        {new Date(parseFloat(msg.ts) * 1000).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {messages.length === 0 && task.source !== 'claude' && (
            <p className="text-xs text-slate-500">No source messages — task was added manually.</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Kanban / Tasks Page ───────────────────────────────────────────────────────

function TasksPage() {
  const [tasks, setTasks] = useState([])
  const [candidates, setCandidates] = useState([])
  const [candidatesOpen, setCandidatesOpen] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [genProgress, setGenProgress] = useState(null)
  const [loading, setLoading] = useState(true)
  const [newTask, setNewTask] = useState('')
  const [adding, setAdding] = useState(false)
  const [dragId, setDragId] = useState(null)
  const [dragOverCol, setDragOverCol] = useState(null)
  const [selectedTask, setSelectedTask] = useState(null)
  const [newPriority, setNewPriority] = useState('medium')
  const [newType, setNewType] = useState('task')

  const COLUMNS = [
    { id: 'open', label: 'New Tasks', color: '#3b82f6' },
    { id: 'in_progress', label: 'In Progress', color: '#eab308' },
    { id: 'finished', label: 'Done', color: '#22c55e' }
  ]

  const fetchTasks = async () => {
    try {
      // Fetch open/in_progress and finished separately (correct API usage)
      const [activeRes, finishedRes, candidateRes] = await Promise.all([
        fetch('/api/follow-ups?status=open'),
        fetch('/api/follow-ups?status=finished'),
        fetch('/api/follow-ups?status=candidate')
      ])
      const [active, finished, cands] = await Promise.all([
        activeRes.json(), finishedRes.json(), candidateRes.json()
      ])
      // Also fetch in_progress
      const inPRes = await fetch('/api/follow-ups?status=in_progress')
      const inProgress = await inPRes.json()
      setTasks([
        ...(Array.isArray(active) ? active : []),
        ...(Array.isArray(inProgress) ? inProgress : []),
        ...(Array.isArray(finished) ? finished : [])
      ])
      setCandidates(Array.isArray(cands) ? cands : [])
      setLoading(false)
    } catch { setLoading(false) }
  }

  useEffect(() => { fetchTasks() }, [])

  const addTask = async () => {
    if (!newTask.trim()) return
    setAdding(true)
    try {
      await fetch('/api/follow-ups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: newTask.trim(), task_type: newType, priority: newPriority }),
      })
      await fetchTasks()
      setNewTask('')
    } catch {}
    setAdding(false)
  }

  const updateStatus = async (taskId, newStatus) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t))
    try {
      if (newStatus === 'finished') {
        await fetch(`/api/follow-ups/${taskId}/resolve`, { method: 'PATCH' })
      } else {
        await fetch(`/api/followups/${taskId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus === 'open' ? 'open' : 'in_progress' })
        })
      }
      fetchTasks()
    } catch {}
  }

  const deleteTask = async (taskId) => {
    setTasks(prev => prev.filter(t => t.id !== taskId))
    await fetch(`/api/follow-ups/${taskId}`, { method: 'DELETE' }).catch(() => {})
  }

  const confirmCandidate = async (id) => {
    await fetch(`/api/follow-ups/${id}/confirm`, { method: 'PATCH' })
    fetchTasks()
  }
  const dismissCandidate = async (id) => {
    await fetch(`/api/follow-ups/${id}`, { method: 'DELETE' })
    fetchTasks()
  }

  const handleDragStart = (e, id) => { setDragId(id); e.dataTransfer.effectAllowed = 'move' }
  const handleDragEnd = () => { setDragId(null); setDragOverCol(null) }
  const handleDragOver = (e, colId) => { e.preventDefault(); setDragOverCol(colId) }
  const handleDrop = (e, colId) => {
    e.preventDefault()
    if (dragId) updateStatus(dragId, colId)
    setDragId(null); setDragOverCol(null)
  }

  const grouped = { open: [], in_progress: [], finished: [] }
  tasks.forEach(t => {
    let s = t.status || 'open'
    if (s === 'done') s = 'finished'
    if (grouped[s]) grouped[s].push(t)
    else grouped['open'].push(t)
  })

  if (loading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading tasks...</div>

  const refreshWithClaude = async () => {
    setGenerating(true)
    setGenProgress(null)
    const es = new EventSource('/api/summary/generate')
    es.addEventListener('progress', e => {
      try { setGenProgress(JSON.parse(e.data)) } catch {}
    })
    es.addEventListener('done', () => {
      es.close()
      setGenerating(false)
      setGenProgress(null)
      fetchTasks()
    })
    es.addEventListener('error', () => {
      es.close()
      setGenerating(false)
    })
  }

  return (
    <>
    <div className="space-y-4 flex flex-col h-full pb-6">
      <div className="flex items-center justify-between shrink-0">
        <h1 className="text-2xl font-bold text-foreground">Tasks</h1>
        <div className="flex gap-2 items-center">
          <button onClick={refreshWithClaude} disabled={generating}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground text-sm transition-colors disabled:opacity-40 flex items-center gap-1.5">
            {generating
              ? (genProgress ? `⟳ ${genProgress.channelsDone||0}/${genProgress.channelsTotal||'?'} channels...` : '⟳ Starting...')
              : '⟳ Refresh with Claude'}
          </button>
        </div>
      </div>

      {/* Candidate Triage Dropdown */}
      {candidates.length > 0 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 shrink-0">
          <button
            onClick={() => setCandidatesOpen(o => !o)}
            className="w-full px-5 py-3 flex items-center gap-2 text-left"
          >
            <span className="text-amber-400 text-sm font-semibold">⚡ {candidates.length} AI Suggestions</span>
            <span className="text-xs text-muted-foreground flex-1">Tasks the AI extracted from your Slack messages</span>
            <span className="text-muted-foreground text-xs">{candidatesOpen ? '▲' : '▼'}</span>
          </button>
          {candidatesOpen && (
            <div className="border-t border-amber-500/20 divide-y divide-border/20 max-h-[35vh] overflow-y-auto">
              {candidates.map(c => {
                const people = c.channel_name ? c.channel_name.split(',').map(s => s.trim()).filter(Boolean) : []
                const ts = c.created_at ? new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
                return (
                  <div key={c.id} className="px-5 py-3 flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground font-medium">{c.text}</p>
                      {c.context && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{c.context}</p>}
                      <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                        {people.map((p, i) => (
                          <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-border/40 text-muted-foreground">{p}</span>
                        ))}
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-primary">✦ Claude</span>
                        {ts && <span className="text-[10px] text-muted-foreground/40 ml-auto">{ts}</span>}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => confirmCandidate(c.id)}
                        className="px-3 py-1 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-xs font-semibold transition-colors">
                        ✓ Add to Tasks
                      </button>
                      <button onClick={() => dismissCandidate(c.id)}
                        className="px-3 py-1 rounded-lg bg-white/5 hover:bg-red-500/10 text-muted-foreground hover:text-red-400 text-xs font-semibold transition-colors">
                        ✕
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-6 flex-1 min-h-0">
        {COLUMNS.map(col => (
          <div key={col.id}
            onDragOver={e => handleDragOver(e, col.id)}
            onDrop={e => handleDrop(e, col.id)}
            className={`rounded-xl border flex flex-col bg-card/30 overflow-hidden transition-colors ${dragOverCol === col.id ? 'border-primary/50 bg-primary/5' : 'border-border/40'}`}>
            <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between shrink-0 bg-background/50 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: col.color }} />
                <span className="text-sm font-semibold text-foreground">{col.label}</span>
              </div>
              <span className="bg-white/5 px-2 py-0.5 rounded-full text-xs text-muted-foreground">{grouped[col.id].length}</span>
            </div>
            
            <div className="flex-1 p-3 overflow-y-auto overflow-x-hidden space-y-3 custom-scrollbar">
              {/* Draft card — only in the To Do column */}
              {col.id === 'open' && (
                <div className="p-3 rounded-xl bg-card border border-primary/30 flex flex-col gap-2.5">
                  <input
                    value={newTask}
                    onChange={e => setNewTask(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addTask()}
                    placeholder="New task..."
                    className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                    autoComplete="off"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex gap-1 flex-wrap">
                      {['low','medium','high','critical'].map(p => (
                        <button key={p} onClick={() => setNewPriority(p)}
                          className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold transition-colors ${
                            newPriority === p
                              ? { low:'bg-slate-500/40 text-slate-200 border-slate-400/60', medium:'bg-amber-500/30 text-amber-200 border-amber-400/60', high:'bg-red-500/30 text-red-200 border-red-400/60', critical:'bg-red-700/40 text-red-200 border-red-500/60' }[p]
                              : 'bg-white/0 text-muted-foreground border-border/30 hover:border-border/60'
                          }`}>
                          {p.charAt(0).toUpperCase() + p.slice(1)}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-1">
                      {[['task','Task'],['followup','Follow-up'],['decision','Decision']].map(([val, label]) => (
                        <button key={val} onClick={() => setNewType(val)}
                          className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold transition-colors ${
                            newType === val
                              ? { task:'bg-blue-500/30 text-blue-200 border-blue-400/60', followup:'bg-purple-500/30 text-purple-200 border-purple-400/60', decision:'bg-orange-500/30 text-orange-200 border-orange-400/60' }[val]
                              : 'bg-white/0 text-muted-foreground border-border/30 hover:border-border/60'
                          }`}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button onClick={addTask} disabled={adding || !newTask.trim()}
                    className="w-full py-1 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-xs font-semibold transition-colors disabled:opacity-30">
                    {adding ? '...' : '+ Add Task'}
                  </button>
                </div>
              )}
              {grouped[col.id].map(task => {
                  const people = task.channel_name ? task.channel_name.split(',').map(s => s.trim()).filter(Boolean) : []
                  const ts = task.created_at ? new Date(task.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
                  const priority = (task.priority || 'medium').toLowerCase()
                  const taskType = (task.task_type || 'task').toLowerCase()
                  const priorityStyle = {
                    high:     'bg-red-500/15 text-red-400 border-red-500/30',
                    critical: 'bg-red-500/15 text-red-400 border-red-500/30',
                    medium:   'bg-amber-500/15 text-amber-400 border-amber-500/30',
                    low:      'bg-slate-500/15 text-slate-400 border-slate-400/30',
                  }[priority] || 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                  const typeStyle = {
                    task:     'bg-blue-500/15 text-blue-400 border-blue-500/30',
                    followup: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
                    decision: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
                  }[taskType] || 'bg-blue-500/15 text-blue-400 border-blue-500/30'
                  const typeLabel = { task: 'Task', followup: 'Follow-up', decision: 'Decision' }[taskType] || taskType
                  return (
                    <div key={task.id}
                      draggable
                      onDragStart={e => handleDragStart(e, task.id)}
                      onDragEnd={handleDragEnd}
                      onClick={() => setSelectedTask(task)}
                      className={`group p-3.5 rounded-xl bg-card border border-border/50 cursor-pointer hover:border-primary/40 hover:border transition-all flex flex-col gap-2 ${dragId === task.id ? 'opacity-40 scale-[0.98]' : 'hover:shadow-md'}`}>

                      <div className="flex items-start justify-between gap-3">
                        <p className="text-[14px] text-foreground font-medium leading-snug flex-1 min-w-0">{task.text}</p>
                        <button onClick={e => { e.stopPropagation(); deleteTask(task.id) }} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-400 p-1 -mr-1 -mt-1 shrink-0">
                          <span className="text-xs">✕</span>
                        </button>
                      </div>

                      {task.context && <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">{task.context}</p>}

                      <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${priorityStyle}`}>
                          {priority.charAt(0).toUpperCase() + priority.slice(1)}
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${typeStyle}`}>
                          {typeLabel}
                        </span>
                        {people.map((p, i) => (
                          <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-border/40 text-muted-foreground">{p}</span>
                        ))}
                        {task.source === 'claude' && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center gap-1">✦ Claude</span>
                        )}
                        {task.resolved_by === 'claude' && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full border font-semibold bg-teal-500/15 text-teal-400 border-teal-500/30">✦ Auto-resolved</span>
                        )}
                        {task.resolved_by === 'user' && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full border font-semibold bg-green-500/15 text-green-400 border-green-500/30">✓ Resolved by you</span>
                        )}
                        {ts && <span className="text-[10px] text-muted-foreground/40 ml-auto">{ts}</span>}
                      </div>
                    </div>
                  )
                })}
              
              {grouped[col.id].length === 0 && (
                <div className="h-24 flex items-center justify-center text-xs text-muted-foreground/40 border-2 border-dashed border-border/20 rounded-xl m-1">
                  Drop tasks here
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
    {selectedTask && <TaskDetailModal task={selectedTask} onClose={() => setSelectedTask(null)} />}
    </>
  )
}

// -- Standup / Done Page (Combined)
function StandupPage() {
  const [doneTasks, setDoneTasks] = useState([])
  const [selectedTasks, setSelectedTasks] = useState(new Set())
  const [generating, setGenerating] = useState(false)
  const [summaryText, setSummaryText] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/follow-ups?status=finished')
      .then(r => r.json())
      .then(data => {
        setDoneTasks(Array.isArray(data) ? data : [])
        setLoading(false)
      }).catch(() => setLoading(false))
  }, [])

  const toggleTask = (id) => {
    const next = new Set(selectedTasks)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedTasks(next)
  }

  const generateStandup = async () => {
    if (selectedTasks.size === 0) return
    setGenerating(true)
    setSummaryText('')
    try {
      const selectedPayload = doneTasks.filter(t => selectedTasks.has(t.id))
      const res = await fetch('/api/status-report/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isWeekly: false, tasks: selectedPayload })
      })
      if (!res.body) throw new Error('No body')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let done = false
      let text = ''
      while (!done) {
        const { value, done: readerDone } = await reader.read()
        done = readerDone
        if (value) {
          text += decoder.decode(value, { stream: true })
          setSummaryText(text)
        }
      }
    } catch (e) {
      console.error(e)
    }
    setGenerating(false)
  }

  // Group by day (e.g. "Today", "Yesterday", "MMM DD")
  const groupByDay = () => {
    const groups = {}
    doneTasks.forEach(task => {
      if (!task.resolved_at) return
      const date = new Date(task.resolved_at)
      const now = new Date()

      // Compare calendar days (strip time) to avoid midnight-crossing bugs
      const nowDay  = new Date(now.getFullYear(),  now.getMonth(),  now.getDate())
      const taskDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
      const diffDays = Math.round((nowDay - taskDay) / (1000 * 60 * 60 * 24))

      const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      let label
      if (diffDays === 0)      label = `Today · ${dateStr}`
      else if (diffDays === 1) label = `Yesterday · ${dateStr}`
      else if (diffDays < 7)  label = `${date.toLocaleDateString('en-US', { weekday: 'long' })} · ${dateStr}`
      else                     label = dateStr

      if (!groups[label]) groups[label] = []
      groups[label].push(task)
    })
    return groups
  }

  const groups = groupByDay()
  const keys = Object.keys(groups) // Sorted loosely by order of appearance (which is descending from backend ideally)

  if (loading) return <div className="text-center py-12 text-muted-foreground">Loading done tasks...</div>

  return (
    <div className="flex h-[calc(100vh-6rem)] gap-6">
      {/* Scrollable Left Side: Done Tasks grouped by Date */}
      <div className="flex-1 flex flex-col bg-card/30 rounded-xl border border-border/40 overflow-hidden">
        <div className="px-6 py-4 border-b border-border/30 bg-background/50 backdrop-blur-sm flex items-center justify-between shrink-0">
          <h2 className="text-lg font-bold text-foreground">Completed Tasks</h2>
          <span className="text-sm text-muted-foreground">{selectedTasks.size} selected</span>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
          {keys.length === 0 && <div className="text-muted-foreground/60 text-sm text-center mt-12">No completed tasks found.</div>}
          
          {keys.map(day => (
            <div key={day} className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground sticky top-0 bg-card py-1 z-10">{day}</h3>
              <div className="space-y-2">
                {groups[day].map(task => {
                  const priority = (task.priority || 'medium').toLowerCase()
                  const priorityStyle = {
                    high:     'bg-red-500/15 text-red-400 border-red-500/30',
                    critical: 'bg-red-500/15 text-red-400 border-red-500/30',
                    medium:   'bg-amber-500/15 text-amber-400 border-amber-500/30',
                    low:      'bg-slate-500/15 text-slate-400 border-slate-400/30',
                  }[priority] || 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                  return (
                    <label key={task.id} className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${selectedTasks.has(task.id) ? 'bg-primary/5 border-primary/40' : 'bg-card border-border/30 hover:border-border/60'}`}>
                      <div className="pt-0.5">
                        <input type="checkbox" checked={selectedTasks.has(task.id)} onChange={() => toggleTask(task.id)} className="w-3.5 h-3.5 rounded border-border/50 text-primary focus:ring-0 focus:ring-offset-0 bg-background/50 cursor-pointer" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className={`text-[13px] font-medium leading-snug ${selectedTasks.has(task.id) ? 'text-foreground' : 'text-foreground/80'}`}>{task.text}</p>
                          <span className={`text-[10px] px-1.5 py-0 rounded-full border font-semibold shrink-0 ${priorityStyle}`}>
                            {priority.charAt(0).toUpperCase() + priority.slice(1)}
                          </span>
                        </div>
                        {task.context && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{task.context}</p>}
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right Side: Boss Standup Generator */}
      <div className="w-[60%] shrink-0 flex flex-col bg-card/30 rounded-xl border border-border/40 overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-border/30 bg-background/50 backdrop-blur-sm flex items-center justify-between shrink-0">
          <h2 className="text-lg font-bold text-foreground">Boss Update Generator</h2>
        </div>
        
        <div className="p-6 flex flex-col gap-6 flex-1 overflow-auto">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Select completed tasks from the left panel to include in your stand-up message. When ready, generate an AI summary formatted specifically for your boss.
          </p>
          
          <button 
            onClick={generateStandup} 
            disabled={selectedTasks.size === 0 || generating}
            className="w-full py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-sm transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2">
            {generating ? (
              <span className="animate-pulse">Generating Update...</span>
            ) : (
              <>✨ Generate Stand-up ({selectedTasks.size} tasks)</>
            )}
          </button>
          
          {summaryText && (
            <div className="flex-1 flex flex-col mt-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Generated Message</span>
                <button onClick={() => navigator.clipboard.writeText(summaryText)} className="text-xs text-primary hover:text-primary/80 transition-colors">Copy to Clipboard</button>
              </div>
              <div className="flex-1 bg-background/50 border border-border/50 p-4 rounded-xl text-[14px] text-foreground leading-relaxed font-sans overflow-y-auto min-h-[200px] prose prose-invert prose-sm max-w-none">
                <ReactMarkdown>{summaryText}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// -- Waiting Page
function WaitingPage({ followUps, setFollowUps }) {
  const waitingTasks = (followUps || []).filter(f => f.task_type === 'waiting')
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Waiting On</h1>
      </div>
      {waitingTasks.length === 0 ? (
        <div className="rounded-xl border border-border/40 bg-card flex flex-col items-center justify-center py-24 text-center gap-3">
          <p className="text-4xl">&#8987;</p>
          <p className="text-lg font-semibold text-foreground">Nothing waiting</p>
          <p className="text-sm text-muted-foreground">Items you are explicitly waiting for will appear here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {waitingTasks.map(task => (
            <div key={task.id} className="p-4 rounded-xl border border-border/40 bg-card">
              <p className="text-sm text-foreground mb-2">{task.text}</p>
              <div className="text-[10px] text-muted-foreground">#{task.source_channel}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// -- People Page
function PeoplePage({ followUps, setFollowUps }) {
  const peopleTasks = (followUps || []).filter(f => f.task_type === 'people')
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">People</h1>
      </div>
      {peopleTasks.length === 0 ? (
        <div className="rounded-xl border border-border/40 bg-card flex flex-col items-center justify-center py-24 text-center gap-3">
          <p className="text-4xl">&#128100;</p>
          <p className="text-lg font-semibold text-foreground">No people references</p>
          <p className="text-sm text-muted-foreground">Follow-ups related to specific people will appear here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {peopleTasks.map(task => (
            <div key={task.id} className="p-4 rounded-xl border border-border/40 bg-card">
              <p className="text-sm text-foreground mb-2">{task.text}</p>
              <div className="text-[10px] text-muted-foreground">#{task.source_channel}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Background sync hook ──────────────────────────────────────────────────────
function useBackgroundSync(onSync, intervalMs = 60000) {
  const onSyncRef = React.useRef(onSync)
  onSyncRef.current = onSync
  useEffect(() => {
    let timer
    const run = async () => {
      if (document.visibilityState !== 'visible') return
      try { await fetch('/api/monday/sync', { method: 'POST' }); onSyncRef.current() } catch {}
    }
    const onVis = () => { if (document.visibilityState === 'visible') run() }
    timer = setInterval(run, intervalMs)
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVis) }
  }, [intervalMs])
}

// -- Dropbox Preview Modal
function DropboxPreviewModal({ task, weekEnding, memberName, onClose }) {
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [copying, setCopying] = useState(false)
  const [copied, setCopied] = useState(new Set())
  const [lightbox, setLightbox] = useState(null)

  useEffect(() => {
    if (!task.dropbox_link) return
    setLoading(true); setError('')
    fetch('/api/dropbox/folder?url=' + encodeURIComponent(task.dropbox_link))
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setFiles(d.files || []) })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [task.dropbox_link])

  const mediaFiles = files.filter(f => f.is_image || f.is_video)
  const lbIdx = lightbox ? mediaFiles.findIndex(f => f.name === lightbox.name) : -1

  const toggleSelect = (name) => setSelected(prev => {
    const next = new Set(prev); next.has(name) ? next.delete(name) : next.add(name); return next
  })

  const addToWeekly = async () => {
    if (copying || selected.size === 0) return
    setCopying(true)
    const toAdd = files.filter(f => selected.has(f.name))
    const newlyCopied = new Set(copied)
    for (const file of toAdd) {
      try {
        const res = await fetch('/api/dropbox/copy', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filePath: file.path_lower ?? null,
            sharedUrl: file.path_lower ? null : task.dropbox_link,
            fileName: file.name, weekEnding, memberName,
          }),
        })
        const data = await res.json()
        if (!data.success) throw new Error(data.error)
        newlyCopied.add(file.name)
      } catch (e) { alert(`Failed to copy ${file.name}: ${e}`) }
    }
    setCopied(newlyCopied); setSelected(new Set()); setCopying(false)
  }

  const thumbUrl = f =>
    f.path_lower
      ? `/api/dropbox/thumbnail?path=${encodeURIComponent(f.path_lower)}`
      : `/api/dropbox/thumbnail?url=${encodeURIComponent(task.dropbox_link)}&path=${encodeURIComponent(f.name)}`
  const playUrl = f =>
    f.path_lower
      ? `/api/dropbox/thumbnail?path=${encodeURIComponent(f.path_lower)}&mode=play`
      : `/api/dropbox/thumbnail?url=${encodeURIComponent(task.dropbox_link)}&path=${encodeURIComponent(f.name)}&mode=play`

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-[#1a1a2e] border border-white/10 w-full max-w-2xl max-h-[85vh] rounded-t-2xl sm:rounded-2xl flex flex-col shadow-2xl">
        <div className="flex items-start justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div className="min-w-0 flex-1 pr-4">
            <p className="text-xs text-muted-foreground mb-0.5">Dropbox Files</p>
            <h2 className="text-sm font-semibold text-foreground leading-snug truncate">{task.name}</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none p-1">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
              <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <span className="text-sm">Loading files...</span>
            </div>
          )}
          {!loading && error && <p className="text-sm text-red-400 py-4">{error}</p>}
          {!loading && !error && files.length === 0 && <p className="text-sm text-muted-foreground py-4">No files found.</p>}
          {!loading && !error && files.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {files.map(file => {
                const isMedia = file.is_image || file.is_video
                const isSelected = selected.has(file.name)
                const isCopied = copied.has(file.name)
                if (isMedia) return (
                  <div key={file.name} className="relative group aspect-square rounded-lg overflow-hidden border border-white/10 bg-white/5">
                    <button className="absolute inset-0 w-full h-full focus:outline-none" onClick={() => setLightbox(file)}>
                      <img src={thumbUrl(file)} alt={file.name} className="w-full h-full object-cover" />
                      {file.is_video && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center">
                            <span className="text-white text-sm pl-0.5">▶</span>
                          </div>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-end pointer-events-none">
                        <p className="w-full text-white text-xs px-2 py-1 bg-black/50 translate-y-full group-hover:translate-y-0 transition-transform truncate">{file.name}</p>
                      </div>
                    </button>
                    {!isCopied && (
                      <button onClick={e => { e.stopPropagation(); toggleSelect(file.name) }}
                        className={`absolute top-2 left-2 z-10 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-primary border-primary' : 'bg-white/80 border-white/80 opacity-0 group-hover:opacity-100'}`}>
                        {isSelected && <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 12 12"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                      </button>
                    )}
                    {isCopied && (
                      <div className="absolute inset-0 bg-green-600/70 flex flex-col items-center justify-center gap-1 pointer-events-none">
                        <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        <span className="text-white text-xs font-medium">Added</span>
                      </div>
                    )}
                  </div>
                )
                return (
                  <div key={file.name} className="rounded-lg border border-white/10 bg-white/5 aspect-square flex flex-col items-center justify-center gap-2 p-3">
                    <span className="text-2xl">📄</span>
                    <p className="text-xs text-muted-foreground text-center line-clamp-2 break-all">{file.name}</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        {!loading && !error && mediaFiles.length > 0 && (
          <div className="border-t border-white/10 px-5 py-3 flex items-center justify-between shrink-0">
            <p className="text-xs text-muted-foreground">
              {selected.size > 0 ? `${selected.size} selected` : 'Select files to add to Weekly'}
            </p>
            <button onClick={addToWeekly} disabled={selected.size === 0 || copying}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-40 transition-colors hover:bg-primary/80">
              {copying && <div className="h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />}
              Add to Weekly
            </button>
          </div>
        )}
      </div>
      {lightbox && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90"
          onClick={e => { if (e.target === e.currentTarget) setLightbox(null) }}>
          <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl">✕</button>
          {lbIdx > 0 && <button onClick={() => setLightbox(mediaFiles[lbIdx - 1])} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-4xl p-2">‹</button>}
          {lbIdx < mediaFiles.length - 1 && <button onClick={() => setLightbox(mediaFiles[lbIdx + 1])} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-4xl p-2">›</button>}
          <div className="max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-3">
            {lightbox.is_image
              ? <img src={thumbUrl(lightbox)} alt={lightbox.name} className="max-w-full max-h-[80vh] object-contain rounded-lg" />
              : <video src={playUrl(lightbox)} controls autoPlay className="max-w-full max-h-[80vh] rounded-lg" />}
            <p className="text-white/70 text-sm">{lightbox.name}</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── WorkSampleUpload ──────────────────────────────────────────────────────────
function WorkSampleUpload({ memberName, weekEnding }) {
  const [uploads, setUploads] = useState([])
  const [dragging, setDragging] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [urlTitle, setUrlTitle] = useState('')
  const [urlSaving, setUrlSaving] = useState(false)
  const fileInputRef = useRef(null)

  const uploadFile = async (file) => {
    setUploads(prev => [...prev, { name: file.name, status: 'uploading' }])
    try {
      const linkRes = await fetch('/api/dropbox/upload-link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, memberName, weekEnding }),
      })
      const linkData = await linkRes.json()
      if (!linkData.success) throw new Error(linkData.error || 'Failed to get upload link')
      const uploadRes = await fetch(linkData.link, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
      })
      if (!uploadRes.ok) throw new Error('Upload failed')
      setUploads(prev => prev.map(u => u.name === file.name ? { ...u, status: 'success' } : u))
    } catch (err) {
      setUploads(prev => prev.map(u => u.name === file.name ? { ...u, status: 'error', error: String(err) } : u))
    }
  }

  const handleFiles = (files) => { if (!files) return; Array.from(files).forEach(uploadFile) }

  const saveUrl = async () => {
    const trimmed = urlInput.trim()
    if (!trimmed) return
    setUrlSaving(true)
    const name = `${(urlTitle.trim() || trimmed).slice(0, 60)}.url`
    setUploads(prev => [...prev, { name, status: 'uploading' }])
    try {
      const res = await fetch('/api/dropbox/upload-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed, title: urlTitle.trim() || trimmed, memberName, weekEnding }),
      })
      const data = await res.json()
      setUploads(prev => prev.map(u => u.name === name ? { ...u, status: data.success ? 'success' : 'error', error: data.error } : u))
      if (data.success) { setUrlInput(''); setUrlTitle('') }
    } catch (err) {
      setUploads(prev => prev.map(u => u.name === name ? { ...u, status: 'error', error: String(err) } : u))
    } finally { setUrlSaving(false) }
  }

  return (
    <div className="p-6 space-y-5">
      <h3 className="text-base font-semibold text-foreground">Upload Work Samples</h3>
      <div
        className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${dragging ? 'border-primary bg-primary/5' : 'border-border/40 hover:border-primary/50'}`}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}>
        <p className="text-2xl mb-2">📁</p>
        <p className="text-sm text-muted-foreground mb-3">Drop files here or</p>
        <button onClick={() => fileInputRef.current?.click()}
          className="px-3 py-1.5 rounded-lg border border-border/50 text-sm text-foreground hover:bg-white/5 transition-colors">
          Browse Files
        </button>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">🔗 Save URL as shortcut</p>
        <input type="text" placeholder="https://..." value={urlInput} onChange={e => setUrlInput(e.target.value)}
          className="w-full px-3 py-1.5 rounded-lg border border-border/40 bg-background/50 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" />
        <div className="flex gap-2">
          <input type="text" placeholder="Title (optional)" value={urlTitle} onChange={e => setUrlTitle(e.target.value)}
            className="flex-1 px-3 py-1.5 rounded-lg border border-border/40 bg-background/50 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" />
          <button onClick={saveUrl} disabled={!urlInput.trim() || urlSaving}
            className="px-3 py-1.5 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-sm font-medium disabled:opacity-40 transition-colors">
            {urlSaving ? '…' : 'Save'}
          </button>
        </div>
      </div>
      {uploads.length > 0 && (
        <div className="space-y-1.5">
          {uploads.map((u, i) => (
            <div key={i} className="flex items-center gap-2">
              {u.status === 'uploading' && <span className="text-primary text-xs animate-spin inline-block">⟳</span>}
              {u.status === 'success' && <span className="text-green-400 text-xs">✓</span>}
              {u.status === 'error' && <span className="text-red-400 text-xs">✕</span>}
              <span className="flex-1 truncate text-xs text-foreground">{u.name}</span>
              {u.status === 'error' && <span className="text-red-400 text-xs truncate max-w-[160px]">{u.error}</span>}
              {u.status === 'success' && <span className="text-green-400 text-xs shrink-0">Uploaded ✓</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── WeeklyFilesPreview ────────────────────────────────────────────────────────
function WeeklyFilesPreview({ memberName, weekEnding }) {
  const [files, setFiles] = useState([])
  const [folder, setFolder] = useState('')
  const [sharedLink, setSharedLink] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lightbox, setLightbox] = useState(null)
  const [editMode, setEditMode] = useState(false)
  const [deleting, setDeleting] = useState(new Set())
  const [showUpload, setShowUpload] = useState(false)

  const fetchFiles = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/dropbox/weekly-files?weekEnding=${encodeURIComponent(weekEnding)}&memberName=${encodeURIComponent(memberName)}`)
      const d = await r.json()
      setFiles(d.files ?? [])
      setFolder(d.folder ?? '')
      setSharedLink(d.sharedLink ?? null)
    } catch { setFiles([]) }
    finally { setLoading(false) }
  }, [memberName, weekEnding])

  useEffect(() => { fetchFiles() }, [fetchFiles])

  // Files are in our own Dropbox account — use path_lower directly, no shared link needed
  const thumbUrl = (f) => `/api/dropbox/thumbnail?path=${encodeURIComponent(f.path_lower)}`
  const playUrl = (f) => `/api/dropbox/thumbnail?path=${encodeURIComponent(f.path_lower)}&mode=play`

  const deleteFile = async (file) => {
    setDeleting(prev => new Set(prev).add(file.path_lower))
    try {
      await fetch('/api/dropbox/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: file.path_lower }),
      })
      setFiles(prev => prev.filter(f => f.path_lower !== file.path_lower))
    } finally {
      setDeleting(prev => { const s = new Set(prev); s.delete(file.path_lower); return s })
    }
  }

  const media = files.filter(f => f.is_image || f.is_video)
  const lbIdx = lightbox ? media.findIndex(f => f.path_lower === lightbox.path_lower) : -1

  return (
    <>
      <div className="rounded-xl border border-border/40 bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
          <div>
            <span className="text-sm font-semibold text-foreground">Selected Files</span>
            {folder && <p className="text-[10px] text-muted-foreground mt-0.5">{folder}/{memberName}</p>}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowUpload(true)}
              className="flex items-center gap-1 text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 px-2 py-1 rounded transition-colors">
              + Upload
            </button>
            {files.length > 0 && (
              <button onClick={() => setEditMode(e => !e)}
                className={`text-xs transition-colors ${editMode ? 'text-primary font-medium' : 'text-muted-foreground hover:text-foreground'}`}>
                {editMode ? '✓ Done' : '✎ Edit'}
              </button>
            )}
            <button onClick={fetchFiles} disabled={loading}
              className="text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors">
              ⟳
            </button>
          </div>
        </div>
        <div className="p-4">
          {loading ? (
            <div className="flex gap-3">
              {[1,2,3,4].map(i => <div key={i} className="shrink-0 w-28 h-28 rounded-lg bg-white/5 animate-pulse" />)}
            </div>
          ) : files.length === 0 ? (
            <p className="text-sm text-muted-foreground/60 py-1">No files added yet for this week.</p>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {files.map(file => (
                <div key={file.path_lower} className="relative shrink-0 w-[160px] h-[160px]">
                  <button onClick={() => !editMode && setLightbox(file)}
                    className="relative w-full h-full rounded-lg overflow-hidden border border-border/30 bg-white/5 group">
                    <img src={thumbUrl(file)} alt={file.name} className="w-full h-full object-cover" />
                    {file.is_video && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-7 h-7 rounded-full bg-black/50 flex items-center justify-center">
                          <span className="text-white text-[10px]">▶</span>
                        </div>
                      </div>
                    )}
                    {!editMode && (
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-end pointer-events-none">
                        <p className="w-full text-white text-[10px] px-1.5 py-1 bg-black/50 translate-y-full group-hover:translate-y-0 transition-transform truncate">{file.name}</p>
                      </div>
                    )}
                  </button>
                  {editMode && (
                    <button onClick={() => deleteFile(file)} disabled={deleting.has(file.path_lower)}
                      className="absolute -top-1.5 -left-1.5 z-10 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center shadow-md hover:bg-red-600 transition-colors disabled:opacity-50 text-white text-[10px] font-bold">
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) { setShowUpload(false); fetchFiles() } }}>
          <div className="relative w-full max-w-md rounded-xl shadow-2xl bg-card border border-border/40">
            <button onClick={() => { setShowUpload(false); fetchFiles() }}
              className="absolute top-3 right-3 text-muted-foreground hover:text-foreground text-lg z-10">✕</button>
            <WorkSampleUpload memberName={memberName} weekEnding={weekEnding} />
          </div>
        </div>
      )}

      {lightbox && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90"
          onClick={e => { if (e.target === e.currentTarget) setLightbox(null) }}>
          <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl">✕</button>
          {lbIdx > 0 && <button onClick={() => setLightbox(media[lbIdx-1])} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-3xl p-2">‹</button>}
          {lbIdx < media.length - 1 && <button onClick={() => setLightbox(media[lbIdx+1])} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-3xl p-2">›</button>}
          <div className="max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-3">
            {lightbox.is_image
              ? <img src={thumbUrl(lightbox)} alt={lightbox.name} className="max-w-full max-h-[80vh] object-contain rounded-lg" />
              : <video src={playUrl(lightbox)} controls autoPlay className="max-w-full max-h-[80vh] rounded-lg" />}
            <p className="text-white/70 text-sm">{lightbox.name}</p>
          </div>
        </div>
      )}
    </>
  )
}

// -- Weekly Page
function WeeklyPage() {
  const [members, setMembers] = useState([])
  const [activeTab, setActiveTab] = useState(null)
  const [tasksByMember, setTasksByMember] = useState({})
  const [loading, setLoading] = useState(false)
  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date(); const sun = new Date(now)
    sun.setDate(now.getDate() - now.getDay()); return sun
  })
  const [selectedTask, setSelectedTask] = useState(null)

  function getWeekDates(sunday) {
    const lastSun = new Date(sunday); lastSun.setDate(sunday.getDate() - 7)
    const lastSat = new Date(lastSun); lastSat.setDate(lastSun.getDate() + 6)
    const thisSat = new Date(sunday); thisSat.setDate(sunday.getDate() + 6)
    const fmt = d => d.toISOString().slice(0, 10)
    return { weekStart: fmt(lastSun), weekEnd: fmt(lastSat), nextWeekStart: fmt(sunday), nextWeekEnd: fmt(thisSat) }
  }

  const dates = getWeekDates(selectedDate)

  const fetchTasks = (force = false) => {
    const validMembers = (members || []).filter(m => m.monday_user_id)
    if (validMembers.length === 0) return
    if (force) setLoading(true)
    const { weekStart, weekEnd, nextWeekStart, nextWeekEnd } = dates
    fetch('/api/monday/team-tasks?week_start=' + weekStart + '&week_end=' + weekEnd + '&next_week_start=' + nextWeekStart + '&next_week_end=' + nextWeekEnd + (force ? '&force=true' : ''))
      .then(r => r.json())
      .then(data => {
        const fromCache = data._meta?.fromCache === true
        const mapped = {}
        for (const m of validMembers)
          mapped[m.id] = { lastWeek: (data[m.monday_user_id] || {}).lastWeek || [], thisWeek: (data[m.monday_user_id] || {}).thisWeek || [], loaded: true }
        setTasksByMember(mapped)
        // If data came from cache, kick off a background refresh after a short delay
        if (fromCache) setTimeout(() => fetchTasks(true), 1500)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetch('/api/monday/settings').then(r => r.json()).then(d => {
      const mems = d.members || []
      setMembers(mems)
      if (mems.length > 0) setActiveTab(mems[0].id)
    }).catch(console.error)
  }, [])

  useEffect(() => { fetchTasks() }, [members.length, dates.weekStart])
  useBackgroundSync(() => fetchTasks())

  const activeMember = members.find(m => m.id === activeTab)
  const memberData = activeMember ? (tasksByMember[activeMember.id] || { lastWeek: [], thisWeek: [], loaded: false }) : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Weekly Report</h1>
          <p className="text-sm text-muted-foreground mt-1">Week of {dates.weekStart} to {dates.weekEnd}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { const d = new Date(selectedDate); d.setDate(d.getDate() - 7); setSelectedDate(d); setTasksByMember({}) }}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-muted-foreground transition-colors">Prev</button>
          <button onClick={() => { const d = new Date(selectedDate); d.setDate(d.getDate() + 7); setSelectedDate(d); setTasksByMember({}) }}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-muted-foreground transition-colors">Next</button>
        </div>
      </div>
      {members.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <p className="text-4xl">&#128202;</p>
          <p className="text-lg font-semibold text-foreground">Monday settings not configured</p>
          <p className="text-sm text-muted-foreground">Add board IDs and member IDs to load tasks.</p>
        </div>
      ) : (
        <>
          <div className="flex gap-1 border-b border-border/40 overflow-x-auto">
            {members.map(m => (
              <button key={m.id} onClick={() => setActiveTab(m.id)}
                className={"px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors " + (activeTab === m.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
                {m.name}
              </button>
            ))}
          </div>
          {activeMember && memberData && (
            <div className="space-y-6">
              <WeeklyFilesPreview memberName={activeMember.name} weekEnding={dates.weekEnd} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <WeeklyColumn title="Last Week" tasks={memberData.lastWeek} loaded={memberData.loaded} loading={loading}
                  onTaskClick={task => task.dropbox_link && setSelectedTask(task)}
                  onRefresh={() => { setLoading(true); fetchTasks(true) }} />
                <WeeklyColumn title="This Week" tasks={memberData.thisWeek} loaded={memberData.loaded} loading={loading}
                  onRefresh={() => { setLoading(true); fetchTasks(true) }} />
              </div>
            </div>
          )}
        </>
      )}
      {selectedTask && <DropboxPreviewModal task={selectedTask} weekEnding={dates.weekEnd} memberName={activeMember?.name ?? ''} onClose={() => setSelectedTask(null)} />}
    </div>
  )
}

function WeeklyColumn({ title, tasks, loaded, loading, onTaskClick, onRefresh }) {
  return (
    <div className="rounded-xl border border-border/40 bg-card overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        {onRefresh && (
          <button onClick={onRefresh} disabled={loading}
            title="Refresh tasks from Monday.com"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40">
            <svg className={"w-3 h-3 " + (loading ? 'animate-spin' : '')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        )}
      </div>
      <div className="flex-1 p-4">
        {loading && !loaded ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 rounded bg-white/5 animate-pulse" />)}</div>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground/60">No tasks for this period.</p>
        ) : (
          <div className="space-y-2">
            {tasks.map(task => (
              <div key={task.id} onClick={() => onTaskClick && onTaskClick(task)}
                className={"flex items-start gap-3 p-2.5 rounded-lg bg-white/[0.03] border border-border/20 transition-colors " + (onTaskClick && task.dropbox_link ? 'cursor-pointer hover:bg-white/[0.08] hover:border-primary/30' : 'hover:bg-white/[0.06]')}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm text-foreground font-medium leading-snug">{task.name}</p>
                    {task.dropbox_link && <span title="Has Dropbox files" className="text-[10px] text-blue-400 shrink-0">&#128230;</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {task.status && (
                      <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                        style={task.status_color ? { backgroundColor: task.status_color + '22', color: task.status_color, border: '1px solid ' + task.status_color + '55' } : { background: 'rgba(255,255,255,0.08)', color: '#9090a0' }}>
                        {task.status}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">{task.board_name}</span>
                    {task.timeline_end && <span className="text-xs text-muted-foreground">Due {task.timeline_end}</span>}
                  </div>
                </div>
                {task.monday_url && (
                  <a href={task.monday_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                    className="text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-0.5 text-xs">&#x2197;</a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// -- Status Report Page
function StatusReportPage() {
  const [activeTab, setActiveTab] = useState('boss')
  const [tasksByBoard, setTasksByBoard] = useState({})
  const [completedToday, setCompletedToday] = useState([])
  const [loading, setLoading] = useState(false)
  const [summaryText, setSummaryText] = useState('')
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(null)
  const [dailyCompleted, setDailyCompleted] = useState([])
  const [dailyInProgress, setDailyInProgress] = useState([])
  const [dailyDate, setDailyDate] = useState('')
  const [dailyLoading, setDailyLoading] = useState(false)
  const [dailySummaryText, setDailySummaryText] = useState('')
  const [dailyGenerating, setDailyGenerating] = useState(false)
  const [dailyCopied, setDailyCopied] = useState(false)
  const [dailyError, setDailyError] = useState(null)

  const fetchTasks = async (force = false) => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/status-report' + (force ? '?force=true' : ''))
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setTasksByBoard(data.tasksByBoard || {}); setCompletedToday(data.completedToday || [])
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const fetchDailyTasks = async (force = false) => {
    setDailyLoading(true); setDailyError(null)
    try {
      const res = await fetch('/api/status-report/daily' + (force ? '?force=true' : ''))
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setDailyCompleted(data.completedToday || []); setDailyInProgress(data.inProgress || []); setDailyDate(data.date || '')
    } catch (e) { setDailyError(e.message) }
    finally { setDailyLoading(false) }
  }

  useEffect(() => { fetchTasks() }, [])
  useEffect(() => {
    if (activeTab === 'daily' && dailyCompleted.length === 0 && dailyInProgress.length === 0 && !dailyLoading) fetchDailyTasks()
  }, [activeTab])

  const generateBoss = async () => {
    setGenerating(true); setSummaryText('')
    try {
      const res = await fetch('/api/status-report/summary', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasksByBoard, completedToday }),
      })
      if (!res.ok) throw new Error('Failed')
      const reader = res.body.getReader(); let text = ''
      while (true) { const { done, value } = await reader.read(); if (done) break; text += new TextDecoder().decode(value); setSummaryText(text) }
    } catch { setSummaryText('Error generating summary.') }
    finally { setGenerating(false) }
  }

  const generateDaily = async () => {
    setDailyGenerating(true); setDailySummaryText('')
    try {
      const res = await fetch('/api/status-report/daily-summary', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completedToday: dailyCompleted, inProgress: dailyInProgress, date: dailyDate }),
      })
      if (!res.ok) throw new Error('Failed')
      const reader = res.body.getReader(); let text = ''
      while (true) { const { done, value } = await reader.read(); if (done) break; text += new TextDecoder().decode(value); setDailySummaryText(text) }
    } catch { setDailySummaryText('Error generating summary.') }
    finally { setDailyGenerating(false) }
  }

  const allTasks = Object.values(tasksByBoard).flat()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Status Report</h1>
          <p className="text-sm text-muted-foreground mt-1">Live team status from Monday.com</p>
        </div>
        <button onClick={() => fetchTasks(true)} disabled={loading}
          className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-muted-foreground transition-colors disabled:opacity-50">
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      <div className="flex gap-1 border-b border-border/40">
        {['boss','daily'].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={"px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors capitalize " + (activeTab === tab ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {tab === 'boss' ? 'Boss Update' : 'Daily Update'}
          </button>
        ))}
      </div>

      {activeTab === 'boss' && (
        <div className="space-y-4">
          {error && <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={generateBoss} disabled={generating || loading || allTasks.length === 0}
              className="px-4 py-1.5 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-sm font-medium transition-colors disabled:opacity-40">
              {generating ? 'Generating...' : 'Generate Summary'}
            </button>
            {summaryText && <button onClick={() => { navigator.clipboard.writeText(summaryText); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
              className="px-3 py-1.5 rounded-lg bg-white/5 text-sm text-muted-foreground">
              {copied ? 'Copied' : 'Copy'}
            </button>}
          </div>
          {summaryText && (
            <div className="rounded-xl border border-border/40 bg-card p-5">
              <MarkdownText text={summaryText} />
            </div>
          )}
          {Object.entries(tasksByBoard).map(([board, tasks]) => (
            <div key={board} className="rounded-xl border border-border/40 bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">{board}</span>
                <span className="text-xs text-muted-foreground">{tasks.length} tasks</span>
              </div>
              <div className="divide-y divide-border/20">
                {tasks.map((task, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground font-medium truncate">{task.name}</p>
                      <p className="text-xs text-muted-foreground">{(task.assignee_names ?? []).join(', ') || ''}{task.timeline_end ? ' · Due ' + task.timeline_end : ''}</p>
                    </div>
                    {task.status && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0"
                        style={task.status_color ? { backgroundColor: task.status_color + '22', color: task.status_color, border: '1px solid ' + task.status_color + '55' } : { background: 'rgba(255,255,255,0.08)', color: '#9090a0' }}>
                        {task.status}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {loading && <div className="text-center py-12 text-muted-foreground text-sm">Loading tasks...</div>}
          {!loading && allTasks.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
              <p className="text-4xl">&#127919;</p>
              <p className="text-lg font-semibold text-foreground">No tasks found</p>
              <p className="text-sm text-muted-foreground">Configure board IDs and member IDs in settings.</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'daily' && (
        <div className="space-y-4">
          {dailyError && <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{dailyError}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={() => fetchDailyTasks(true)} disabled={dailyLoading}
              className="px-3 py-1.5 rounded-lg bg-white/5 text-sm text-muted-foreground">Refresh</button>
            <button onClick={generateDaily} disabled={dailyGenerating || dailyLoading}
              className="px-4 py-1.5 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-sm font-medium disabled:opacity-40">
              {dailyGenerating ? 'Generating...' : 'Generate Summary'}
            </button>
            {dailySummaryText && <button onClick={() => { navigator.clipboard.writeText(dailySummaryText); setDailyCopied(true); setTimeout(() => setDailyCopied(false), 2000) }}
              className="px-3 py-1.5 rounded-lg bg-white/5 text-sm text-muted-foreground">
              {dailyCopied ? 'Copied' : 'Copy'}
            </button>}
          </div>
          {dailySummaryText && (
            <div className="rounded-xl border border-border/40 bg-card p-5">
              <MarkdownText text={dailySummaryText} />
            </div>
          )}
          {dailyCompleted.length > 0 && (
            <div className="rounded-xl border border-border/40 bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border/30">
                <span className="text-sm font-semibold text-green-400">Completed Today ({dailyCompleted.length})</span>
              </div>
              <div className="divide-y divide-border/20">
                {dailyCompleted.map((t, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-green-400 text-xs shrink-0">&#x2713;</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.board_name}</p>
                    </div>
                    {t.status && <span className="text-xs px-2 py-0.5 rounded-full bg-white/8 text-muted-foreground shrink-0">{t.status}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {dailyInProgress.length > 0 && (
            <div className="rounded-xl border border-border/40 bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border/30">
                <span className="text-sm font-semibold text-foreground">In Progress ({dailyInProgress.length})</span>
              </div>
              <div className="divide-y divide-border/20">
                {dailyInProgress.map((t, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.board_name}</p>
                    </div>
                    {t.status && <span className="text-xs px-2 py-0.5 rounded-full bg-white/8 text-muted-foreground shrink-0">{t.status}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {dailyLoading && <div className="text-center py-12 text-muted-foreground text-sm">Loading...</div>}
        </div>
      )}
    </div>
  )
}

// -- Studio Page
function StudioPage() {
  const [members, setMembers] = useState([])
  const [tasksByMember, setTasksByMember] = useState({})
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState("overview")
  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date(); const sun = new Date(now)
    sun.setDate(now.getDate() - now.getDay()); return sun
  })
  const [teamSummary, setTeamSummary] = useState("")
  const [teamSummaryLoading, setTeamSummaryLoading] = useState(false)
  const [teamSummaryCopied, setTeamSummaryCopied] = useState(false)

  function getWeekDates(sunday) {
    const lastSun = new Date(sunday); lastSun.setDate(sunday.getDate() - 7)
    const lastSat = new Date(lastSun); lastSat.setDate(lastSun.getDate() + 6)
    const thisSat = new Date(sunday); thisSat.setDate(sunday.getDate() + 6)
    const fmt = d => d.toISOString().slice(0, 10)
    return { weekStart: fmt(lastSun), weekEnd: fmt(lastSat), nextWeekStart: fmt(sunday), nextWeekEnd: fmt(thisSat) }
  }
  const dates = getWeekDates(selectedDate)

  useEffect(() => {
    fetch("/api/monday/settings").then(r => r.json()).then(d => setMembers(d.members || [])).catch(console.error)
  }, [])

  useEffect(() => {
    const valid = (members || []).filter(m => m.monday_user_id)
    if (valid.length === 0) return
    setLoading(true)
    const { weekStart, weekEnd, nextWeekStart, nextWeekEnd } = dates
    const url = "/api/monday/team-tasks?week_start=" + weekStart + "&week_end=" + weekEnd + "&next_week_start=" + nextWeekStart + "&next_week_end=" + nextWeekEnd
    fetch(url).then(r => r.json()).then(data => {
      const mapped = {}
      for (const m of valid)
        mapped[m.id] = { lastWeek: (data[m.monday_user_id] || {}).lastWeek || [], thisWeek: (data[m.monday_user_id] || {}).thisWeek || [] }
      setTasksByMember(mapped)
    }).catch(console.error).finally(() => setLoading(false))
  }, [members.length, dates.weekStart])

  const generateTeamSummary = async () => {
    setTeamSummaryLoading(true); setTeamSummary('')
    try {
      const allTasks = members.filter(m => m.monday_user_id).flatMap(m => {
        const data = tasksByMember[m.id] || {}
        return (data.lastWeek || []).map(task => ({ memberName: m.name, isVideoTeam: !!m.is_video_team, task }))
      })
      const res = await fetch('/api/ai/team-summary', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: allTasks }),
      })
      if (!res.ok) throw new Error('Failed')
      const reader = res.body.getReader(); let text = ''
      while (true) { const { done, value } = await reader.read(); if (done) break; text += new TextDecoder().decode(value); setTeamSummary(text) }
    } catch { setTeamSummary('Error generating team summary.') }
    finally { setTeamSummaryLoading(false) }
  }

  const validMembers = members.filter(m => m.monday_user_id)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Studio Overview</h1>
          <p className="text-sm text-muted-foreground mt-1">Week of {dates.weekStart} to {dates.weekEnd}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { const d = new Date(selectedDate); d.setDate(d.getDate() - 7); setSelectedDate(d); setTasksByMember({}) }}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-muted-foreground transition-colors">Prev</button>
          <button onClick={() => { const d = new Date(selectedDate); d.setDate(d.getDate() + 7); setSelectedDate(d); setTasksByMember({}) }}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-muted-foreground transition-colors">Next</button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border/40">
        {['overview','highlights'].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={"px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors " + (activeTab === tab ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {tab === 'highlights' ? 'Team Highlights' : 'Studio Overview'}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-4">
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {[1,2,3].map(i => <div key={i} className="h-48 rounded-xl bg-white/5 animate-pulse" />)}
            </div>
          ) : validMembers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
              <p className="text-4xl">&#127912;</p>
              <p className="text-lg font-semibold text-foreground">No team members configured</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {validMembers.map(member => {
                const data = tasksByMember[member.id] || { lastWeek: [], thisWeek: [] }
                return <StudioMemberCard key={member.id} member={member} lastWeek={data.lastWeek} thisWeek={data.thisWeek} />
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'highlights' && (
        <div className="space-y-4">
          <div className="flex justify-end gap-2">
            <button onClick={generateTeamSummary} disabled={teamSummaryLoading || loading || validMembers.length === 0}
              className="px-4 py-1.5 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-sm font-medium disabled:opacity-40">
              {teamSummaryLoading ? 'Generating...' : 'Generate Team Highlights'}
            </button>
            {teamSummary && (
              <button onClick={() => { navigator.clipboard.writeText(teamSummary); setTeamSummaryCopied(true); setTimeout(() => setTeamSummaryCopied(false), 2000) }}
                className="px-3 py-1.5 rounded-lg bg-white/5 text-sm text-muted-foreground">
                {teamSummaryCopied ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>
          {teamSummary ? (
            <div className="rounded-xl border border-border/40 bg-card p-6 text-sm text-foreground leading-relaxed prose prose-invert prose-sm max-w-none">
              <ReactMarkdown>{teamSummary}</ReactMarkdown>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
              <p className="text-4xl">&#10024;</p>
              <p className="text-lg font-semibold text-foreground">Team Highlights</p>
              <p className="text-sm text-muted-foreground">AI summary of the whole team split by Video and Design teams.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StudioMemberCard({ member, lastWeek, thisWeek }) {
  const [activeSection, setActiveSection] = useState('last')
  const [lastSummary, setLastSummary] = useState('')
  const [nextSummary, setNextSummary] = useState('')
  const [generatingLast, setGeneratingLast] = useState(false)
  const [generatingNext, setGeneratingNext] = useState(false)
  const [copied, setCopied] = useState(false)
  const lastFetchedRef = useRef(null)
  const nextFetchedRef = useRef(null)

  const generateSection = async (section, taskList) => {
    const setGen = section === 'last' ? setGeneratingLast : setGeneratingNext
    const setSum = section === 'last' ? setLastSummary : setNextSummary
    setGen(true); setSum('')
    try {
      const res = await fetch('/api/ai/studio-summary', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberName: member.name, tasks: taskList, type: section === 'last' ? 'studio_last' : 'studio_next' }),
      })
      if (!res.ok) throw new Error('Failed')
      const reader = res.body.getReader(); let text = ''
      while (true) { const { done, value } = await reader.read(); if (done) break; text += new TextDecoder().decode(value); setSum(text) }
    } catch { setSum('Error generating summary.') }
    finally { setGen(false) }
  }

  const lastKey = `${member.id}-last-${lastWeek.length}`
  const nextKey = `${member.id}-next-${thisWeek.length}`

  useEffect(() => {
    if (lastWeek.length > 0 && lastFetchedRef.current !== lastKey) {
      lastFetchedRef.current = lastKey
      generateSection('last', lastWeek)
    }
  }, [lastWeek.length, lastKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (thisWeek.length > 0 && nextFetchedRef.current !== nextKey) {
      nextFetchedRef.current = nextKey
      generateSection('next', thisWeek)
    }
  }, [thisWeek.length, nextKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const tasks = activeSection === 'last' ? lastWeek : thisWeek
  const summary = activeSection === 'last' ? lastSummary : nextSummary
  const generating = activeSection === 'last' ? generatingLast : generatingNext

  return (
    <div className="rounded-xl border border-border/40 bg-card flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/30">
        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold text-primary shrink-0">
          {member.name[0] ? member.name[0].toUpperCase() : '?'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{member.name}</p>
          <p className="text-[10px] text-muted-foreground">{member.is_video_team ? 'Video' : 'Design'}</p>
        </div>
        <div className="flex gap-1">
          {['last','next'].map(s => (
            <button key={s} onClick={() => { setActiveSection(s); setCopied(false) }}
              className={'text-[10px] px-2 py-0.5 rounded font-medium transition-colors ' + (activeSection === s ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground')}>
              {s === 'last' ? 'Last' : 'This'}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 p-3 min-h-[120px] overflow-y-auto">
        {generating && !summary ? (
          <div className="space-y-1.5">{[1,2,3].map(i => <div key={i} className="h-3 rounded bg-white/5 animate-pulse" />)}</div>
        ) : summary ? (
          <MarkdownText text={summary} />
        ) : tasks.length === 0 ? (
          <p className="text-xs text-muted-foreground/50 pt-2">No tasks this period.</p>
        ) : (
          <div className="space-y-1.5">
            {tasks.slice(0, 5).map((t, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-primary/60 text-[10px] pt-0.5 shrink-0">&#x2022;</span>
                <p className="text-xs text-foreground/80 leading-snug">{t.name}</p>
              </div>
            ))}
            {tasks.length > 5 && <p className="text-[10px] text-muted-foreground">+{tasks.length - 5} more</p>}
          </div>
        )}
      </div>
      <div className="px-3 pb-3 flex gap-1.5">
        <button onClick={() => generateSection(activeSection, tasks)} disabled={generating || tasks.length === 0}
          className="flex-1 text-xs py-1.5 rounded-lg bg-primary/15 hover:bg-primary/25 text-primary font-medium disabled:opacity-40 transition-colors">
          {generating ? 'Generating\u2026' : summary ? '\u27f3 Regen' : 'AI Summary'}
        </button>
        {summary && (
          <button onClick={() => { navigator.clipboard.writeText(summary); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground">
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
    </div>
  )
}

