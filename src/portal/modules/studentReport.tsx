import { Download, FileText, HeartPulse, Phone, TrendingUp, Users } from 'lucide-react'
import {
  fmtINR, type AchievementRec, type AttendanceSummary, type CallLogRec, type DisciplinaryCaseRec,
  type HealthRecordRec, type ReportCard,
} from '@/lib/data'
import { errorMessage } from '@/lib/api'
import { useOne } from '@/lib/hooks/useAcademics'
import { useCertificates } from '@/lib/hooks/useIdentity'
import { downloadPath } from '@/lib/api'
import { Card, Empty, PageHead, Pill, Progress } from '../ui'

interface DossierMeeting { id: string; purpose: string; scheduledAt: string; status: string }
interface DossierInvoice { id: string; termId: string; status: string; dueDate: string; total: number; paid: number }
interface DossierRanks { classId: string; classLabel: string; termId: string; assessments: number; items: { studentId: string; rank: number; pct: number }[] }
interface StudentDossier {
  profile: { id: string; name: string; email: string; role: string; avatarHue?: number; photoFileId?: string | null }
  enrollment?: { classId: string; rollNo?: string; academicYearId: string }
  termId?: string
  attendance?: AttendanceSummary
  reportCard?: ReportCard
  ranks?: DossierRanks
  invoices: DossierInvoice[]
  meetings: DossierMeeting[]
  calls: CallLogRec[]
  discipline: DisciplinaryCaseRec[]
  achievements: AchievementRec[]
  health: HealthRecordRec[]
}

interface StudentReportModProps {
  studentId: string
}

const statusTone = (s: string) => {
  if (['Paid', 'Approved', 'Completed', 'Submitted', 'Closed', 'Verified', 'Sealed', 'Published', 'Confirmed'].includes(s)) return 'green' as const
  if (['Pending', 'Due', 'Requested', 'Scheduled', 'Assigned', 'TeacherSigned', 'Draft', 'Reported', 'Heard', 'Decision'].includes(s)) return 'amber' as const
  if (['Declined', 'Late', 'Failed', 'Cancelled', 'Action Taken', 'Expulsion', 'Suspension'].includes(s)) return 'rose' as const
  return 'slate' as const
}

export function StudentReportMod({ studentId }: StudentReportModProps) {
  const { data: dossier, error, loading } = useOne<StudentDossier>(`/reports/student/${encodeURIComponent(studentId)}`)
  const { items: certificates } = useCertificates(studentId)

  if (loading) {
    return (
      <div>
        <PageHead title="Student Profile Report" sub="Comprehensive student dossier" />
        <Card><p className="text-[13px] text-black/40 dark:text-white/40">Loading…</p></Card>
      </div>
    )
  }

  if (error || !dossier) {
    return (
      <div>
        <PageHead title="Student Profile Report" sub="Comprehensive student dossier" />
        <Card><Empty text={error ? errorMessage(error) : 'Student not found.'} /></Card>
      </div>
    )
  }

  const student = dossier.profile
  const attendance = dossier.attendance
  const attPct = attendance && attendance.overall.total > 0 ? Math.round(attendance.overall.pct) : 0
  const rc = dossier.reportCard
  const myRank = dossier.ranks?.items.find(r => r.studentId === studentId)

  const feeTotal = dossier.invoices.reduce((a, i) => a + i.total, 0)
  const feePaid = dossier.invoices.reduce((a, i) => a + i.paid, 0)
  const feeDue = Math.max(0, feeTotal - feePaid)

  const downloadTxt = () => {
    const lines = [
      `EduNova Student Profile Report`,
      `Generated: ${new Date().toLocaleString('en-IN')}`,
      ``,
      `Student: ${student.name}`,
      `Email: ${student.email}`,
      ``,
      `Attendance`,
      attendance ? `  Present: ${attendance.overall.present} / ${attendance.overall.total} (${attPct}%)` : `  No data`,
      ``,
      `Marks`,
      ...(rc ? [`  Overall: ${rc.overall.grade} (${Math.round(rc.overall.pct)}%)`, ...rc.subjects.map(s => `    ${s.subject}: ${s.grade} (${s.total}/${s.max})`)] : ['  No marks published yet']),
      ``,
      `Rank`,
      `  ${myRank ? `#${myRank.rank} of ${dossier.ranks?.assessments ?? '—'}` : '—'}`,
      ``,
      `Achievements`,
      ...(dossier.achievements.length ? dossier.achievements.map(a => `  ${a.date}: ${a.title} — ${a.detail}`) : ['  None']),
      ``,
      `Fees`,
      `  Total: ${fmtINR(feeTotal)}`,
      `  Paid: ${fmtINR(feePaid)}`,
      `  Due: ${fmtINR(feeDue)}`,
      ...(dossier.invoices.length ? dossier.invoices.map(i => `  ${i.id} · ${i.status} · ${fmtINR(i.total)}`) : ['  No invoices']),
      ``,
      `Meetings & calls`,
      ...(dossier.meetings.length ? dossier.meetings.map(m => `  ${m.purpose} (${m.status})`) : ['  No meetings']),
      ...(dossier.calls.length ? dossier.calls.map(c => `  Call · ${c.reason} · ${c.outcome} · ${c.durationMin ? c.durationMin + 'min' : ''}`) : ['  No calls']),
      ``,
      `Disciplinary cases`,
      ...(dossier.discipline.length ? dossier.discipline.map(d => `  ${d.title} · ${d.status} · ${d.actionTaken || 'No action'}`) : ['  None']),
      ``,
      `Certificates / applications`,
      ...((certificates ?? []).length ? (certificates ?? []).map(c => `  ${c.kind} · ${c.serialNo} · issued ${c.issuedAt.slice(0, 10)}`) : ['  None']),
      ``,
      `Health records`,
      ...(dossier.health.length ? dossier.health.map(h => `  ${h.date}: ${h.title} — ${h.detail}`) : ['  None']),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${student.name.replace(/\s+/g, '_')}_report.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      <PageHead title="Student Profile Report" sub={`${student.name} · comprehensive dossier`}>
        <button onClick={downloadTxt} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold">
          <Download size={15} /> Download report
        </button>
      </PageHead>

      {/* profile */}
      <Card>
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-indigo-500 text-white font-display text-xl font-medium">
            {student.name.split(' ').map(w => w[0]).slice(0, 2).join('')}
          </div>
          <div className="flex-1">
            <p className="font-display text-xl font-medium">{student.name}</p>
            <p className="text-[14px] text-black/50 dark:text-white/50">{student.email}</p>
            {dossier.ranks?.classLabel && <div className="mt-3 flex flex-wrap gap-2"><Pill tone="sky">{dossier.ranks.classLabel}</Pill></div>}
          </div>
        </div>
      </Card>

      {/* attendance */}
      <Card>
        <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><Users size={15} /> Attendance summary</p>
        {attendance ? (
          <>
            <div className="grid gap-4 sm:grid-cols-4">
              <div><p className="text-[12px] text-black/50 dark:text-white/50">Present</p><p className="font-display text-2xl font-medium text-emerald-600">{attendance.overall.present}</p></div>
              <div><p className="text-[12px] text-black/50 dark:text-white/50">Total sessions</p><p className="font-display text-2xl font-medium">{attendance.overall.total}</p></div>
              <div><p className="text-[12px] text-black/50 dark:text-white/50">Attendance %</p><p className="font-display text-2xl font-medium">{attPct}%</p></div>
            </div>
            <div className="mt-4"><Progress pct={attPct} color="#10b981" /></div>
          </>
        ) : <Empty text="No attendance data for this term." />}
      </Card>

      {/* marks */}
      <Card>
        <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><TrendingUp size={15} /> Marks & grades</p>
        {rc ? (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="font-semibold">This term</p>
              <Pill tone={statusTone(rc.overall.grade)}>{rc.overall.grade} · {Math.round(rc.overall.pct)}%</Pill>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {rc.subjects.map(s => (
                <div key={s.subject} className="rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3">
                  <p className="text-[13px] font-semibold">{s.subject}</p>
                  <p className="text-[12px] text-black/50 dark:text-white/50">{s.total}/{s.max} · Grade {s.grade}</p>
                  <div className="mt-1.5"><Progress pct={Math.round(s.pct)} color="#6366f1" /></div>
                </div>
              ))}
            </div>
          </div>
        ) : <Empty text="No marks published yet." />}
      </Card>

      {/* rank */}
      <Card>
        <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><TrendingUp size={15} /> Class rank</p>
        {myRank ? (
          <p className="font-display text-3xl font-medium">#{myRank.rank} <span className="text-[14px] font-normal text-black/50 dark:text-white/50">of {dossier.ranks?.assessments} assessed</span></p>
        ) : <Empty text="No rank data for this term." />}
      </Card>

      {/* achievements */}
      <Card>
        <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><FileText size={15} /> Achievements & co-curricular</p>
        {dossier.achievements.length > 0 ? (
          <div className="space-y-3">
            {dossier.achievements.map(a => (
              <div key={a.id} className="flex items-start justify-between rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3.5">
                <div>
                  <p className="text-[14px] font-semibold">{a.title}</p>
                  <p className="text-[12.5px] text-black/50 dark:text-white/50">{a.detail}</p>
                </div>
                <Pill tone="green">{a.date}</Pill>
              </div>
            ))}
          </div>
        ) : <Empty text="No achievements recorded yet." />}
      </Card>

      {/* fees */}
      <Card>
        <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><Phone size={15} /> Fees & payments</p>
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <div><p className="text-[12px] text-black/50 dark:text-white/50">Total</p><p className="font-display text-xl font-medium">{fmtINR(feeTotal)}</p></div>
          <div><p className="text-[12px] text-black/50 dark:text-white/50">Paid</p><p className="font-display text-xl font-medium text-emerald-600">{fmtINR(feePaid)}</p></div>
          <div><p className="text-[12px] text-black/50 dark:text-white/50">Due</p><p className="font-display text-xl font-medium text-rose-500">{fmtINR(feeDue)}</p></div>
        </div>
        {dossier.invoices.length > 0 ? (
          <div className="space-y-2">
            {dossier.invoices.map(i => (
              <div key={i.id} className="flex items-center justify-between rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3.5">
                <p className="text-[12.5px] text-black/50 dark:text-white/50">Due {i.dueDate}</p>
                <div className="flex items-center gap-3">
                  <span className="text-[14px] font-semibold">{fmtINR(i.total)}</span>
                  <Pill tone={statusTone(i.status)}>{i.status}</Pill>
                </div>
              </div>
            ))}
          </div>
        ) : <Empty text="No fee invoices on record." />}
      </Card>

      {/* meetings & calls */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><Users size={15} /> Meetings</p>
          {dossier.meetings.length > 0 ? (
            <div className="space-y-3">
              {dossier.meetings.map(m => (
                <div key={m.id} className="rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[14px] font-semibold">{m.purpose}</p>
                    <Pill tone={statusTone(m.status)}>{m.status}</Pill>
                  </div>
                  <p className="text-[12.5px] text-black/50 dark:text-white/50">{new Date(m.scheduledAt).toLocaleString('en-IN')}</p>
                </div>
              ))}
            </div>
          ) : <Empty text="No meetings scheduled." />}
        </Card>
        <Card>
          <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><Phone size={15} /> Call log</p>
          {dossier.calls.length > 0 ? (
            <div className="space-y-3">
              {dossier.calls.map(c => (
                <div key={c.id} className="rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[14px] font-semibold capitalize">{c.reason}</p>
                    <Pill tone={statusTone(c.outcome)}>{c.outcome}</Pill>
                  </div>
                  <p className="text-[12.5px] text-black/50 dark:text-white/50">{c.summary}</p>
                </div>
              ))}
            </div>
          ) : <Empty text="No calls logged." />}
        </Card>
      </div>

      {/* disciplinary */}
      <Card>
        <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Disciplinary cases</p>
        {dossier.discipline.length > 0 ? (
          <div className="space-y-3">
            {dossier.discipline.map(d => (
              <div key={d.id} className="rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[14px] font-semibold">{d.title}</p>
                  <Pill tone={statusTone(d.status)}>{d.status}</Pill>
                </div>
                <p className="text-[12.5px] text-black/50 dark:text-white/50">{d.description}</p>
                {d.actionTaken && <p className="mt-1 text-[12px] font-semibold text-rose-500">Action: {d.actionTaken}</p>}
              </div>
            ))}
          </div>
        ) : <Empty text="No disciplinary cases on record." />}
      </Card>

      {/* certificates & health */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><FileText size={15} /> Certificates</p>
          {(certificates ?? []).length > 0 ? (
            <div className="space-y-3">
              {(certificates ?? []).map(c => (
                <div key={c.id} className="flex items-center justify-between rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3.5">
                  <div>
                    <p className="text-[14px] font-semibold">{c.kind}</p>
                    <p className="text-[12.5px] text-black/50 dark:text-white/50">{c.serialNo} · issued {c.issuedAt.slice(0, 10)}</p>
                  </div>
                  <button onClick={() => downloadPath(`/certificates/${c.id}/pdf`, `${c.kind}-${c.serialNo}.pdf`)} className="rounded-full bg-black/[.05] dark:bg-white/[.08] px-3 py-1.5 text-[12px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Download</button>
                </div>
              ))}
            </div>
          ) : <Empty text="No certificates issued." />}
        </Card>
        <Card>
          <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><HeartPulse size={15} /> Health records</p>
          {dossier.health.length > 0 ? (
            <div className="space-y-3">
              {dossier.health.map(h => (
                <div key={h.id} className="flex items-center justify-between rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3.5">
                  <div>
                    <p className="text-[14px] font-semibold">{h.title}</p>
                    <p className="text-[12.5px] text-black/50 dark:text-white/50">{h.detail}</p>
                  </div>
                  <Pill tone={h.verifiedAt ? 'green' : 'amber'}>{h.verifiedAt ? 'Verified' : 'Unverified'}</Pill>
                </div>
              ))}
            </div>
          ) : <Empty text="No health records on file." />}
        </Card>
      </div>
    </div>
  )
}
