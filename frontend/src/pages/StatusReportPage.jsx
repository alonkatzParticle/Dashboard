import { useState, useEffect } from 'react'
import { MarkdownText } from '../lib/utils'

export default function StatusReportPage() {
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
