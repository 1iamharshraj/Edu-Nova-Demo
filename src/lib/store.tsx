import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { seedDB } from './data'
import { canManage } from './access'
import type { DB, Role, User } from './data'

const DB_KEY = 'edunova_db_v1'
const SESSION_KEY = 'edunova_session_v1'

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function makeEmail(name: string, role: Role) {
  const base = name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/(^\.|\.$)/g, '')
  if (role === 'student') return `${base}@edunova.in`
  if (role === 'parent') return `parent.${base}@edunova.in`
  if (role === 'teacher') return `${base}@edunova.in`
  if (role === 'staff') return `${base}@edunova.in`
  if (role === 'admin') return `${base}@edunova.in`
  return `${base}@edunova.in`
}

function rolePassword(role: Role) {
  if (role === 'superadmin') return 'principal123'
  if (role === 'admin') return 'admin123'
  if (role === 'staff') return 'staff123'
  if (role === 'teacher') return 'teacher123'
  if (role === 'parent') return 'parent123'
  return 'student123'
}

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
  createUser: (partial: Omit<Partial<User>, 'id'> & { name: string; role: Role }) => User
  deleteUser: (id: string) => boolean
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
    createUser: (partial) => {
      const id = uid(partial.role === 'student' ? 'u-s' : partial.role === 'parent' ? 'u-p' : partial.role === 'teacher' ? 'u-t' : partial.role === 'staff' ? 'u-st' : 'u-a')
      const email = partial.email ?? makeEmail(partial.name, partial.role)
      const password = rolePassword(partial.role)
      const user: User = {
        id,
        role: partial.role,
        name: partial.name,
        email,
        password,
        title: partial.title ?? `${partial.role} · onboarded`,
        avatarHue: partial.avatarHue ?? Math.floor(Math.random() * 360),
        verified: partial.verified ?? true,
        class: partial.class,
        section: partial.section,
        roll: partial.roll,
        subjects: partial.subjects,
        department: partial.department,
        designation: partial.designation,
        joinDate: partial.joinDate ?? new Date().toISOString().slice(0, 10),
        phone: partial.phone,
        parentEmail: partial.parentEmail,
        board: partial.board,
      }
      setDb(prev => ({ ...prev, users: [...prev.users, user] }))
      return user
    },
    deleteUser: (id) => {
      const current = user
      const target = db.users.find(u => u.id === id)
      if (!current || !target) return false
      if (!canManage(current, target, db.users)) return false
      setDb(prev => ({ ...prev, users: prev.users.filter(u => u.id !== id) }))
      return true
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
