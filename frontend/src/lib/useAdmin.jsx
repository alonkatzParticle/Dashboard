import { useState, useEffect, createContext, useContext, useCallback } from 'react'

// ─────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────
const AdminContext = createContext({ isAdmin: false, isRestricted: null, unlock: async () => false, lock: () => {} })

export function useAdmin() {
  return useContext(AdminContext)
}

// ─────────────────────────────────────────────────────────────
// Provider — wrap the whole app with this
// ─────────────────────────────────────────────────────────────
export function AdminProvider({ children }) {
  const [isRestricted, setIsRestricted] = useState(null)  // null=loading, false=open, true=restricted
  const [isAdmin, setIsAdmin]           = useState(false)  // has the user unlocked this session?

  useEffect(() => {
    // Ask the backend whether restricted mode is active
    fetch('/api/auth/mode')
      .then(r => r.json())
      .then(d => {
        setIsRestricted(d.restricted)
        // If already unlocked this session (e.g. page refresh), restore state
        if (d.restricted && sessionStorage.getItem('adminUnlocked') === '1') {
          setIsAdmin(true)
        }
      })
      .catch(() => {})
  }, [])

  const unlock = useCallback(async (password) => {
    try {
      const r = await fetch('/api/auth/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const d = await r.json()
      if (d.ok) {
        sessionStorage.setItem('adminUnlocked', '1')
        setIsAdmin(true)
        return true
      }
      return false
    } catch {
      return false
    }
  }, [])

  const lock = useCallback(() => {
    sessionStorage.removeItem('adminUnlocked')
    setIsAdmin(false)
  }, [])

  return (
    <AdminContext.Provider value={{ isAdmin, isRestricted, unlock, lock }}>
      {children}
    </AdminContext.Provider>
  )
}
