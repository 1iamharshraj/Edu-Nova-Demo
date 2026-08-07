import React, { createContext, useContext, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  Award, BadgeCheck, BookOpen, BrainCircuit, CalendarDays, CalendarPlus, ClipboardCheck,
  CreditCard, FileBadge, HeartPulse, Home, LayoutGrid,
  LogOut, Megaphone, MessagesSquare, PartyPopper, PencilLine, Play, RotateCcw, ScrollText,
  ShieldCheck, Sparkles, Trophy, Umbrella, Users, Video, Wallet,
} from 'lucide-react'
import { Logo } from '@/components/Logo'
import { useStore } from '@/lib/store'
import { ThemeToggle } from '@/lib/theme'
import { InstallButton } from '@/lib/pwa'
import type { Role } from '@/lib/data'
import { Avatar, Pill } from './ui'
import { AttendanceMod, CalendarMod, MarksMod, RanksMod, TeachersMod, TimetableMod } from './modules/academics'
import { AIDoubtsMod, FeedMod, HighlightsMod, MessagesMod } from './modules/social'
import { AchievementsMod, HealthMod, HomeworkMod, LeaveMod, PaymentsMod, SlipsMod } from './modules/actions'
import {
  ApplicationsMod, AttendanceMgmtMod, CalendarAdminMod, ContractMod, CreateAssignmentMod,
  FeesMod, GradeUploadMod, MarksheetMod, PeopleMod, RegistrationsMod, TakeAttendanceMod, WorkAssignMod,
} from './modules/office'
import { toast } from 'sonner'

/* ── term context ──────────────────────────────────────── */

const TermCtx = createContext<{ term: string; setTerm: (t: string) => void }>({ term: 't3', setTerm: () => {} })
export const useTerm = () => useContext(TermCtx)

/* ── module registry ───────────────────────────────────── */

interface Mod { id: string; label: string; icon: any; el: React.ReactNode; group: string }

function modulesFor(role: Role): Mod[] {
  const M = (id: string, label: string, icon: any, el: React.ReactNode, group: string): Mod => ({ id, label, icon, el, group })
  switch (role) {
    case 'parent': return [
      M('home', 'Overview', Home, <Overview />, 'Main'),
      M('tt', 'Timetable', CalendarDays, <TimetableMod />, 'Academics'),
      M('att', 'Attendance', ClipboardCheck, <AttendanceMod />, 'Academics'),
      M('marks', 'Marks & Grades', PencilLine, <MarksMod />, 'Academics'),
      M('ranks', 'Rank List', Trophy, <RanksMod />, 'Academics'),
      M('cal', 'Calendar', CalendarPlus, <CalendarMod />, 'Academics'),
      M('teachers', 'Teachers', Users, <TeachersMod />, 'Academics'),
      M('feed', 'School Feed', Megaphone, <FeedMod />, 'Community'),
      M('msgs', 'Teacher Messages', MessagesSquare, <MessagesMod />, 'Community'),
      M('hl', 'Event Highlights', Video, <HighlightsMod />, 'Community'),
      M('hw', 'Homework Status', BookOpen, <HomeworkMod />, 'Actions'),
      M('slips', 'Permission Slips', ShieldCheck, <SlipsMod />, 'Actions'),
      M('leave', 'Holiday Requests', Umbrella, <LeaveMod />, 'Actions'),
      M('health', 'Health Records', HeartPulse, <HealthMod />, 'Actions'),
      M('ach', 'Achievements', Award, <AchievementsMod />, 'Actions'),
      M('pay', 'Payments & Receipts', CreditCard, <PaymentsMod />, 'Office'),
      M('apps', 'TC & Bonafide', FileBadge, <ApplicationsMod approver={false} />, 'Office'),
      M('pta', 'Online PTA', Sparkles, <PTAMod />, 'Office'),
      M('msheet', 'Marksheet Validation', BadgeCheck, <MarksheetMod />, 'Office'),
    ]
    case 'student': return [
      M('home', 'Overview', Home, <Overview />, 'Main'),
      M('tt', 'Timetable', CalendarDays, <TimetableMod />, 'Academics'),
      M('att', 'Attendance', ClipboardCheck, <AttendanceMod />, 'Academics'),
      M('marks', 'Marks & Grades', PencilLine, <MarksMod />, 'Academics'),
      M('ranks', 'Rank List', Trophy, <RanksMod />, 'Academics'),
      M('cal', 'Calendar', CalendarPlus, <CalendarMod />, 'Academics'),
      M('hw', 'Homework Upload', BookOpen, <HomeworkMod uploader />, 'Academics'),
      M('ai', 'AI Doubt Clearing', BrainCircuit, <AIDoubtsMod />, 'Academics'),
      M('feed', 'School Feed', Megaphone, <FeedMod />, 'Community'),
      M('hl', 'Event Highlights', Video, <HighlightsMod />, 'Community'),
      M('ffcs', 'Clubs & Chapters', Users, <RegistrationsMod kind="ffcs" title="Clubs & Chapters (FFCS)" sub="Fully flexible club selection — pick what moves you" />, 'Activities'),
      M('iha', 'Inter-House (IHA)', PartyPopper, <RegistrationsMod kind="iha" title="Inter-House Activities" sub="Represent your house this term" />, 'Activities'),
      M('exc', 'Extra-Curricular (EXC)', Sparkles, <RegistrationsMod kind="exc" title="EXC Registrations" sub="Weekend extra-curricular coaching" />, 'Activities'),
      M('events', 'Event Registration', Play, <RegistrationsMod kind="events" title="Event Registration" sub="Sign up for upcoming school events" />, 'Activities'),
    ]
    case 'teacher': return [
      M('home', 'Overview', Home, <Overview />, 'Main'),
      M('take', 'Take Attendance', ClipboardCheck, <TakeAttendanceMod />, 'Classroom'),
      M('assign', 'Create Assignment', BookOpen, <CreateAssignmentMod />, 'Classroom'),
      M('grades', 'Upload Grades', PencilLine, <GradeUploadMod />, 'Classroom'),
      M('tt', 'My Timetable', CalendarDays, <TimetableMod />, 'Classroom'),
      M('msgs', 'Parent Messages', MessagesSquare, <MessagesMod />, 'Classroom'),
      M('lapprove', 'Leave Approvals', Umbrella, <LeaveMod approver />, 'Classroom'),
      M('msheet', 'Marksheet Validation', BadgeCheck, <MarksheetMod />, 'Classroom'),
      M('salary', 'Salary Receipts', Wallet, <PaymentsMod salary />, 'My HR'),
      M('myleave', 'My Leave', Umbrella, <TeacherLeaveMod />, 'My HR'),
      M('contract', 'Contract & Notice', ScrollText, <ContractMod />, 'My HR'),
      M('work', 'Event Duties', PartyPopper, <WorkAssignMod />, 'My HR'),
      M('freg', 'Faculty Events', Play, <RegistrationsMod kind="faculty" title="Faculty Event Registration" sub="Workshops and panels for teachers" />, 'My HR'),
      M('ach', 'My Achievements', Award, <AchievementsMod />, 'My HR'),
    ]
    case 'staff': return [
      M('home', 'Overview', Home, <Overview />, 'Main'),
      M('attm', 'Attendance Mgmt', ClipboardCheck, <AttendanceMgmtMod />, 'Operations'),
      M('people', 'People', Users, <PeopleMod />, 'Operations'),
      M('apps', 'Applications', FileBadge, <ApplicationsMod />, 'Operations'),
      M('leaves', 'Leave Approvals', Umbrella, <LeaveMod approver />, 'Operations'),
      M('calm', 'Calendar Mgmt', CalendarPlus, <CalendarAdminMod />, 'Operations'),
      M('work', 'Work Assignment', PartyPopper, <WorkAssignMod manage />, 'Operations'),
      M('fees', 'Fees', CreditCard, <FeesMod />, 'Finance'),
      M('pay', 'Fee Receipts', Wallet, <PaymentsMod />, 'Finance'),
      M('salary', 'Salary Receipts', ScrollText, <PaymentsMod salary />, 'Finance'),
    ]
    case 'admin': return [
      M('home', 'Overview', Home, <Overview />, 'Main'),
      M('people', 'People & Roles', Users, <PeopleMod />, 'Manage'),
      M('apps', 'Admissions & Certs', FileBadge, <ApplicationsMod />, 'Manage'),
      M('attm', 'Attendance', ClipboardCheck, <AttendanceMgmtMod />, 'Manage'),
      M('leaves', 'Leave Approvals', Umbrella, <LeaveMod approver />, 'Manage'),
      M('calm', 'Calendar', CalendarPlus, <CalendarAdminMod />, 'Manage'),
      M('work', 'Work Assignment', PartyPopper, <WorkAssignMod manage />, 'Manage'),
      M('msheet', 'Marksheet Validation', BadgeCheck, <MarksheetMod />, 'Manage'),
      M('fees', 'Fees', CreditCard, <FeesMod />, 'Finance'),
      M('salary', 'Faculty Salary', Wallet, <PaymentsMod salary />, 'Finance'),
    ]
  }
}

/* ── small inline modules ──────────────────────────────── */

function PTAMod() {
  const [booked, setBooked] = useState<string | null>(null)
  const slots = ['Fri 4:00 PM', 'Fri 4:20 PM', 'Fri 4:40 PM', 'Sat 10:00 AM', 'Sat 10:20 AM']
  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-[clamp(1.6rem,3vw,2.2rem)] font-medium tracking-tight">Online PTA</h1>
        <p className="mt-1 text-[14px] text-black/50 dark:text-white/50">Book a 20-minute video slot with Aarav’s class teacher</p>
      </div>
      <div className="grid max-w-2xl gap-3">
        {slots.map(s => (
          <button key={s} onClick={() => { setBooked(s); toast.success(`PTA slot booked — link will appear here`) }}
            className={`flex items-center justify-between rounded-2xl border p-5 text-left transition-all ${booked === s ? 'border-emerald-300 bg-emerald-50' : 'border-black/[.07] dark:border-white/[.09] bg-white dark:bg-[#14141f] hover:border-indigo-300'}`}>
            <span className="text-[15px] font-semibold">{s} · Meera Krishnan</span>
            {booked === s ? <Pill tone="green">Booked · join link sent</Pill> : <Pill tone="slate">Available</Pill>}
          </button>
        ))}
      </div>
    </div>
  )
}

function TeacherLeaveMod() {
  const [list, setList] = useState<{ from: string; to: string; reason: string; status: string }[]>([
    { from: '2026-02-13', to: '2026-02-14', reason: 'Family wedding', status: 'Approved' },
  ])
  const [reason, setReason] = useState('')
  const apply = () => {
    setList(l => [{ from: '2026-04-29', to: '2026-04-30', reason, status: 'Pending' }, ...l])
    setReason(''); toast.success('Leave request sent to admin')
  }
  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-[clamp(1.6rem,3vw,2.2rem)] font-medium tracking-tight">My Leave</h1>
        <p className="mt-1 text-[14px] text-black/50 dark:text-white/50">12 of 18 paid days remaining this year</p>
      </div>
      <div className="grid max-w-3xl gap-5">
        <div className="rounded-3xl border border-black/[.06] dark:border-white/[.08] bg-white dark:bg-[#14141f] p-6">
          <div className="flex gap-3">
            <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason for leave (29–30 Apr)…"
              className="w-full rounded-xl border border-black/10 dark:border-white/15 px-4 py-2.5 text-[14px] outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" />
            <button onClick={apply} disabled={!reason.trim()} className="btn-ink px-6 text-[13.5px] font-semibold disabled:opacity-40">Apply</button>
          </div>
        </div>
        {list.map((l, i) => (
          <div key={i} className="flex items-center gap-4 rounded-3xl border border-black/[.06] dark:border-white/[.08] bg-white dark:bg-[#14141f] p-5">
            <div className="flex-1">
              <p className="text-[14.5px] font-semibold">{l.reason}</p>
              <p className="text-[12.5px] text-black/45 dark:text-white/45">{l.from} → {l.to}</p>
            </div>
            <Pill tone={l.status === 'Approved' ? 'green' : 'amber'}>{l.status}</Pill>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── overview dashboards ───────────────────────────────── */

function Overview() {
  const { db, user } = useStore()
  const { setTerm: _st } = useTerm()
  void _st
  const role = user!.role
  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const cards: { k: string; v: string; s: string; tone: string }[] = useMemo(() => {
    const att = db.attendance.t3
    const overall = Math.round(att.bySubject.reduce((a, s) => a + s.present, 0) / att.bySubject.reduce((a, s) => a + s.total, 0) * 100)
    const pendingHw = db.homework.filter(h => h.term === 't3' && (h.status === 'Pending' || h.status === 'Late')).length
    const slips = db.slips.filter(s => s.status === 'Pending').length
    switch (role) {
      case 'parent': return [
        { k: 'Attendance', v: overall + '%', s: 'Term 3 · Aarav', tone: 'from-emerald-500 to-teal-400' },
        { k: 'Pending homework', v: String(pendingHw), s: 'due this week', tone: 'from-amber-500 to-orange-400' },
        { k: 'Slips to sign', v: String(slips), s: 'need parent verify', tone: 'from-indigo-500 to-violet-500' },
        { k: 'Fees due', v: '₹6,500', s: 'lab & activity fee', tone: 'from-rose-500 to-pink-400' },
      ]
      case 'student': return [
        { k: 'Attendance', v: overall + '%', s: 'keep it above 90', tone: 'from-emerald-500 to-teal-400' },
        { k: 'To submit', v: String(pendingHw), s: 'assignments open', tone: 'from-amber-500 to-orange-400' },
        { k: 'Class rank', v: '#3', s: 'Term 2 · X-A', tone: 'from-indigo-500 to-violet-500' },
        { k: 'Next class', v: 'Physics', s: 'Lab-2 · 11:15', tone: 'from-sky-500 to-cyan-400' },
      ]
      case 'teacher': return [
        { k: 'Classes today', v: '5', s: '2 in X-A', tone: 'from-indigo-500 to-violet-500' },
        { k: 'Leave requests', v: String(db.leaves.filter(l => l.status === 'Pending').length), s: 'awaiting approval', tone: 'from-amber-500 to-orange-400' },
        { k: 'Ungraded', v: '3', s: 'assessment piles', tone: 'from-rose-500 to-pink-400' },
        { k: 'Next salary', v: '₹78,400', s: 'credits 30 Apr', tone: 'from-emerald-500 to-teal-400' },
      ]
      default: return [
        { k: 'Students present', v: '95.5%', s: 'whole school today', tone: 'from-emerald-500 to-teal-400' },
        { k: 'Applications', v: String(db.applications.filter(a => a.status === 'Pending').length), s: 'need a decision', tone: 'from-amber-500 to-orange-400' },
        { k: 'Fees collected', v: '₹1.2Cr', s: 'this term', tone: 'from-indigo-500 to-violet-500' },
        { k: 'Events', v: '3', s: 'next 30 days', tone: 'from-sky-500 to-cyan-400' },
      ]
    }
  }, [db, role])

  const nextEvents = db.events.filter(e => e.term === 't3').slice(0, 4)

  return (
    <div>
      <div className="mb-8">
        <p className="text-[14px] font-medium text-black/45 dark:text-white/45">{greet},</p>
        <h1 className="font-display mt-1 text-[clamp(1.8rem,3.5vw,2.6rem)] font-medium tracking-tight">{user!.name.split(' ')[0]} 👋</h1>
        <p className="mt-1.5 text-[14.5px] text-black/50 dark:text-white/50">{user!.title}</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(c => (
          <div key={c.k} className="card-lift relative overflow-hidden rounded-3xl border border-black/[.06] dark:border-white/[.08] bg-white dark:bg-[#14141f] p-6">
            <div className={`absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br ${c.tone} opacity-[.13]`} />
            <p className="text-[12.5px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">{c.k}</p>
            <p className="font-display mt-2.5 text-4xl font-medium">{c.v}</p>
            <p className="mt-1 text-[12.5px] text-black/45 dark:text-white/45">{c.s}</p>
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="rounded-3xl border border-black/[.06] dark:border-white/[.08] bg-white dark:bg-[#14141f] p-6">
          <p className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Coming up</p>
          <div className="space-y-3">
            {nextEvents.map(e => (
              <div key={e.date + e.title} className="flex items-center gap-3.5">
                <span className={`flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl text-[11px] font-bold leading-none ${e.type === 'holiday' ? 'bg-rose-100 text-rose-600' : e.type === 'exam' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-600'}`}>
                  {new Date(e.date).getDate()}<span className="text-[8px] uppercase">{new Date(e.date).toLocaleString('en', { month: 'short' })}</span>
                </span>
                <span className="flex-1 text-[14px] font-medium">{e.title}</span>
                <span className="text-[11.5px] capitalize text-black/40 dark:text-white/40">{e.type}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="grain relative overflow-hidden rounded-3xl bg-[#0b0b10] p-6 text-white">
          <div className="pointer-events-none absolute inset-0 opacity-50" style={{ background: 'radial-gradient(24rem 14rem at 90% 110%, rgba(99,102,241,.55), transparent 60%)' }} />
          <p className="text-[13px] font-semibold uppercase tracking-wider text-white/40">Did you know</p>
          <p className="font-display mt-3 text-2xl font-medium leading-snug">
            {role === 'parent' ? 'Every slip you approve is stamped with Aadhaar + face verification — students can’t sign for themselves.'
              : role === 'student' ? 'Nova Tutor is awake at 2 AM too. Ask it anything from this term’s syllabus.'
              : role === 'teacher' ? 'Grades you publish appear instantly in the parent and student portals.'
              : 'Timetable changes you make propagate to every portal in real time.'}
          </p>
        </div>
      </div>
    </div>
  )
}

/* ── shell ─────────────────────────────────────────────── */

const ROLE_GRAD: Record<Role, string> = {
  parent: 'from-indigo-500 to-violet-500', student: 'from-sky-500 to-cyan-400',
  teacher: 'from-emerald-500 to-teal-400', staff: 'from-amber-500 to-orange-400', admin: 'from-rose-500 to-pink-400',
}

export default function Portal() {
  const { user, logout, resetAll } = useStore()
  const navigate = useNavigate()
  const mods = useMemo(() => modulesFor(user?.role ?? 'parent'), [user?.role])
  const [active, setActive] = useState('home')
  const [term, setTerm] = useState('t3')
  const current = mods.find(m => m.id === active) ?? mods[0]
  const groups = useMemo(() => {
    const g: Record<string, Mod[]> = {}
    mods.forEach(m => { (g[m.group] ??= []).push(m) })
    return g
  }, [mods])

  if (!user) return null

  return (
    <TermCtx.Provider value={{ term, setTerm }}>
      <div className="flex min-h-screen bg-[#f6f6f4] dark:bg-[#090911]">
        {/* sidebar */}
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-black/[.06] dark:border-white/[.08] bg-white/80 dark:bg-[#14141f]/90 backdrop-blur lg:flex">
          <div className="flex h-[68px] items-center px-6"><Link to="/"><Logo size={30} /></Link></div>
          <nav className="flex-1 overflow-y-auto px-3 pb-4 thin-scroll">
            {Object.entries(groups).map(([g, items]) => (
              <div key={g} className="mt-4 first:mt-1">
                <p className="px-3 pb-1.5 text-[10.5px] font-bold uppercase tracking-[.16em] text-black/30 dark:text-white/30">{g}</p>
                {items.map(m => (
                  <button key={m.id} onClick={() => setActive(m.id)}
                    className={`mb-0.5 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-colors ${active === m.id ? 'bg-black text-white shadow-sm' : 'text-black/60 dark:text-white/60 hover:bg-black/[.04] dark:hover:bg-white/[.08] hover:text-black dark:hover:text-white'}`}>
                    <m.icon size={16.5} className={active === m.id ? 'text-white' : 'text-black/40 dark:text-white/40'} />
                    {m.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="border-t border-black/[.06] dark:border-white/[.08] p-3">
            <div className="mb-1 px-1">
              <InstallButton variant="pill" className="w-full justify-center" />
            </div>
            <button onClick={() => { resetAll(); toast.success('Demo data reset') }}
              className="mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium text-black/45 dark:text-white/45 hover:bg-black/[.04] dark:hover:bg-white/[.08]">
              <RotateCcw size={15} /> Reset demo data
            </button>
            <button onClick={() => { logout(); navigate('/') }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium text-rose-500 hover:bg-rose-50">
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </aside>

        {/* main */}
        <div className="flex-1 lg:pl-64">
          <header className="glass-nav sticky top-0 z-30 flex h-[68px] items-center justify-between px-5 sm:px-8">
            <div className="flex items-center gap-3 lg:hidden"><Link to="/"><Logo size={28} /></Link></div>
            <p className="hidden text-[13.5px] font-medium text-black/45 dark:text-white/45 lg:block">
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
            <div className="flex items-center gap-3">
              {!user.verified && user.role === 'parent' && <Pill tone="amber"><ShieldCheck size={12} /> unverified</Pill>}
              <ThemeToggle />
              <span className={`hidden rounded-full bg-gradient-to-r px-3.5 py-1.5 text-[12px] font-bold capitalize text-white sm:block ${ROLE_GRAD[user.role]}`}>
                {user.role} portal
              </span>
              <Avatar name={user.name} hue={user.avatarHue} size={38} />
            </div>
          </header>

          <main key={active} className="module-in mx-auto max-w-6xl px-4 py-6 pb-28 sm:px-8 sm:py-8 lg:pb-10">{current.el}</main>
        </div>

        {/* ── mobile bottom navigation ── */}
        <MobileNav mods={mods} active={active} setActive={setActive} />
      </div>
    </TermCtx.Provider>
  )
}

/* ── app-style bottom nav for phones ───────────────────── */

function MobileNav({ mods, active, setActive }: { mods: Mod[]; active: string; setActive: (id: string) => void }) {
  const [more, setMore] = useState(false)
  const { logout, resetAll, user } = useStore()
  const navigate = useNavigate()
  const primary = mods.slice(0, 4)
  const activeInPrimary = primary.some(m => m.id === active)
  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-black/[.07] dark:border-white/[.09] bg-white/85 dark:bg-[#10101a]/90 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        {primary.map(m => (
          <button key={m.id} onClick={() => { setActive(m.id); setMore(false) }}
            className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-semibold transition-colors ${active === m.id ? 'text-indigo-600 dark:text-indigo-400' : 'text-black/40 dark:text-white/40'}`}>
            {active === m.id && <span className="absolute -top-px h-0.5 w-8 rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500" />}
            <m.icon size={20} />
            {m.label.split(' ')[0]}
          </button>
        ))}
        <button onClick={() => setMore(true)}
          className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-semibold transition-colors ${more || !activeInPrimary ? 'text-indigo-600 dark:text-indigo-400' : 'text-black/40 dark:text-white/40'}`}>
          {(more || !activeInPrimary) && <span className="absolute -top-px h-0.5 w-8 rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500" />}
          <LayoutGrid size={20} />
          More
        </button>
      </nav>

      {/* more sheet */}
      {more && (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <div className="fade-in absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setMore(false)} />
          <div className="sheet-up absolute inset-x-0 bottom-0 max-h-[82dvh] overflow-y-auto rounded-t-[2rem] bg-white dark:bg-[#12121c] p-5 pb-8 thin-scroll">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-black/15 dark:bg-white/20" />
            <div className="mb-5 flex items-center gap-3.5 px-1">
              <Avatar name={user?.name ?? ''} hue={user?.avatarHue} size={44} />
              <div className="flex-1">
                <p className="text-[15px] font-semibold">{user?.name}</p>
                <p className="text-[12px] capitalize text-black/45 dark:text-white/45">{user?.role} portal</p>
              </div>
              <ThemeToggle />
            </div>
            {Object.entries(mods.reduce((g: Record<string, Mod[]>, m) => { (g[m.group] ??= []).push(m); return g }, {})).map(([g, items]) => (
              <div key={g} className="mb-4">
                <p className="px-1 pb-2 text-[10.5px] font-bold uppercase tracking-[.16em] text-black/30 dark:text-white/30">{g}</p>
                <div className="grid grid-cols-4 gap-2">
                  {items.map(m => (
                    <button key={m.id} onClick={() => { setActive(m.id); setMore(false) }}
                      className={`flex flex-col items-center gap-1.5 rounded-2xl py-3 text-[10.5px] font-semibold transition-colors ${active === m.id ? 'bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400' : 'text-black/55 dark:text-white/55 hover:bg-black/[.04] dark:hover:bg-white/[.08]'}`}>
                      <m.icon size={20} />
                      <span className="line-clamp-1 px-1 text-center leading-tight">{m.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="mt-2 flex gap-2 px-1">
              <button onClick={() => { resetAll(); setMore(false); toast.success('Demo data reset') }}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-black/[.05] dark:bg-white/[.07] py-3 text-[13px] font-semibold">
                <RotateCcw size={15} /> Reset demo
              </button>
              <button onClick={() => { logout(); navigate('/') }}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-rose-50 dark:bg-rose-500/10 py-3 text-[13px] font-semibold text-rose-500">
                <LogOut size={15} /> Sign out
              </button>
            </div>
            <div className="mt-2 px-1">
              <InstallButton variant="row" />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
