import { useMemo } from 'react'
import { Download, FileText, HeartPulse, Phone, School, TrendingUp, Users } from 'lucide-react'
import { useStore } from '@/lib/store'
import { fmtINR, gradeFor, pctFor } from '@/lib/data'
import { Card, Empty, PageHead, Pill, Progress } from '../ui'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar, Legend,
} from 'recharts'

interface StudentReportModProps {
  studentId: string
}

export function StudentReportMod({ studentId }: StudentReportModProps) {
  const { db } = useStore()
  const student = db.users.find(u => u.id === studentId && u.role === 'student')
  const board = db.boardDetails[studentId]

  const attendanceRecords = db.attendanceRecords.filter(r => r.userId === studentId)
  const attendanceSummary = useMemo(() => {
    const p = attendanceRecords.filter(r => r.status === 'P').length
    const a = attendanceRecords.filter(r => r.status === 'A').length
    const l = attendanceRecords.filter(r => r.status === 'L').length
    const h = attendanceRecords.filter(r => r.status === 'H').length
    const total = p + a + l // exclude holidays from working days
    const pct = total ? Math.round((p / total) * 100) : 0
    return { p, a, l, h, total, pct }
  }, [attendanceRecords])

  const attendanceByMonth = useMemo(() => {
    const map: Record<string, { month: string; present: number; absent: number; leave: number }> = {}
    attendanceRecords.forEach(r => {
      const month = r.date.slice(0, 7)
      if (!map[month]) map[month] = { month, present: 0, absent: 0, leave: 0 }
      if (r.status === 'P') map[month].present += 1
      else if (r.status === 'A') map[month].absent += 1
      else if (r.status === 'L') map[month].leave += 1
    })
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month))
  }, [attendanceRecords])

  const marksByTerm = useMemo(() => {
    return db.terms.map(term => {
      const rows = db.marks[term.id] ?? []
      const subjects = rows.map(row => {
        const pct = pctFor(row)
        return { subject: row.subject, grade: gradeFor(row), pct, score: row.assessments.reduce((a, x) => a + x.score, 0), max: row.assessments.reduce((a, x) => a + x.max, 0) }
      })
      const totalScore = subjects.reduce((a, s) => a + s.score, 0)
      const totalMax = subjects.reduce((a, s) => a + s.max, 0)
      return {
        termId: term.id,
        termName: term.name,
        subjects,
        totalScore,
        totalMax,
        overallPct: totalMax ? Math.round((totalScore / totalMax) * 100) : 0,
        overallGrade: totalMax ? gradeFor({ subject: 'Overall', assessments: [{ name: 'Total', score: totalScore, max: totalMax }] }) : '—',
      }
    })
  }, [db.marks, db.terms])

  const rankHistory = useMemo(() => {
    return db.terms.map(term => {
      const overall = db.ranks[term.id]?.overall ?? []
      const row = overall.find(r => r.name === student?.name)
      return { term: term.name, rank: row?.rank ?? null, score: row?.score ?? null }
    })
  }, [db.ranks, db.terms, student?.name])

  const achievements = db.achievements.filter(a => a.by === student?.name)
  const receipts = db.receipts.filter(r => r.studentId === studentId && r.kind === 'fee')
  const feeTotal = receipts.reduce((a, r) => a + r.amount, 0)
  const feePaid = receipts.filter(r => r.status === 'Paid').reduce((a, r) => a + r.amount, 0)
  const feeDue = receipts.filter(r => r.status === 'Due').reduce((a, r) => a + r.amount, 0)

  const meetings = db.meetings.filter(m => m.studentId === studentId)
  const calls = db.aiParentCalls.filter(c => c.studentId === studentId)
  const disciplinary = db.disciplinaryCases.filter(c => c.studentId === studentId)
  const certificates = db.applications.filter(a => a.studentId === studentId)
  const healthRecords = db.health

  if (!student) {
    return (
      <div>
        <PageHead title="Student Profile Report" sub="Comprehensive student dossier" />
        <Card><Empty text="Student not found." /></Card>
      </div>
    )
  }

  const downloadTxt = () => {
    const lines = [
      `EduNova Student Profile Report`,
      `Generated: ${new Date().toLocaleString('en-IN')}`,
      ``,
      `Student: ${student.name}`,
      `Class: ${student.class ?? '—'}${student.section ? '-' + student.section : ''}`,
      `Roll: ${student.roll ?? '—'}`,
      `Email: ${student.email}`,
      `Parent email: ${student.parentEmail ?? '—'}`,
      `Board: ${student.board ?? '—'}`,
      board ? `Board registration: ${board.registrationNo}` : '',
      ``,
      `Attendance`,
      `  Present: ${attendanceSummary.p}`,
      `  Absent: ${attendanceSummary.a}`,
      `  Leave: ${attendanceSummary.l}`,
      `  Holidays: ${attendanceSummary.h}`,
      `  Attendance %: ${attendanceSummary.pct}%`,
      ``,
      `Marks`,
      ...marksByTerm.flatMap(t => [
        `  ${t.termName}: ${t.overallGrade} (${t.overallPct}%)`,
        ...t.subjects.map(s => `    ${s.subject}: ${s.grade} (${s.score}/${s.max})`),
      ]),
      ``,
      `Rank history`,
      ...rankHistory.map(r => `  ${r.term}: ${r.rank ? '#' + r.rank : '—'}`),
      ``,
      `Achievements`,
      ...(achievements.length ? achievements.map(a => `  ${a.date}: ${a.title} — ${a.detail}`) : ['  None']),
      ``,
      `Fees`,
      `  Total: ${fmtINR(feeTotal)}`,
      `  Paid: ${fmtINR(feePaid)}`,
      `  Due: ${fmtINR(feeDue)}`,
      ...(receipts.length ? receipts.map(r => `  ${r.label} · ${r.status} · ${fmtINR(r.amount)}`) : ['  No receipts']),
      ``,
      `Meetings & calls`,
      ...(meetings.length ? meetings.map(m => `  ${m.slot}: ${m.purpose} (${m.status})`) : ['  No meetings']),
      ...(calls.length ? calls.map(c => `  AI call · ${c.reason} · ${c.status} · ${c.duration ? c.duration + 's' : ''}`) : ['  No calls']),
      ``,
      `Disciplinary cases`,
      ...(disciplinary.length ? disciplinary.map(d => `  ${d.title} · ${d.status} · ${d.actionTaken || 'No action'}`) : ['  None']),
      ``,
      `Certificates / applications`,
      ...(certificates.length ? certificates.map(c => `  ${c.kind} · ${c.name} · ${c.status}`) : ['  None']),
      ``,
      `Health records`,
      ...(healthRecords.length ? healthRecords.map(h => `  ${h.date}: ${h.label} — ${h.detail}`) : ['  None']),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${student.name.replace(/\s+/g, '_')}_report.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const statusTone = (s: string) => {
    if (['Paid', 'Approved', 'Completed', 'Submitted', 'Closed', 'Verified', 'Sealed', 'Published'].includes(s)) return 'green' as const
    if (['Pending', 'Due', 'Requested', 'Scheduled', 'Assigned', 'TeacherSigned', 'Draft'].includes(s)) return 'amber' as const
    if (['Declined', 'Late', 'Failed', 'Cancelled', 'Action Taken', 'Expulsion', 'Suspension'].includes(s)) return 'rose' as const
    return 'slate' as const
  }

  return (
    <div className="space-y-5">
      <PageHead title="Student Profile Report" sub={`${student.name} · comprehensive dossier`}>
        <button onClick={downloadTxt} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold">
          <Download size={15} /> Download report
        </button>
      </PageHead>

      {/* profile */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-indigo-500 text-white font-display text-xl font-medium">
              {student.name.split(' ').map(w => w[0]).slice(0, 2).join('')}
            </div>
            <div className="flex-1">
              <p className="font-display text-xl font-medium">{student.name}</p>
              <p className="text-[14px] text-black/50 dark:text-white/50">{student.email}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Pill tone="sky">{student.class}{student.section ? '-' + student.section : ''}</Pill>
                <Pill tone="indigo">Roll {student.roll ?? '—'}</Pill>
                <Pill tone="green">{student.board ?? '—'}</Pill>
              </div>
            </div>
          </div>
        </Card>
        <Card>
          <p className="mb-3 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><School size={15} /> Board details</p>
          {board ? (
            <div className="grid grid-cols-2 gap-3 text-[14px]">
              <div><span className="text-black/50 dark:text-white/50">Registration</span><p className="font-semibold">{board.registrationNo}</p></div>
              <div><span className="text-black/50 dark:text-white/50">Roll no.</span><p className="font-semibold">{board.rollNo}</p></div>
              <div><span className="text-black/50 dark:text-white/50">School</span><p className="font-semibold">{board.schoolName}</p></div>
              <div><span className="text-black/50 dark:text-white/50">DOB</span><p className="font-semibold">{board.dob}</p></div>
              <div><span className="text-black/50 dark:text-white/50">Class</span><p className="font-semibold">{board.class}-{board.section}</p></div>
              <div><span className="text-black/50 dark:text-white/50">Year</span><p className="font-semibold">{board.year}</p></div>
              {board.affiliationNo && <div><span className="text-black/50 dark:text-white/50">Affiliation</span><p className="font-semibold">{board.affiliationNo}</p></div>}
            </div>
          ) : (
            <Empty text="No board details on file." />
          )}
        </Card>
      </div>

      {/* attendance */}
      <Card>
        <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><Users size={15} /> Attendance summary</p>
        <div className="grid gap-4 sm:grid-cols-4">
          <div><p className="text-[12px] text-black/50 dark:text-white/50">Present</p><p className="font-display text-2xl font-medium text-emerald-600">{attendanceSummary.p}</p></div>
          <div><p className="text-[12px] text-black/50 dark:text-white/50">Absent</p><p className="font-display text-2xl font-medium text-rose-500">{attendanceSummary.a}</p></div>
          <div><p className="text-[12px] text-black/50 dark:text-white/50">Leave</p><p className="font-display text-2xl font-medium text-amber-500">{attendanceSummary.l}</p></div>
          <div><p className="text-[12px] text-black/50 dark:text-white/50">Attendance %</p><p className="font-display text-2xl font-medium">{attendanceSummary.pct}%</p></div>
        </div>
        <div className="mt-4"><Progress pct={attendanceSummary.pct} color="#10b981" /></div>
        {attendanceByMonth.length > 0 && (
          <div className="mt-6 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={attendanceByMonth}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="present" stackId="a" fill="#10b981" />
                <Bar dataKey="leave" stackId="a" fill="#f59e0b" />
                <Bar dataKey="absent" stackId="a" fill="#ef4444" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* marks */}
      <Card>
        <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><TrendingUp size={15} /> Marks & grades</p>
        <div className="space-y-5">
          {marksByTerm.map(t => (
            <div key={t.termId}>
              <div className="mb-2 flex items-center justify-between">
                <p className="font-semibold">{t.termName}</p>
                <Pill tone={statusTone(t.overallGrade)}>{t.overallGrade} · {t.overallPct}%</Pill>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {t.subjects.map(s => (
                  <div key={s.subject} className="rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3">
                    <p className="text-[13px] font-semibold">{s.subject}</p>
                    <p className="text-[12px] text-black/50 dark:text-white/50">{s.score}/{s.max} · Grade {s.grade}</p>
                    <div className="mt-1.5"><Progress pct={s.pct} color="#6366f1" /></div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* ranks */}
      <Card>
        <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><TrendingUp size={15} /> Rank history</p>
        {rankHistory.some(r => r.rank) ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rankHistory.map(r => ({ ...r, rank: r.rank ?? undefined }))}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="term" tick={{ fontSize: 12 }} />
                <YAxis reversed tick={{ fontSize: 12 }} />
                <Tooltip />
                <Line type="monotone" dataKey="rank" stroke="#6366f1" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <Empty text="No rank data for this student." />
        )}
      </Card>

      {/* achievements */}
      <Card>
        <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><FileText size={15} /> Achievements & co-curricular</p>
        {achievements.length > 0 ? (
          <div className="space-y-3">
            {achievements.map(a => (
              <div key={a.id} className="flex items-start justify-between rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3.5">
                <div>
                  <p className="text-[14px] font-semibold">{a.title}</p>
                  <p className="text-[12.5px] text-black/50 dark:text-white/50">{a.detail}</p>
                </div>
                <Pill tone="green">{a.date}</Pill>
              </div>
            ))}
          </div>
        ) : (
          <Empty text="No achievements recorded yet." />
        )}
      </Card>

      {/* fees */}
      <Card>
        <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><Phone size={15} /> Fees & payments</p>
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <div><p className="text-[12px] text-black/50 dark:text-white/50">Total</p><p className="font-display text-xl font-medium">{fmtINR(feeTotal)}</p></div>
          <div><p className="text-[12px] text-black/50 dark:text-white/50">Paid</p><p className="font-display text-xl font-medium text-emerald-600">{fmtINR(feePaid)}</p></div>
          <div><p className="text-[12px] text-black/50 dark:text-white/50">Due</p><p className="font-display text-xl font-medium text-rose-500">{fmtINR(feeDue)}</p></div>
        </div>
        {receipts.length > 0 ? (
          <div className="space-y-2">
            {receipts.map(r => (
              <div key={r.id} className="flex items-center justify-between rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3.5">
                <div>
                  <p className="text-[14px] font-semibold">{r.label}</p>
                  <p className="text-[12.5px] text-black/50 dark:text-white/50">{r.date}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[14px] font-semibold">{fmtINR(r.amount)}</span>
                  <Pill tone={statusTone(r.status)}>{r.status}</Pill>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty text="No fee receipts on record." />
        )}
      </Card>

      {/* meetings & calls */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><Users size={15} /> Meetings</p>
          {meetings.length > 0 ? (
            <div className="space-y-3">
              {meetings.map(m => (
                <div key={m.id} className="rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[14px] font-semibold">{m.purpose}</p>
                    <Pill tone={statusTone(m.status)}>{m.status}</Pill>
                  </div>
                  <p className="text-[12.5px] text-black/50 dark:text-white/50">{m.slot} · {m.requesterName} ({m.requesterRole})</p>
                </div>
              ))}
            </div>
          ) : (
            <Empty text="No meetings scheduled." />
          )}
        </Card>
        <Card>
          <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><Phone size={15} /> AI parent calls</p>
          {calls.length > 0 ? (
            <div className="space-y-3">
              {calls.map(c => (
                <div key={c.id} className="rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[14px] font-semibold capitalize">{c.reason}</p>
                    <Pill tone={statusTone(c.status)}>{c.status}</Pill>
                  </div>
                  <p className="text-[12.5px] text-black/50 dark:text-white/50">{c.reasonText}</p>
                  {c.outcome && <p className="mt-1 text-[12px] text-black/50 dark:text-white/50">Outcome: {c.outcome}</p>}
                </div>
              ))}
            </div>
          ) : (
            <Empty text="No AI calls logged." />
          )}
        </Card>
      </div>

      {/* disciplinary */}
      <Card>
        <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Disciplinary cases</p>
        {disciplinary.length > 0 ? (
          <div className="space-y-3">
            {disciplinary.map(d => (
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
        ) : (
          <Empty text="No disciplinary cases on record." />
        )}
      </Card>

      {/* certificates & health */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><FileText size={15} /> Certificates / applications</p>
          {certificates.length > 0 ? (
            <div className="space-y-3">
              {certificates.map(c => (
                <div key={c.id} className="flex items-center justify-between rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3.5">
                  <div>
                    <p className="text-[14px] font-semibold">{c.kind}</p>
                    <p className="text-[12.5px] text-black/50 dark:text-white/50">{c.name}</p>
                  </div>
                  <Pill tone={statusTone(c.status)}>{c.status}</Pill>
                </div>
              ))}
            </div>
          ) : (
            <Empty text="No certificates issued." />
          )}
        </Card>
        <Card>
          <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><HeartPulse size={15} /> Health records</p>
          {healthRecords.length > 0 ? (
            <div className="space-y-3">
              {healthRecords.map(h => (
                <div key={h.id} className="flex items-center justify-between rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3.5">
                  <div>
                    <p className="text-[14px] font-semibold">{h.label}</p>
                    <p className="text-[12.5px] text-black/50 dark:text-white/50">{h.detail}</p>
                  </div>
                  <Pill tone={h.signed ? 'green' : 'amber'}>{h.signed ? 'Signed' : 'Pending'}</Pill>
                </div>
              ))}
            </div>
          ) : (
            <Empty text="No health records on file." />
          )}
        </Card>
      </div>
    </div>
  )
}
