import React, { useEffect, useRef, useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import { inputCls } from '../ui'
import { useEntitySearch } from '@/lib/hooks/useEntitySearch'
import type { Role } from '@/lib/data'

export interface AsyncEntityPickerProps {
  /** One role, or several (e.g. `['teacher', 'staff']`) — fanned out server-side per role and merged. */
  role: Role | Role[]
  /** Narrows student results to one class via Enrollment (ignored for non-student roles). */
  classId?: string
  /** Selected id — empty string means nothing selected. Controlled. */
  value: string
  onChange: (id: string, label: string) => void
  placeholder?: string
  label?: string
  /** Optional — the display name for a `value` this picker didn't itself resolve (e.g. opening an edit
   *  form where the id was already chosen elsewhere). Without it, a non-empty incoming `value` shows
   *  blank text until the user searches and re-picks. */
  initialLabel?: string
}

/**
 * A real positioned dropdown listbox over `GET /api/users/search` (via useEntitySearch) — text input,
 * debounced search-as-you-type, arrow-key/Enter/Escape navigation, click-outside-to-close, inline
 * loading/empty/error states. The reusable replacement for a flat `<select>` built from
 * `db.users.filter(u => u.role === ...)` (unusable once a school has hundreds of students) — see
 * .agents/edunova/ui-architecture-fix.md Phase A.
 *
 * Deliberately NOT `SearchableUserPicker` (employee.tsx): that one is a `<datalist>` over an
 * already-loaded, bounded employee list, which can't do async server search well and is left alone for
 * its existing 6 call sites. This component is for the unbounded, whole-roster cases.
 */
export function AsyncEntityPicker({ role, classId, value, onChange, placeholder, label, initialLabel }: AsyncEntityPickerProps) {
  const [text, setText] = useState(initialLabel ?? '')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)

  // Resync the visible text when `value` is cleared/changed from outside — a render-time adjustment
  // (same pattern as SearchableUserPicker/EmployeeDetailModal in employee.tsx) instead of an effect.
  const [syncedValue, setSyncedValue] = useState(value)
  if (value !== syncedValue) {
    setSyncedValue(value)
    if (!value) setText('')
  }

  const { results, loading, error } = useEntitySearch({ role, classId, query: text, enabled: open })

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Reset keyboard-nav selection whenever the result set changes — a render-time adjustment (same
  // pattern as the `syncedValue` check above) rather than an effect, so it can't cause an extra render.
  const [resultsSnapshot, setResultsSnapshot] = useState(results)
  if (results !== resultsSnapshot) {
    setResultsSnapshot(results)
    setActiveIndex(-1)
  }

  const pick = (id: string, name: string) => {
    onChange(id, name)
    setText(name)
    setOpen(false)
    setActiveIndex(-1)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { setOpen(true); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (open && activeIndex >= 0 && results[activeIndex]) {
        e.preventDefault()
        pick(results[activeIndex].id, results[activeIndex].name)
      }
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); setOpen(false) }
    }
  }

  const body = (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-black/35 dark:text-white/35" />
        <input
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          value={text}
          onFocus={() => setOpen(true)}
          onChange={e => {
            setText(e.target.value)
            setOpen(true)
            if (value) onChange('', '') // typing again invalidates the previous selection until re-picked
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? 'Search…'}
          className={`${inputCls} pl-9 ${value ? 'pr-9' : ''}`}
        />
        {value && (
          <button type="button" onClick={() => { onChange('', ''); setText(''); setOpen(false) }}
            aria-label="Clear selection"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-black/35 hover:bg-black/10 hover:text-black dark:text-white/35 dark:hover:bg-white/15 dark:hover:text-white">
            <X size={13} />
          </button>
        )}
      </div>
      {open && (
        <div role="listbox" className="thin-scroll absolute z-50 mt-1.5 max-h-64 w-full overflow-y-auto rounded-2xl border border-black/[.08] bg-white p-1 shadow-xl dark:border-white/[.12] dark:bg-[#14141f]">
          {loading && (
            <div className="flex items-center gap-2 px-3 py-2.5 text-[13px] text-black/45 dark:text-white/45">
              <Loader2 size={14} className="animate-spin" /> Searching…
            </div>
          )}
          {!loading && error && <p className="px-3 py-2.5 text-[13px] text-rose-500">{error}</p>}
          {!loading && !error && results.length === 0 && (
            <p className="px-3 py-2.5 text-[13px] text-black/45 dark:text-white/45">{text.trim() ? 'No matches.' : 'No results.'}</p>
          )}
          {!loading && !error && results.map((r, i) => (
            <button
              key={r.id}
              type="button"
              role="option"
              aria-selected={i === activeIndex}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => pick(r.id, r.name)}
              className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-[13.5px] transition-colors ${i === activeIndex ? 'bg-indigo-50 dark:bg-indigo-500/15' : 'hover:bg-black/[.04] dark:hover:bg-white/[.06]'}`}
            >
              <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
              <span className="shrink-0 text-[12px] text-black/45 dark:text-white/45">{r.context}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )

  if (!label) return body
  return (
    <label className="block">
      <span className="text-[13px] font-semibold text-black/60 dark:text-white/60">{label}</span>
      <span className="mt-1.5 block">{body}</span>
    </label>
  )
}
