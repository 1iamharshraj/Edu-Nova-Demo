import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { seedDB } from './data'
import type { DB, User } from './data'

const DB_KEY = 'edunova_db_v1'
const SESSION_KEY = 'edunova_session_v1'

function loadDB(): DB {
  try {
    const raw = localStorage.getItem(DB_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as DB
      if (parsed && parsed.users && parsed.terms) return parsed
    }
  } catch { /* fall through to reseed */ }
  const fresh = seedDB()
  localStorage.setItem(DB_KEY, JSON.stringify(fresh))
  return fresh
}

interface StoreCtx {
  db: DB
  update: (fn: (db: DB) => DB) => void
  user: User | null
  login: (email: string, password: string) => User | null
  logout: () => void
  setUser: (u: User) => void
  resetAll: () => void
}

const Ctx = createContext<StoreCtx | null>(null)

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<DB>(loadDB)
  const [user, setUserState] = useState<User | null>(() => {
    try {
      const id = localStorage.getItem(SESSION_KEY)
      if (!id) return null
      return loadDB().users.find(u => u.id === id) ?? null
    } catch { return null }
  })

  useEffect(() => {
    localStorage.setItem(DB_KEY, JSON.stringify(db))
  }, [db])

  const api = useMemo<StoreCtx>(() => ({
    db,
    update: (fn) => setDb(prev => fn(structuredClone(prev))),
    user,
    login: (email, password) => {
      const found = db.users.find(u => u.email.toLowerCase() === email.trim().toLowerCase() && u.password === password)
      if (found) {
        localStorage.setItem(SESSION_KEY, found.id)
        setUserState(found)
        return found
      }
      return null
    },
    logout: () => {
      localStorage.removeItem(SESSION_KEY)
      setUserState(null)
    },
    setUser: (u) => setUserState(u),
    resetAll: () => {
      const fresh = seedDB()
      setDb(fresh)
      localStorage.setItem(DB_KEY, JSON.stringify(fresh))
    },
  }), [db, user])

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useStore() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useStore outside provider')
  return ctx
}

// per-user scratch persistence (verification state, uploads, etc.)
export function useLocalState<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const full = 'edunova_x_' + key
  const [val, setVal] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(full)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch { return initial }
  })
  useEffect(() => { localStorage.setItem(full, JSON.stringify(val)) }, [full, val])
  return [val, setVal]
}
