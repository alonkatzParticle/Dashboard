import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAdmin } from '../lib/useAdmin'

// ─────────────────────────────────────────────────────────────
// AdminGuard — wrap any Route element that admins-only can see
// ─────────────────────────────────────────────────────────────
export function AdminGuard({ children }) {
  const { isAdmin, isRestricted } = useAdmin()
  if (isRestricted === null) return null          // still loading — render nothing
  if (isRestricted && !isAdmin) {
    return <Navigate to="/weekly" replace />
  }
  return children
}

// ─────────────────────────────────────────────────────────────
// UnlockButton — fixed bottom-left lock icon
// ─────────────────────────────────────────────────────────────
export function UnlockButton() {
  const { isAdmin, isRestricted, lock } = useAdmin()
  const [showModal, setShowModal] = useState(false)

  if (!isRestricted) return null  // password not configured → nothing to show

  return (
    <>
      <button
        onClick={() => isAdmin ? lock() : setShowModal(true)}
        title={isAdmin ? 'Lock admin access' : 'Admin unlock'}
        className="fixed bottom-4 left-4 z-[100] w-8 h-8 rounded-full flex items-center justify-center
          bg-white/5 border border-white/10 text-muted-foreground hover:text-foreground
          hover:bg-white/10 transition-all shadow-lg"
      >
        {isAdmin ? '🔓' : '🔒'}
      </button>
      {showModal && <UnlockModal onClose={() => setShowModal(false)} />}
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// UnlockModal — password prompt
// ─────────────────────────────────────────────────────────────
function UnlockModal({ onClose }) {
  const { unlock } = useAdmin()
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!password) return
    setLoading(true); setError('')
    const ok = await unlock(password)
    setLoading(false)
    if (ok) { onClose() }
    else { setError('Incorrect password'); setPassword('') }
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <form
        onSubmit={submit}
        className="bg-[#1a1a2e] border border-white/10 rounded-2xl p-6 w-full max-w-xs shadow-2xl space-y-4"
      >
        <div>
          <h2 className="text-sm font-semibold text-white">Admin Access</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Enter the admin password to unlock all pages</p>
        </div>
        <input
          autoFocus
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white
            placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={loading || !password}
          className="w-full py-2 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-sm
            font-medium disabled:opacity-40 transition-colors"
        >
          {loading ? 'Verifying…' : 'Unlock'}
        </button>
      </form>
    </div>
  )
}
