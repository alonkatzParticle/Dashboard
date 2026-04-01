import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'

function TaskDetailModal({ task, onClose }) {
  const rawMessages = (() => {
    if (!task.source_messages) return []
    try { return JSON.parse(task.source_messages) } catch { return [] }
  })()

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
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-700 shrink-0 bg-slate-800">
          <div className="flex-1 min-w-0 pr-4">
            <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-1.5 font-semibold">Task Detail</p>
            <h2 className="text-base font-semibold text-white leading-snug">{task.text}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1 -mr-1 -mt-1 text-lg leading-none">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-slate-900">
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
          {messages.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Source Messages ({messages.length})</p>
              <div className="space-y-2">
                {messages.map((msg, i) => (
                  <div key={i} className="p-3 rounded-lg bg-slate-800 border border-slate-600">
                    {msg.sender && <p className="text-[11px] font-bold text-violet-400 mb-1.5">@{msg.sender}</p>}
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

export default function TasksPage() {
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
      const [activeRes, finishedRes, candidateRes] = await Promise.all([
        fetch('/api/follow-ups?status=open'),
        fetch('/api/follow-ups?status=finished'),
        fetch('/api/follow-ups?status=candidate')
      ])
      const [active, finished, cands] = await Promise.all([
        activeRes.json(), finishedRes.json(), candidateRes.json()
      ])
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

  const PRIORITIES = ['low', 'medium', 'high', 'critical']
  const updatePriority = async (taskId, currentPriority) => {
    const next = PRIORITIES[(PRIORITIES.indexOf(currentPriority) + 1) % PRIORITIES.length]
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, priority: next } : t))
    await fetch(`/api/follow-ups/${taskId}/priority`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority: next }),
    }).catch(() => {})
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

      {candidates.length > 0 && (() => {
        const newTasks = candidates.filter(c => !c.pre_resolved)
        const resolvedTasks = candidates.filter(c => c.pre_resolved)
        return (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 shrink-0">
            <button onClick={() => setCandidatesOpen(o => !o)} className="w-full px-5 py-3 flex items-center gap-2 text-left">
              <span className="text-amber-400 text-sm font-semibold">⚡ {candidates.length} AI Suggestions</span>
              <span className="text-xs text-muted-foreground flex-1">Review before adding to your board</span>
              <span className="text-muted-foreground text-xs">{candidatesOpen ? '▲' : '▼'}</span>
            </button>
            {candidatesOpen && (
              <div className="border-t border-amber-500/20 max-h-[45vh] overflow-y-auto">
                {/* ── New Tasks section ── */}
                {newTasks.length > 0 && (
                  <div>
                    <div className="px-5 py-2 bg-amber-500/10 flex items-center gap-2">
                      <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider">⚡ New Tasks</span>
                      <span className="text-[10px] text-muted-foreground">— approve to add to your board</span>
                      <span className="ml-auto text-[10px] text-amber-400/60">{newTasks.length}</span>
                    </div>
                    <div className="divide-y divide-border/20">
                      {newTasks.map(c => {
                        const ts = c.created_at ? new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
                        return (
                          <div key={c.id} className="px-5 py-3 flex items-start gap-4">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-foreground font-medium">{c.text}</p>
                              {c.context && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{c.context}</p>}
                              <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                                {c.channel_name && c.channel_name.split(',').map((p, i) => (
                                  <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-border/40 text-muted-foreground">{p.trim()}</span>
                                ))}
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-primary">✦ Claude</span>
                                {ts && <span className="text-[10px] text-muted-foreground/40 ml-auto">{ts}</span>}
                              </div>
                            </div>
                            <div className="flex gap-2 shrink-0">
                              <button onClick={() => confirmCandidate(c.id)} className="px-3 py-1 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-xs font-semibold transition-colors">✓ Add to Tasks</button>
                              <button onClick={() => dismissCandidate(c.id)} className="px-3 py-1 rounded-lg bg-white/5 hover:bg-red-500/10 text-muted-foreground hover:text-red-400 text-xs font-semibold transition-colors">✕</button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
                {/* ── Already Resolved section ── */}
                {resolvedTasks.length > 0 && (
                  <div className={newTasks.length > 0 ? 'border-t border-border/30' : ''}>
                    <div className="px-5 py-2 bg-green-500/10 flex items-center gap-2">
                      <span className="text-[11px] font-bold text-green-400 uppercase tracking-wider">✓ Already Resolved</span>
                      <span className="text-[10px] text-muted-foreground">— Claude detected these are done</span>
                      <span className="ml-auto text-[10px] text-green-400/60">{resolvedTasks.length}</span>
                    </div>
                    <div className="divide-y divide-border/20">
                      {resolvedTasks.map(c => {
                        const ts = c.created_at ? new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
                        return (
                          <div key={c.id} className="px-5 py-3 flex items-start gap-4 bg-green-500/[0.03]">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-foreground font-medium">{c.text}</p>
                              {c.context && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{c.context}</p>}
                              <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                                {c.channel_name && c.channel_name.split(',').map((p, i) => (
                                  <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-border/40 text-muted-foreground">{p.trim()}</span>
                                ))}
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 border border-green-500/30 text-green-400">✦ Claude detected</span>
                                {ts && <span className="text-[10px] text-muted-foreground/40 ml-auto">{ts}</span>}
                              </div>
                            </div>
                            <div className="flex gap-2 shrink-0">
                              <button onClick={() => confirmCandidate(c.id)} className="px-3 py-1 rounded-lg bg-green-500/20 hover:bg-green-500/30 text-green-400 text-xs font-semibold transition-colors">✓ Mark as Done</button>
                              <button onClick={() => dismissCandidate(c.id)} className="px-3 py-1 rounded-lg bg-white/5 hover:bg-red-500/10 text-muted-foreground hover:text-red-400 text-xs font-semibold transition-colors">✕</button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })()}


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
                      {[['low','Low'],['medium','Medium'],['high','High'],['critical','Critical']].map(([p, label]) => (
                        <button key={p} onClick={() => setNewPriority(p)}
                          className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold transition-colors ${
                            newPriority === p
                              ? { low:'bg-slate-100 text-slate-600 border-slate-300', medium:'bg-amber-100 text-amber-700 border-amber-300', high:'bg-red-100 text-red-600 border-red-300', critical:'bg-red-200 text-red-700 border-red-400' }[p]
                              : 'bg-transparent text-muted-foreground border-border hover:border-foreground/30'
                          }`}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-1">
                      {[['task','Task'],['followup','Follow-up'],['decision','Decision']].map(([val, label]) => (
                        <button key={val} onClick={() => setNewType(val)}
                          className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold transition-colors ${
                            newType === val
                              ? { task:'bg-blue-100 text-blue-700 border-blue-300', followup:'bg-purple-100 text-purple-700 border-purple-300', decision:'bg-orange-100 text-orange-700 border-orange-300' }[val]
                              : 'bg-transparent text-muted-foreground border-border hover:border-foreground/30'
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
                    className={`group p-3.5 rounded-xl bg-card border border-border/50 cursor-pointer hover:border-primary/40 transition-all flex flex-col gap-2 priority-${priority} ${
                      dragId === task.id ? 'opacity-40 scale-[0.98]' : 'hover:shadow-md'
                    }`}>
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-[14px] text-foreground font-medium leading-snug flex-1 min-w-0">{task.text}</p>
                      <button onClick={e => { e.stopPropagation(); deleteTask(task.id) }} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-400 p-1 -mr-1 -mt-1 shrink-0">
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                      </button>
                    </div>
                    {task.context && <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">{task.context}</p>}
                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                      <button
                        onClick={e => { e.stopPropagation(); updatePriority(task.id, priority) }}
                        title="Click to change priority"
                        className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold transition-opacity hover:opacity-70 ${priorityStyle}`}>
                        {priority.charAt(0).toUpperCase() + priority.slice(1)}
                      </button>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${typeStyle}`}>{typeLabel}</span>
                      {people.map((p, i) => (
                        <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-border/40 text-muted-foreground">{p}</span>
                      ))}
                      {task.source === 'claude' && <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center gap-1">✦ Claude</span>}
                      {task.resolved_by === 'claude' && <span className="text-[10px] px-2 py-0.5 rounded-full border font-semibold bg-teal-500/15 text-teal-400 border-teal-500/30">✦ Auto-resolved</span>}
                      {task.resolved_by === 'user' && <span className="text-[10px] px-2 py-0.5 rounded-full border font-semibold bg-green-500/15 text-green-400 border-green-500/30">✓ Resolved by you</span>}
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
