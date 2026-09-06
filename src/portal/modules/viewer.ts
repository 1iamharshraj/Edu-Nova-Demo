import { useMemo } from 'react'
import { useAcademic, useStore } from '@/lib/store'
import type { User } from '@/lib/data'
import { useTerm } from '../Portal'

/**
 * Students the logged-in user views "as their own":
 * - student → themself
 * - parent  → wards from the academic guardians table, falling back to the legacy parentEmail match
 * - anyone else → none
 */
export function useViewedStudents(): User[] {
  const { db, user } = useStore()
  const { wardsOf } = useAcademic()
  return useMemo(() => {
    if (!user) return []
    if (user.role === 'student') return [db.users.find(u => u.id === user.id) ?? user]
    if (user.role === 'parent') {
      const byGuardian = wardsOf(user.id)
        .map(id => db.users.find(u => u.id === id && u.role === 'student'))
        .filter((u): u is User => !!u)
      if (byGuardian.length) return byGuardian
      return db.users.filter(u => u.role === 'student' && !!user.email && u.parentEmail === user.email)
    }
    return []
  }, [db.users, user, wardsOf])
}

export function useViewedStudent(): User | undefined {
  return useViewedStudents()[0]
}

/** Term from context, falling back to the current (or first) term when the context is empty. */
export function useActiveTerm() {
  const { db } = useStore()
  const { term, setTerm } = useTerm()
  const id = term || db.terms.find(t => t.current)?.id || db.terms[0]?.id || ''
  return { term: id, setTerm, termObj: db.terms.find(t => t.id === id) }
}

export const firstName = (name?: string) => (name ?? '').split(' ')[0]
