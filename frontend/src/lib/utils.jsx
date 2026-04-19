import { useEffect } from 'react'
import React from 'react'

export function cn(...classes) { return classes.filter(Boolean).join(' ') }

// ── Markdown renderer ──────────────────────────────────────────────────────────
export function renderBoldLine(line, key) {
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

export function MarkdownText({ text }) {
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

// ── Background sync hook ───────────────────────────────────────────────────────
export function useBackgroundSync(onSync, intervalMs = 60000) {
  const onSyncRef = React.useRef(onSync)
  onSyncRef.current = onSync
  useEffect(() => {
    let timer
    const run = async () => {
      if (document.visibilityState !== 'visible') return
      try { fetch('/api/monday/sync', { method: 'POST' }).catch(() => {}) } catch {} // fire-and-forget
      try { onSyncRef.current() } catch {}
    }
    const onVis = () => { if (document.visibilityState === 'visible') run() }
    timer = setInterval(run, intervalMs)
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVis) }
  }, [intervalMs])
}
