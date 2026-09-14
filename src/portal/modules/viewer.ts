import { useMemo, useState } from 'react'
import { useAcademic, useStore } from '@/lib/store'
import type { User } from '@/lib/data'
import { useTerm } from '../Portal'

/**
 * Students the logged-in user views "as their own":
 * - student → themself
 * - parent  → wards from the academic guardians table
 * - anyone else → none
 */
export function useViewedStudents(): User[] {
  const { db, user } = useStore()
  const { wardsOf } = useAcademic()
  return useMemo(() => {
    if (!user) return []
    if (user.role === 'student') return [db.users.find(u => u.id === user.id) ?? user]
    if (user.role === 'parent') {
      return wardsOf(user.id)
        .map(id => db.users.find(u => u.id === id && u.role === 'student'))
        .filter((u): u is User => !!u)
    }
    return []
  }, [db.users, user, wardsOf])
}

export function useViewedStudent(): User | undefined {
  return useViewedStudents()[0]
}

/** Viewed students plus a selection — parents with several wards pick one (see `WardPicker` in academics.tsx). */
export function useWard() {
  const students = useViewedStudents()
  const [picked, setPicked] = useState('')
  const ward = students.find(s => s.id === picked) ?? students[0]
  return { students, ward, wardId: ward?.id ?? '', setWardId: setPicked }
}

/** Term from context, falling back to the current (or first) term when the context is empty. */
export function useActiveTerm() {
  const { db } = useStore()
  const { term, setTerm } = useTerm()
  const id = term || db.terms.find(t => t.current)?.id || db.terms[0]?.id || ''
  return { term: id, setTerm, termObj: db.terms.find(t => t.id === id) }
}

// Strips a leading honorific ("Dr.", "Mr.", "Mrs.", "Ms.", "Er.") before taking the first token, so a
// seeded name like "Dr. Arun Nambiar" greets as "Arun", not "Dr.".
const HONORIFICS = /^(dr|mr|mrs|ms|miss|er|prof)\.?$/i
export const firstName = (name?: string) => {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  const first = HONORIFICS.test(parts[0] ?? '') ? parts[1] : parts[0]
  return first ?? ''
}
