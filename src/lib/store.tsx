import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api, getToken, setToken } from './api'
import { emptyAcademic } from './data'
import type { AcademicState, DB, Role, User } from './data'

export { API_BASE } from './api'

function emptyDB(): DB {
  return {
    users: [], terms: [], subjects: [], timetable: {}, attendance: {}, marks: {}, feed: [], threads: [],
    homework: [], receipts: [], events: [], slips: [], leaves: [], achievements: [], ranks: {}, health: [],
    directory: [], applications: [], workAssign: [], marksheets: [], contracts: [], resignations: [],
    meetings: [], workUploads: [], attendanceRecords: [], boardDetails: {}, aiParentCalls: [],
    disciplinaryCases: [], studentProfileReports: [],
  }
}

async function fetchFullDB(): Promise<DB> {
  const [usersRes, dataRes] = await Promise.all([api.get('/users'), api.get('/data')])
  return { ...emptyDB(), ...dataRes.data, users: usersRes.users } as DB
}

async function fetchAcademic(): Promise<AcademicState> {
  const res = await api.get<AcademicState>('/academic/bootstrap')
  return { ...emptyAcademic(), ...res }
}

export interface CreateUserInput extends Omit<Partial<User>, 'id' | 'password'> {
  name: string
  role: Role
  password?: string
  classId?: string
  rollNo?: string
  studentIds?: string[]
  classTeacherOf?: string
}
export type UpdateUserInput = Partial<CreateUserInput>

interface StoreCtx {
  db: DB
  academic: AcademicState
  /** Legacy optimistic mutation of the JSON blob — new screens should use the API directly. */
  update: (fn: (db: DB) => DB) => void
  user: User | null
  login: (email: string, password: string) => Promise<User | null>
  logout: () => void
  setUser: (u: User) => void
  refreshDB: () => Promise<void>
  refreshAcademic: () => Promise<void>
  createUser: (input: CreateUserInput) => Promise<{ user: User; password: string }>
  updateUser: (id: string, input: UpdateUserInput) => Promise<User>
  deleteUser: (id: string) => Promise<boolean>
  loadSampleData: () => Promise<void>
  resetSchool: () => Promise<void>
  loading: boolean
}

const Ctx = createContext<StoreCtx | null>(null)

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<DB>(emptyDB)
  const [academic, setAcademic] = useState<AcademicState>(emptyAcademic)
  const [user, setUserState] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const dbRef = useRef(db)
  dbRef.current = db

  const loadAll = useCallback(async () => {
    const [fresh, acad] = await Promise.all([fetchFullDB(), fetchAcademic()])
    setDb(fresh)
    setAcademic(acad)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function boot() {
      if (!getToken()) { setLoading(false); return }
      try {
        const me = await api.get('/auth/me')
        if (cancelled) return
        setUserState(me.user)
        await loadAll()
      } catch {
        setToken(null)
        setUserState(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    boot()
    return () => { cancelled = true }
  }, [loadAll])

  // Legacy blob sync — fire-and-forget, last write wins. The server ignores users/terms/subjects.
  function syncData(next: DB) {
    const { users: _u, terms: _t, subjects: _s, ...rest } = next
    void _u; void _t; void _s
    api.put('/data', rest).catch(err => console.error('Failed to sync data to server', err))
  }

  // A few legacy call sites mutate db.users directly via update() (self-verification, inline edits).
  function syncChangedUsers(prev: DB, next: DB) {
    const prevById = new Map(prev.users.map(u => [u.id, u]))
    for (const u of next.users) {
      const before = prevById.get(u.id)
      if (!before) continue // creation must go through createUser
      if (JSON.stringify(before) !== JSON.stringify(u)) {
        api.patch(`/users/${u.id}`, { ...u, password: undefined }).catch(err => console.error('Failed to sync user', err))
      }
    }
  }

  const refreshDB = useCallback(async () => { setDb(await fetchFullDB()) }, [])
  const refreshAcademic = useCallback(async () => { setAcademic(await fetchAcademic()) }, [])

  const value: StoreCtx = useMemo(() => ({
    db,
    academic,
    loading,
    user,
    update: (fn) => {
      setDb(prev => {
        const next = fn(structuredClone(prev))
        syncData(next)
        if (next.users !== prev.users) syncChangedUsers(prev, next)
        return next
      })
    },
    login: async (email, password) => {
      const res = await api.post('/auth/login', { email, password })
      setToken(res.token)
      setUserState(res.user)
      await loadAll()
      return res.user
    },
    logout: () => {
      api.post('/auth/logout').catch(() => {})
      setToken(null)
      setUserState(null)
      setDb(emptyDB())
      setAcademic(emptyAcademic())
    },
    setUser: (u) => setUserState(u),
    refreshDB,
    refreshAcademic,
    createUser: async (input) => {
      const res = await api.post<{ user: User; password: string }>('/users', input)
      await loadAll()
      return res
    },
    updateUser: async (id, input) => {
      const res = await api.patch<{ user: User }>(`/users/${id}`, input)
      await loadAll()
      if (user && user.id === id) setUserState(res.user)
      return res.user
    },
    deleteUser: async (id) => {
      try {
        await api.del(`/users/${id}`)
        await loadAll()
        return true
      } catch {
        return false
      }
    },
    loadSampleData: async () => {
      await api.post('/admin/load-sample-data')
      await loadAll()
    },
    resetSchool: async () => {
      await api.post('/admin/reset', { confirm: 'RESET' })
      await loadAll()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [db, academic, user, loading, loadAll, refreshDB, refreshAcademic])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f6f6f4] text-[14px] text-black/50 dark:bg-[#090911] dark:text-white/50">
        Loading EduNova…
      </div>
    )
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useStore outside provider')
  return ctx
}

/** Convenience selectors over the academic slice. */
export function useAcademic() {
  const { academic } = useStore()
  return useMemo(() => {
    const currentYear = academic.years.find(y => y.isCurrent) ?? academic.years[0]
    const currentTerm = academic.terms.find(t => t.isCurrent) ?? academic.terms[0]
    const classById = new Map(academic.classes.map(c => [c.id, c]))
    const subjectById = new Map(academic.subjects.map(s => [s.id, s]))
    const boardById = new Map(academic.boards.map(b => [b.id, b]))
    const gradeById = new Map(academic.grades.map(g => [g.id, g]))
    const streamById = new Map(academic.streams.map(s => [s.id, s]))
    /** Curriculum rows that apply to a class: its board + grade, for its stream or no stream. */
    const curriculumFor = (c: { boardId: string; gradeId: string; streamId?: string }) =>
      academic.curriculum.filter(r => r.boardId === c.boardId && r.gradeId === c.gradeId && (!r.streamId || r.streamId === c.streamId))
    const classOf = (studentId: string) => {
      const e = academic.enrollments.find(x => x.studentId === studentId && x.status === 'active' && (!currentYear || x.academicYearId === currentYear.id))
        ?? academic.enrollments.find(x => x.studentId === studentId)
      return e ? classById.get(e.classId) : undefined
    }
    const wardsOf = (parentId: string) => academic.guardians.filter(g => g.parentId === parentId).map(g => g.studentId)
    const classesTaughtBy = (teacherId: string) => {
      const ids = new Set(academic.classSubjects.filter(cs => cs.teacherId === teacherId).map(cs => cs.classId))
      academic.classes.filter(c => c.classTeacherId === teacherId).forEach(c => ids.add(c.id))
      return academic.classes.filter(c => ids.has(c.id))
    }
    return { ...academic, currentYear, currentTerm, classById, subjectById, boardById, gradeById, streamById, curriculumFor, classOf, wardsOf, classesTaughtBy }
  }, [academic])
}

// per-user scratch persistence (browser-only conveniences)
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
