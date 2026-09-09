import { useMemo, useState } from 'react'
import { AlertTriangle, Download, FileSpreadsheet, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { downloadPath, errorMessage } from '@/lib/api'
import { useAcademic } from '@/lib/store'
import { useFetch } from '@/lib/hooks/useTimetable'
import { Card, Empty, PageHead, inputCls } from '../ui'

// Phase 29 Part A — UDISE+ (Unified District Information System for Education Plus) assistive
// export (frontend). Admin/superadmin only. This screen does NOT talk to any government system —
// it previews and downloads a versioned, best-effort field mapping of this school's real data
// (see server/src/modules/compliance/udisePlus.mapping.ts) so an admin can sanity-check numbers
// before manually re-keying them into the actual UDISE+ portal. See
// .agents/edunova/phase-29-india-compliance-offline.md → Part A.

interface UdiseFieldValue { udiseLabel: string; sourceNote: string; verified: false; value: unknown }
interface UdiseGap { udiseLabel: string; gapNote: string; verified: false }
interface UdiseExport {
  mappingVersion: string
  disclaimer: string
  generatedAt: string
  academicYear: { id: string; label: string; startDate: string; endDate: string }
  schoolProfile: { schoolName: UdiseFieldValue; affiliationBoards: UdiseFieldValue; gaps: UdiseGap[] }
  enrollment: { totalEnrollment: UdiseFieldValue; byGrade: UdiseFieldValue; gaps: UdiseGap[] }
  teacher: { headcount: UdiseFieldValue; byDesignation: UdiseFieldValue; gaps: UdiseGap[] }
  facilities: { totalRooms: UdiseFieldValue; byKind: UdiseFieldValue; gaps: UdiseGap[] }
}
interface UdiseExportResponse { item: UdiseExport; summary: string[] }

const sectionLabel = 'text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40'
const rowCls = 'flex flex-wrap items-center justify-between gap-3 border-b border-black/[.05] dark:border-white/[.07] px-5 py-3 last:border-0'

function DisclaimerBanner() {
  return (
    <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-4">
      <ShieldAlert size={20} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="text-[13.5px] leading-relaxed text-amber-900 dark:text-amber-200">
        <p className="font-semibold">This is an assistive export, not a government submission.</p>
        <p className="mt-1">
          It accelerates <strong>manual</strong> UDISE+ form-filling by pulling this school&apos;s real data into one
          place — it does <strong>not</strong> submit anything to any government system (no such public UDISE+
          submission API exists to integrate with). The field mapping below is an <strong>unverified best-effort
          draft</strong> based on the general public shape of UDISE+; every field label and value must be
          <strong> verified against the live UDISE+ portal</strong> before you type anything into an actual
          government submission.
        </p>
      </div>
    </div>
  )
}

function FieldRow({ f }: { f: UdiseFieldValue }) {
  const display = Array.isArray(f.value)
    ? (f.value.length ? (f.value as unknown[]).map(v => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ') : '—')
    : String(f.value ?? '—')
  return (
    <div className={rowCls}>
      <div className="min-w-0">
        <p className="text-[14px] font-medium">{f.udiseLabel}</p>
        <p className="mt-0.5 text-[12px] text-black/45 dark:text-white/45">{f.sourceNote}</p>
      </div>
      <p className="shrink-0 text-[14.5px] font-semibold tabular-nums">{display}</p>
    </div>
  )
}

function BreakdownRow({ f }: { f: UdiseFieldValue }) {
  const rows = Array.isArray(f.value) ? (f.value as Record<string, unknown>[]) : []
  const labelKey = rows[0] ? Object.keys(rows[0]).find(k => k !== 'count') : undefined
  return (
    <div className="border-b border-black/[.05] dark:border-white/[.07] px-5 py-3 last:border-0">
      <p className="text-[14px] font-medium">{f.udiseLabel}</p>
      <p className="mt-0.5 text-[12px] text-black/45 dark:text-white/45">{f.sourceNote}</p>
      {rows.length ? (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {rows.map((r, i) => (
            <span key={i} className="rounded-full bg-black/[.05] dark:bg-white/[.07] px-3 py-1 text-[12.5px] font-medium">
              {labelKey ? String(r[labelKey]) : ''}: <span className="tabular-nums">{String(r.count)}</span>
            </span>
          ))}
        </div>
      ) : <p className="mt-2 text-[13px] text-black/40 dark:text-white/40">No data for this academic year.</p>}
    </div>
  )
}

function GapsList({ gaps }: { gaps: UdiseGap[] }) {
  if (!gaps.length) return null
  return (
    <div className="border-t border-black/[.06] dark:border-white/[.08] bg-black/[.02] dark:bg-white/[.03] px-5 py-3.5">
      <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-black/50 dark:text-white/50">
        <AlertTriangle size={13} /> Not available in this system — fill in manually
      </p>
      <ul className="mt-2 space-y-1.5">
        {gaps.map((g, i) => (
          <li key={i} className="text-[12.5px] leading-relaxed text-black/50 dark:text-white/50">
            <span className="font-medium text-black/65 dark:text-white/65">{g.udiseLabel}:</span> {g.gapNote}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Section({ title, children, gaps }: { title: string; children: React.ReactNode; gaps: UdiseGap[] }) {
  return (
    <Card className="!p-0 overflow-hidden">
      <div className="border-b border-black/[.06] dark:border-white/[.08] px-5 py-3.5">
        <p className={sectionLabel}>{title}</p>
      </div>
      {children}
      <GapsList gaps={gaps} />
    </Card>
  )
}

export function UdiseExportMod() {
  const { years, currentYear } = useAcademic()
  const [academicYearId, setAcademicYearId] = useState(currentYear?.id ?? '')
  const [downloading, setDownloading] = useState<'csv' | 'json' | null>(null)

  const sortedYears = useMemo(() => [...years].sort((a, b) => b.startDate.localeCompare(a.startDate)), [years])
  const path = academicYearId ? `/compliance/udise-export?academicYearId=${encodeURIComponent(academicYearId)}&format=json` : null
  const { data, error, loading } = useFetch<UdiseExportResponse>(path)
  const exp = data?.item

  const download = async (format: 'csv' | 'json') => {
    if (!academicYearId || !exp) return
    setDownloading(format)
    try {
      if (format === 'csv') {
        await downloadPath(
          `/compliance/udise-export?academicYearId=${encodeURIComponent(academicYearId)}&format=csv`,
          `udise-export-${exp.academicYear.label}-${exp.mappingVersion}.csv`,
        )
      } else {
        const blob = new Blob([JSON.stringify(exp, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `udise-export-${exp.academicYear.label}-${exp.mappingVersion}.json`
        a.click()
        URL.revokeObjectURL(url)
      }
      toast.success(`${format.toUpperCase()} downloaded`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div>
      <PageHead title="UDISE+ Export" sub="Preview and download real school data mapped to UDISE+'s public form structure, to speed up manual entry on the government portal." />
      <DisclaimerBanner />

      <Card className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-xs flex-1">
          <label className="text-[13px] font-semibold text-black/60 dark:text-white/60">Academic year</label>
          <select value={academicYearId} onChange={e => setAcademicYearId(e.target.value)} className={`${inputCls} mt-1.5`}>
            <option value="">Select an academic year…</option>
            {sortedYears.map(y => <option key={y.id} value={y.id}>{y.label}{y.isCurrent ? ' (current)' : ''}</option>)}
          </select>
        </div>
        <div className="flex gap-2.5">
          <button
            onClick={() => download('json')}
            disabled={!exp || !!downloading}
            className="flex items-center gap-2 rounded-full border border-black/10 dark:border-white/15 px-5 py-2.5 text-[13.5px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06] disabled:opacity-40"
          >
            <FileSpreadsheet size={15} /> {downloading === 'json' ? 'Downloading…' : 'Download JSON'}
          </button>
          <button
            onClick={() => download('csv')}
            disabled={!exp || !!downloading}
            className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40"
          >
            <Download size={15} /> {downloading === 'csv' ? 'Downloading…' : 'Download CSV'}
          </button>
        </div>
      </Card>

      {!academicYearId && <Empty text="Pick an academic year to preview its UDISE+ export." />}
      {academicYearId && loading && <Empty text="Generating export…" />}
      {academicYearId && error && <Empty text={error} />}

      {exp && (
        <div className="space-y-5">
          <Card className="flex flex-wrap items-center justify-between gap-3 bg-black/[.02] dark:bg-white/[.03]">
            <div>
              <p className="text-[13px] font-semibold text-black/60 dark:text-white/60">
                Mapping version <span className="rounded-full bg-black/[.06] dark:bg-white/[.09] px-2.5 py-0.5 font-mono text-[12px]">{exp.mappingVersion}</span>
              </p>
              <p className="mt-1 text-[12.5px] text-black/45 dark:text-white/45">
                Generated {new Date(exp.generatedAt).toLocaleString()} for {exp.academicYear.label} ({exp.academicYear.startDate} – {exp.academicYear.endDate})
              </p>
            </div>
          </Card>

          <Section title="1 · School Profile" gaps={exp.schoolProfile.gaps}>
            <FieldRow f={exp.schoolProfile.schoolName} />
            <FieldRow f={exp.schoolProfile.affiliationBoards} />
          </Section>

          <Section title="2 · Enrollment" gaps={exp.enrollment.gaps}>
            <FieldRow f={exp.enrollment.totalEnrollment} />
            <BreakdownRow f={exp.enrollment.byGrade} />
          </Section>

          <Section title="3 · Teacher / Staff" gaps={exp.teacher.gaps}>
            <FieldRow f={exp.teacher.headcount} />
            <BreakdownRow f={exp.teacher.byDesignation} />
          </Section>

          <Section title="4 · Facilities" gaps={exp.facilities.gaps}>
            <FieldRow f={exp.facilities.totalRooms} />
            <BreakdownRow f={exp.facilities.byKind} />
          </Section>
        </div>
      )}
    </div>
  )
}
