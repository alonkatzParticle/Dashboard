import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import { MarkdownText, useBackgroundSync } from '../lib/utils'

// ── StudioMemberCard ──────────────────────────────────────────────────────────
function StudioMemberCard({ member, lastWeek, thisWeek, weekKey, onToggleTeam }) {
  const [activeSection, setActiveSection] = useState('last')
  const [lastSummary, setLastSummary] = useState('')
  const [nextSummary, setNextSummary] = useState('')
  const [generatingLast, setGeneratingLast] = useState(false)
  const [generatingNext, setGeneratingNext] = useState(false)
  const [copied, setCopied] = useState(false)
  const summaryCache = useRef({})

  const generateSection = async (section, taskList) => {
    const cacheKey = `${member.id}:${weekKey}:${section}`
    if (summaryCache.current[cacheKey]) {
      section === 'last' ? setLastSummary(summaryCache.current[cacheKey]) : setNextSummary(summaryCache.current[cacheKey])
      return
    }
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
      summaryCache.current[cacheKey] = text
    } catch { setSum('Error generating summary.') }
    finally { setGen(false) }
  }

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
          <button
            onClick={() => onToggleTeam && onToggleTeam(member)}
            title="Click to toggle team"
            className={'text-[10px] px-1.5 py-0.5 rounded font-medium transition-colors ' + (member.is_video_team ? 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/25' : 'bg-purple-500/15 text-purple-400 hover:bg-purple-500/25')}>
            {member.is_video_team ? 'Video' : 'Design'}
          </button>
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
          {generating ? 'Generating…' : summary ? '⟳ Regen' : 'AI Summary'}
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

// ── StudioPage ────────────────────────────────────────────────────────────────
export default function StudioPage() {
  const [members, setMembers] = useState([])
  const [tasksByMember, setTasksByMember] = useState({})
  const [loading, setLoading] = useState(false)
  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date(); const sun = new Date(now)
    sun.setDate(now.getDate() - now.getDay()); sun.setHours(0,0,0,0); return sun
  })
  const [highlightsView, setHighlightsView] = useState('last') // 'last' | 'this'
  const [teamSummaryLast, setTeamSummaryLast] = useState('')
  const [teamSummaryThis, setTeamSummaryThis] = useState('')
  const [teamSummaryLoading, setTeamSummaryLoading] = useState(false)
  const [teamSummaryCopied, setTeamSummaryCopied] = useState(false)

  function getWeekDates(sunday) {
    const lastSun = new Date(sunday); lastSun.setDate(sunday.getDate() - 7)
    const lastSat = new Date(lastSun); lastSat.setDate(lastSun.getDate() + 6)
    const thisSat = new Date(sunday); thisSat.setDate(sunday.getDate() + 6)
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
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

  useBackgroundSync(() => {
    const valid = (members || []).filter(m => m.monday_user_id)
    if (valid.length === 0) return
    const { weekStart, weekEnd, nextWeekStart, nextWeekEnd } = dates
    const url = "/api/monday/team-tasks?week_start=" + weekStart + "&week_end=" + weekEnd + "&next_week_start=" + nextWeekStart + "&next_week_end=" + nextWeekEnd
    fetch(url).then(r => r.json()).then(data => {
      const mapped = {}
      for (const m of valid)
        mapped[m.id] = { lastWeek: (data[m.monday_user_id] || {}).lastWeek || [], thisWeek: (data[m.monday_user_id] || {}).thisWeek || [] }
      setTasksByMember(mapped)
    }).catch(console.error)
  })

  // Persist both summaries per week
  const keyLast = `studio_summary_last_${dates.nextWeekStart}`
  const keyThis = `studio_summary_this_${dates.nextWeekStart}`
  useEffect(() => {
    setTeamSummaryLast(localStorage.getItem(keyLast) || '')
    setTeamSummaryThis(localStorage.getItem(keyThis) || '')
  }, [keyLast, keyThis])
  useEffect(() => { if (teamSummaryLast && !teamSummaryLoading) localStorage.setItem(keyLast, teamSummaryLast) }, [teamSummaryLast, teamSummaryLoading, keyLast])
  useEffect(() => { if (teamSummaryThis && !teamSummaryLoading) localStorage.setItem(keyThis, teamSummaryThis) }, [teamSummaryThis, teamSummaryLoading, keyThis])

  const teamSummary = highlightsView === 'last' ? teamSummaryLast : teamSummaryThis
  const setTeamSummary = highlightsView === 'last' ? setTeamSummaryLast : setTeamSummaryThis

  const generateTeamSummary = async () => {
    setTeamSummaryLoading(true); setTeamSummary('')
    try {
      const validM = members.filter(m => m.monday_user_id)
      const weekType = highlightsView === 'last' ? 'lastWeek' : 'thisWeek'
      const tasks = validM.flatMap(m => {
        const data = tasksByMember[m.id] || {}
        return (data[weekType] || []).map(task => ({ memberName: m.name, isVideoTeam: !!m.is_video_team, task }))
      })
      const body = highlightsView === 'last' ? { lastWeekTasks: tasks, thisWeekTasks: [] } : { lastWeekTasks: [], thisWeekTasks: tasks }
      const res = await fetch('/api/ai/team-summary', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Failed')
      const reader = res.body.getReader(); let text = ''
      while (true) { const { done, value } = await reader.read(); if (done) break; text += new TextDecoder().decode(value); setTeamSummary(text) }
    } catch { setTeamSummary('Error generating team summary.') }
    finally { setTeamSummaryLoading(false) }
  }

  const validMembers = members.filter(m => m.monday_user_id)

  const isCurrentWeek = (() => {
    const now = new Date(); const day = now.getDay()
    const thisSun = new Date(now); thisSun.setDate(now.getDate() - day); thisSun.setHours(0,0,0,0)
    return selectedDate.getTime() === thisSun.getTime()
  })()
  const goToPrevWeek = () => { const d = new Date(selectedDate); d.setDate(d.getDate() - 7); setSelectedDate(d); setTasksByMember({}) }
  const goToNextWeek = () => { const d = new Date(selectedDate); d.setDate(d.getDate() + 7); setSelectedDate(d); setTasksByMember({}) }
  const goToThisWeek = () => { const now = new Date(); const day = now.getDay(); const sun = new Date(now); sun.setDate(now.getDate() - day); sun.setHours(0,0,0,0); setSelectedDate(sun); setTasksByMember({}) }
  const fmtLabel = (s) => { const d = new Date(s + 'T00:00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
  const fmtLabelYear = (s) => { const d = new Date(s + 'T00:00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold text-foreground">Studio Overview</h1>
        <div className="flex items-center gap-3 bg-white/5 border border-border/30 rounded-xl px-4 py-2.5">
          <svg className="w-4 h-4 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          <span className="text-xs text-muted-foreground font-medium">Week:</span>
          <div className="flex items-center gap-2">
            <button onClick={goToPrevWeek}
              className="w-7 h-7 flex items-center justify-center rounded-lg border border-border/40 bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>
            </button>
            <span className="text-sm font-semibold text-foreground min-w-[180px] text-center">
              {fmtLabel(dates.nextWeekStart)} &ndash; {fmtLabelYear(dates.nextWeekEnd)}
            </span>
            <button onClick={goToNextWeek}
              className="w-7 h-7 flex items-center justify-center rounded-lg border border-border/40 bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
            </button>
          </div>
          {!isCurrentWeek && (
            <button onClick={goToThisWeek}
              className="text-xs text-primary hover:text-primary/80 font-medium px-2 py-1 rounded-lg hover:bg-primary/10 transition-colors">
              This Week
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border/40 bg-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">✦ Team Highlights</p>
            <p className="text-xs text-muted-foreground mt-0.5">AI summary of the whole team split by Video and Design</p>
          </div>
          <div className="flex gap-2 items-center">
            <div className="flex gap-0.5 bg-white/5 rounded-lg p-0.5">
              {['last', 'this'].map(v => (
                <button key={v} onClick={() => { setHighlightsView(v); setTeamSummaryCopied(false) }}
                  className={'text-[11px] px-2.5 py-1 rounded-md font-medium transition-colors ' + (highlightsView === v ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground')}>
                  {v === 'last' ? 'Last' : 'This'}
                </button>
              ))}
            </div>
            {teamSummary && (
              <button onClick={() => { navigator.clipboard.writeText(teamSummary); setTeamSummaryCopied(true); setTimeout(() => setTeamSummaryCopied(false), 2000) }}
                className="px-3 py-1.5 rounded-lg bg-white/5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                {teamSummaryCopied ? '✓ Copied' : 'Copy'}
              </button>
            )}
            <button onClick={generateTeamSummary} disabled={teamSummaryLoading || loading || validMembers.length === 0}
              className="px-4 py-1.5 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-xs font-semibold disabled:opacity-40 transition-colors">
              {teamSummaryLoading ? 'Generating...' : teamSummary ? '↻ Regenerate' : 'Generate'}
            </button>
          </div>
        </div>
        {teamSummary && (
          <div className="text-sm text-foreground font-sans whitespace-pre-wrap leading-relaxed border-t border-border/30 pt-3">
            {teamSummary.split('\n').map((line, i) => (
              <span key={i}>
                {line.split(/(\*[^*\n]+\*)/g).map((part, j) =>
                  part.startsWith('*') && part.endsWith('*') && part.length > 2
                    ? <strong key={j}>{part.slice(1, -1)}</strong>
                    : part
                )}
                {'\n'}
              </span>
            ))}
          </div>
        )}
      </div>

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
            return <StudioMemberCard key={member.id} member={member} lastWeek={data.lastWeek} thisWeek={data.thisWeek} weekKey={dates.weekStart} onToggleTeam={async (m) => {
              const updated = { ...m, is_video_team: m.is_video_team ? 0 : 1 }
              await fetch('/api/monday/settings/members', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
              setMembers(prev => prev.map(p => p.id === m.id ? updated : p))
            }} />
          })}
        </div>
      )}
    </div>
  )
}
