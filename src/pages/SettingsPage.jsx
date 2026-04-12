import { useState, useEffect } from 'react'
import { Plus, Trash2, Save, Users, LayoutGrid, RefreshCw } from 'lucide-react'

export default function SettingsPage() {
  const [members, setMembers] = useState([])
  const [boards, setBoards] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  // New member form
  const [newName, setNewName] = useState('')
  const [newUserId, setNewUserId] = useState('')
  const [newIsVideo, setNewIsVideo] = useState(false)

  // New board form
  const [newBoardId, setNewBoardId] = useState('')
  const [newBoardLabel, setNewBoardLabel] = useState('')

  useEffect(() => { fetchSettings() }, [])

  const fetchSettings = async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/monday/settings')
      const d = await r.json()
      setMembers(d.members || [])
      setBoards(d.boards || [])
    } catch(e) { setMsg('Failed to load settings') }
    finally { setLoading(false) }
  }

  const flash = (text) => { setMsg(text); setTimeout(() => setMsg(''), 3000) }

  // ─── Member actions ───────────────────────────────────────────────────────────
  const addMember = async () => {
    if (!newName.trim()) return
    setSaving(true)
    try {
      const r = await fetch('/api/monday/settings/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), monday_user_id: newUserId.trim(), is_video_team: newIsVideo })
      })
      const d = await r.json()
      if (d.members) setMembers(d.members)
      else await fetchSettings()
      setNewName(''); setNewUserId(''); setNewIsVideo(false)
      flash('Member added')
    } catch(e) { flash('Error adding member') }
    setSaving(false)
  }

  const updateMember = async (member) => {
    setSaving(true)
    try {
      await fetch('/api/monday/settings/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: member.id, name: member.name, monday_user_id: member.monday_user_id, is_video_team: member.is_video_team })
      })
      flash('Saved')
    } catch(e) { flash('Error saving') }
    setSaving(false)
  }

  const deleteMember = async (id) => {
    if (!confirm('Remove this member?')) return
    await fetch(`/api/monday/settings/members/${id}`, { method: 'DELETE' })
    setMembers(m => m.filter(x => x.id !== id))
  }

  // ─── Board actions ────────────────────────────────────────────────────────────
  const addBoard = async () => {
    if (!newBoardId.trim()) return
    setSaving(true)
    try {
      const r = await fetch('/api/monday/settings/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board_id: newBoardId.trim(), label: newBoardLabel.trim() })
      })
      const d = await r.json()
      if (d.boards) setBoards(d.boards)
      else await fetchSettings()
      setNewBoardId(''); setNewBoardLabel('')
      flash('Board added')
    } catch(e) { flash('Error adding board') }
    setSaving(false)
  }

  const deleteBoard = async (boardId) => {
    if (!confirm('Remove this board?')) return
    await fetch(`/api/monday/settings/boards/${boardId}`, { method: 'DELETE' })
    setBoards(b => b.filter(x => x.board_id !== boardId))
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin text-primary opacity-60"><RefreshCw size={28} /></div>
    </div>
  )

  return (
    <div className="space-y-8 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        {msg && <span className="text-xs px-3 py-1.5 rounded-lg bg-primary/15 text-primary font-medium">{msg}</span>}
      </div>

      {/* ─── Team Members ─────────────────────────────────────────────────────── */}
      <section className="bg-white/[0.04] border border-border/30 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Users size={16} className="text-primary" />
          <h2 className="text-base font-semibold text-foreground">Team Members</h2>
          <span className="text-xs text-muted-foreground ml-1">({members.length})</span>
        </div>

        {members.length === 0 && (
          <p className="text-sm text-muted-foreground">No members yet. Add one below.</p>
        )}

        <div className="space-y-2">
          {members.map(m => (
            <MemberRow key={m.id} member={m}
              onChange={updated => setMembers(prev => prev.map(x => x.id === m.id ? updated : x))}
              onSave={() => updateMember(m)}
              onDelete={() => deleteMember(m.id)} />
          ))}
        </div>

        {/* Add member */}
        <div className="flex gap-2 pt-2 border-t border-border/20 flex-wrap">
          <input value={newName} onChange={e => setNewName(e.target.value)}
            placeholder="Name *"
            className="flex-1 min-w-[120px] bg-white/5 border border-border/40 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" />
          <input value={newUserId} onChange={e => setNewUserId(e.target.value)}
            placeholder="Monday User ID"
            className="flex-1 min-w-[140px] bg-white/5 border border-border/40 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground px-1">
            <input type="checkbox" checked={newIsVideo} onChange={e => setNewIsVideo(e.target.checked)} className="accent-primary" />
            Video team
          </label>
          <button onClick={addMember} disabled={!newName.trim() || saving}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 text-sm font-medium disabled:opacity-40 transition-colors">
            <Plus size={14} /> Add
          </button>
        </div>
      </section>

      {/* ─── Monday Boards ────────────────────────────────────────────────────── */}
      <section className="bg-white/[0.04] border border-border/30 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <LayoutGrid size={16} className="text-primary" />
          <h2 className="text-base font-semibold text-foreground">Monday.com Boards</h2>
          <span className="text-xs text-muted-foreground ml-1">({boards.length})</span>
        </div>

        {boards.length === 0 && (
          <p className="text-sm text-muted-foreground">No boards configured. Add a Board ID below.</p>
        )}

        <div className="space-y-2">
          {boards.map(b => (
            <div key={b.board_id} className="flex items-center gap-2 bg-white/[0.03] border border-border/20 rounded-lg px-3 py-2">
              <code className="text-xs text-muted-foreground font-mono flex-1">{b.board_id}</code>
              <span className="text-sm text-foreground">{b.label || <span className="text-muted-foreground italic">no label</span>}</span>
              <button onClick={() => deleteBoard(b.board_id)}
                className="text-red-400/60 hover:text-red-400 transition-colors ml-1"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>

        {/* Add board */}
        <div className="flex gap-2 pt-2 border-t border-border/20">
          <input value={newBoardId} onChange={e => setNewBoardId(e.target.value)}
            placeholder="Board ID (from Monday URL) *"
            className="flex-1 bg-white/5 border border-border/40 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" />
          <input value={newBoardLabel} onChange={e => setNewBoardLabel(e.target.value)}
            placeholder="Label (optional)"
            className="w-36 bg-white/5 border border-border/40 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" />
          <button onClick={addBoard} disabled={!newBoardId.trim() || saving}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 text-sm font-medium disabled:opacity-40 transition-colors">
            <Plus size={14} /> Add
          </button>
        </div>
      </section>
    </div>
  )
}

function MemberRow({ member, onChange, onSave, onDelete }) {
  return (
    <div className="flex items-center gap-2 bg-white/[0.03] border border-border/20 rounded-lg px-3 py-2 flex-wrap">
      <input value={member.name} onChange={e => onChange({ ...member, name: e.target.value })}
        className="w-28 bg-transparent text-sm text-foreground focus:outline-none border-b border-transparent focus:border-border/40" />
      <input value={member.monday_user_id || ''} onChange={e => onChange({ ...member, monday_user_id: e.target.value })}
        placeholder="Monday User ID"
        className="flex-1 min-w-[120px] bg-transparent text-xs text-muted-foreground focus:outline-none border-b border-transparent focus:border-border/40 font-mono" />
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        <input type="checkbox" checked={!!member.is_video_team}
          onChange={e => onChange({ ...member, is_video_team: e.target.checked ? 1 : 0 })} className="accent-primary" />
        Video
      </label>
      <button onClick={onSave} className="text-primary/70 hover:text-primary transition-colors"><Save size={13} /></button>
      <button onClick={onDelete} className="text-red-400/60 hover:text-red-400 transition-colors"><Trash2 size={13} /></button>
    </div>
  )
}
