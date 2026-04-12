import { useState, useEffect, useRef } from 'react'

// ── Clarification Modal ──────────────────────────────────────────────────────
function ClarifyModal({ clarifications, onSubmit, onSkipAll }) {
  const [answers, setAnswers] = useState(() =>
    Object.fromEntries(clarifications.map(c => [c.taskId, '']))
  )

  const setAnswer = (taskId, val) =>
    setAnswers(prev => ({ ...prev, [taskId]: val }))

  const handleSubmit = () => {
    const result = clarifications.map(c => ({
      ...c,
      answer: answers[c.taskId] || '',
    }))
    onSubmit(result)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onSkipAll} />
      <div className="relative bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[80vh]">
        <div className="px-6 py-5 border-b border-slate-700 shrink-0">
          <p className="text-[10px] text-amber-400 uppercase tracking-widest font-bold mb-1">Additional Context Needed</p>
          <h2 className="text-base font-semibold text-white leading-snug">
            Claude needs a bit more info for {clarifications.length} task{clarifications.length !== 1 ? 's' : ''}
          </h2>
          <p className="text-xs text-slate-400 mt-1">Answer what you can — skip anything you'd rather leave out.</p>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {clarifications.map((c, i) => (
            <div key={c.taskId} className="space-y-2">
              <div className="flex items-start gap-2">
                <span className="text-[10px] text-slate-500 mt-0.5 shrink-0">#{i + 1}</span>
                <div>
                  <p className="text-[11px] font-semibold text-slate-300 leading-snug">{c.taskText}</p>
                  <p className="text-sm text-amber-300 mt-1 leading-snug">{c.question}</p>
                </div>
              </div>
              <div className="flex gap-2 pl-4">
                <textarea
                  value={answers[c.taskId]}
                  onChange={e => setAnswer(c.taskId, e.target.value)}
                  placeholder="Your answer… (leave blank to skip)"
                  rows={2}
                  className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-primary/60 resize-none"
                />
                <button
                  onClick={() => setAnswer(c.taskId, '')}
                  className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors shrink-0 mt-2"
                  title="Skip this question"
                >Skip</button>
              </div>
            </div>
          ))}
        </div>
        <div className="px-6 py-4 border-t border-slate-700 flex gap-3 shrink-0">
          <button onClick={onSkipAll}
            className="flex-1 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 text-sm font-medium transition-colors">
            Skip All
          </button>
          <button onClick={handleSubmit}
            className="flex-1 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold transition-colors">
            Generate Brief
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Task card (shared between In Progress + Completed) ───────────────────────
function TaskCard({ task, selected, onToggle, onDelete }) {
  const priority = (task.priority || 'medium').toLowerCase()
  const priorityStyle = {
    high:     'bg-red-500/15 text-red-400 border-red-500/30',
    critical: 'bg-red-500/15 text-red-400 border-red-500/30',
    medium:   'bg-amber-500/15 text-amber-400 border-amber-500/30',
    low:      'bg-slate-500/15 text-slate-400 border-slate-400/30',
  }[priority] || 'bg-amber-500/15 text-amber-400 border-amber-500/30'
  const isIP = task.status === 'in_progress'
  return (
    <div className={`group flex items-start gap-3 p-2.5 rounded-lg border transition-colors ${
      selected
        ? isIP ? 'bg-amber-500/5 border-amber-500/40' : 'bg-primary/5 border-primary/40'
        : 'bg-card border-border/30 hover:border-border/60'
    }`}>
      <div className="pt-0.5 cursor-pointer" onClick={onToggle}>
        <input type="checkbox" checked={selected} onChange={onToggle}
          className="w-3.5 h-3.5 rounded border-border/50 text-primary focus:ring-0 focus:ring-offset-0 bg-background/50 cursor-pointer" />
      </div>
      <div className="flex-1 min-w-0 cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-2 flex-wrap">
          <p className={`text-[13px] font-medium leading-snug ${selected ? 'text-foreground' : 'text-foreground/80'}`}>{task.text}</p>
          <span className={`text-[10px] px-1.5 py-0 rounded-full border font-semibold shrink-0 ${priorityStyle}`}>
            {priority.charAt(0).toUpperCase() + priority.slice(1)}
          </span>
        </div>
        {task.context && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{task.context}</p>}
      </div>
      <button
        onClick={e => { e.stopPropagation(); onDelete(task.id) }}
        className="opacity-0 group-hover:opacity-100 mt-0.5 shrink-0 p-0.5 rounded text-muted-foreground/40 hover:text-red-400 hover:bg-red-500/10 transition-all"
        title="Delete task">
        ✕
      </button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function StandupPage() {
  const [doneTasks, setDoneTasks] = useState([])
  const [inProgressTasks, setInProgressTasks] = useState([])
  const [openTasks, setOpenTasks] = useState([])
  const [selectedTasks, setSelectedTasks] = useState(new Set())
  const [loading, setLoading] = useState(true)

  // flow: 'idle' | 'clarifying' | 'generating' | 'done'
  const [flow, setFlow] = useState('idle')
  const [clarifications, setClarifications] = useState([])
  const [briefText, setBriefText] = useState('')
  const briefRef = useRef(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/follow-ups?status=finished').then(r => r.json()),
      fetch('/api/follow-ups?status=in_progress').then(r => r.json()),
      fetch('/api/follow-ups?status=open').then(r => r.json()),
    ]).then(([finished, inProgress, open]) => {
      setDoneTasks(Array.isArray(finished) ? finished : [])
      setInProgressTasks(Array.isArray(inProgress) ? inProgress : [])
      setOpenTasks(Array.isArray(open) ? open : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const allTasks = [...openTasks, ...inProgressTasks, ...doneTasks]

  const toggleTask = (id) => {
    const next = new Set(selectedTasks)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedTasks(next)
  }

  const deleteTask = async (id) => {
    await fetch(`/api/follow-ups/${id}`, { method: 'DELETE' }).catch(() => {})
    setDoneTasks(prev => prev.filter(t => t.id !== id))
    setInProgressTasks(prev => prev.filter(t => t.id !== id))
    setOpenTasks(prev => prev.filter(t => t.id !== id))
    setSelectedTasks(prev => { const next = new Set(prev); next.delete(id); return next })
  }

  // Step 1: user clicks Generate → ask Claude which tasks need clarification
  const handleGenerateClick = async () => {
    if (selectedTasks.size === 0) return
    setFlow('clarifying')
    setClarifications([])
    const selected = allTasks.filter(t => selectedTasks.has(t.id))
    try {
      const res = await fetch('/api/standup/clarify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: selected }),
      })
      const data = await res.json()
      const needed = data.clarifications || []
      if (needed.length === 0) {
        // All clear — go straight to generating
        await generateBrief([])
      } else {
        setClarifications(needed)
        setFlow('clarifying')
      }
    } catch {
      await generateBrief([])
    }
  }

  // Step 2: generate the brief (with or without answers)
  const generateBrief = async (answeredClarifications) => {
    setFlow('generating')
    setBriefText('')
    const selected = allTasks.filter(t => selectedTasks.has(t.id))
    try {
      const res = await fetch('/api/status-report/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: selected, clarifications: answeredClarifications }),
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
          setBriefText(text)
        }
      }
      setFlow('done')
      // Ensure blank lines between bullets regardless of Claude's formatting
      setBriefText(t => t.replace(/\n(-\s)/g, '\n\n$1').trimStart())
    } catch (e) {
      console.error(e)
      setFlow('idle')
    }
  }

  // Group finished tasks by day
  const groupByDay = () => {
    const groups = {}
    doneTasks.forEach(task => {
      const dateStr2 = task.resolved_at || task.created_at
      if (!dateStr2) return
      const date = new Date(dateStr2)
      const now = new Date()
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
  const dayKeys = Object.keys(groups)

  if (loading) return <div className="text-center py-12 text-muted-foreground">Loading tasks...</div>

  const isGenerating = flow === 'generating'
  const isDone = flow === 'done'

  return (
    <>
      {flow === 'clarifying' && clarifications.length > 0 && (
        <ClarifyModal
          clarifications={clarifications}
          onSubmit={(answered) => generateBrief(answered)}
          onSkipAll={() => generateBrief([])}
        />
      )}

      <div className="flex h-[calc(100vh-6rem)] gap-6">
        {/* Left: task selector */}
        <div className="flex-1 flex flex-col bg-card/30 rounded-xl border border-border/40 overflow-hidden">
          <div className="px-6 py-4 border-b border-border/30 bg-background/50 backdrop-blur-sm flex items-center justify-between shrink-0">
            <h2 className="text-lg font-bold text-foreground">Tasks</h2>
            <span className="text-sm text-muted-foreground">{selectedTasks.size} selected</span>
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
            {openTasks.length === 0 && inProgressTasks.length === 0 && dayKeys.length === 0 && (
              <div className="text-muted-foreground/60 text-sm text-center mt-12">No tasks found.</div>
            )}

            {openTasks.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-400 sticky top-0 bg-card py-1 z-10 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-slate-400 inline-block" />
                  To Do
                </h3>
                <div className="space-y-2">
                  {openTasks.map(task => (
                    <TaskCard key={task.id} task={task} selected={selectedTasks.has(task.id)} onToggle={() => toggleTask(task.id)} onDelete={deleteTask} />
                  ))}
                </div>
              </div>
            )}

            {inProgressTasks.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-amber-400 sticky top-0 bg-card py-1 z-10 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse inline-block" />
                  In Progress
                </h3>
                <div className="space-y-2">
                  {inProgressTasks.map(task => (
                    <TaskCard key={task.id} task={task} selected={selectedTasks.has(task.id)} onToggle={() => toggleTask(task.id)} onDelete={deleteTask} />
                  ))}
                </div>
              </div>
            )}

            {dayKeys.map(day => (
              <div key={day} className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground sticky top-0 bg-card py-1 z-10">{day}</h3>
                <div className="space-y-2">
                  {groups[day].map(task => (
                    <TaskCard key={task.id} task={task} selected={selectedTasks.has(task.id)} onToggle={() => toggleTask(task.id)} onDelete={deleteTask} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: brief generator */}
        <div className="w-[55%] shrink-0 flex flex-col bg-card/30 rounded-xl border border-border/40 overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-border/30 bg-background/50 backdrop-blur-sm flex items-center justify-between shrink-0">
            <h2 className="text-lg font-bold text-foreground">Stand-up Brief</h2>
            {isDone && (
              <button onClick={() => navigator.clipboard.writeText(briefText)}
                className="text-xs text-primary hover:text-primary/80 transition-colors">
                Copy to Clipboard
              </button>
            )}
          </div>
          <div className="p-6 flex flex-col gap-5 flex-1 overflow-auto">
            {!isDone && !isGenerating && (
              <p className="text-sm text-muted-foreground leading-relaxed">
                Select tasks from the left, then generate a brief. Claude will ask for extra detail on tasks that need it.
              </p>
            )}
            <button
              onClick={handleGenerateClick}
              disabled={selectedTasks.size === 0 || isGenerating || flow === 'clarifying'}
              className="w-full py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-sm transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2">
              {isGenerating
                ? <span className="animate-pulse">Generating Brief…</span>
                : flow === 'clarifying' && clarifications.length > 0
                  ? <span className="animate-pulse">Checking tasks…</span>
                  : `✨ Generate Brief (${selectedTasks.size} tasks)`}
            </button>

            {(briefText || isGenerating || true) && (
              <div className="flex-1 flex flex-col gap-2">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                  {isGenerating ? 'Writing…' : 'Your brief — write or edit freely'}
                </p>
                <textarea
                  ref={briefRef}
                  value={briefText}
                  onChange={e => setBriefText(e.target.value)}
                  readOnly={isGenerating}
                  className="flex-1 min-h-[200px] bg-background/50 border border-border/50 px-4 py-3 rounded-xl text-[14px] text-foreground leading-relaxed font-sans focus:outline-none focus:border-primary/40 resize-none custom-scrollbar"
                  placeholder="Type your own brief, or generate one with AI above…"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
