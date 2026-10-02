import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  ArrowRight, ArrowUpRight, Bell, BookOpen, BrainCircuit, CalendarDays, CheckCircle2,
  ChevronDown, CreditCard, GraduationCap, Landmark, LayoutDashboard, Menu,
  MessagesSquare, Rocket, ShieldCheck, Sparkles, Target, TrendingUp, Users, Wallet, X,
} from 'lucide-react'
import { Logo } from '@/components/Logo'
import { useStore } from '@/lib/store'
import { ThemeToggle } from '@/lib/theme'
import { InstallButton } from '@/lib/pwa'

/* ── mega menu content ─────────────────────────────────── */

const PORTALS = [
  { icon: Users, title: 'For Parents', desc: 'Test scores, rankings, attendance, fees and faculty chat.', role: 'parent' },
  { icon: GraduationCap, title: 'For Students', desc: 'Batch timetable, DPPs, test rankings and an AI doubt solver.', role: 'student' },
  { icon: BookOpen, title: 'For Faculty', desc: 'Attendance, test grading, syllabus progress, AI question papers.', role: 'teacher' },
  { icon: LayoutDashboard, title: 'For Front Desk', desc: 'Leads from ads, walk-ins and Google Sheets, enrollments, fees.', role: 'staff' },
  { icon: Landmark, title: 'For Directors', desc: 'Batches, scheduling, finance, faculty and full oversight.', role: 'admin' },
  { icon: Target, title: 'Lead Pipeline', desc: 'Every enquiry tracked from first call to enrolled student.', role: 'staff' },
]

const FEATURES = [
  { icon: CalendarDays, title: 'Batch timetables', desc: 'Clash-free faculty and classroom scheduling, auto-generated.' },
  { icon: TrendingUp, title: 'Test scores & rankings', desc: 'Every test ranked across batches, with progress reports.' },
  { icon: MessagesSquare, title: 'Parent updates', desc: 'Chats, announcements and PTMs so parents see progress weekly.' },
  { icon: CreditCard, title: 'Fees & installments', desc: 'Course fees, installment plans and defaulter follow-ups.' },
  { icon: BrainCircuit, title: 'AI doubt solver', desc: 'Students get instant, syllabus-aware answers between classes.' },
  { icon: Target, title: 'Lead management', desc: 'Website, Google/Meta ads, walk-ins and Sheet imports in one pipeline.' },
]

/* ── scroll reveal ─────────────────────────────────────── */

function Reveal({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [on, setOn] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setOn(true); obs.disconnect() }
    }, { threshold: 0.12 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return <div ref={ref} className={`reveal ${on ? 'revealed' : ''} ${delay ? `reveal-d${delay}` : ''} ${className}`}>{children}</div>
}

/* ── navbar ─────────────────────────────────────────────── */

function MegaMenu({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const enter = () => { if (closeTimer.current) clearTimeout(closeTimer.current); setOpen(true) }
  const leave = () => { closeTimer.current = setTimeout(() => setOpen(false), 120) }
  return (
    <div className="relative" onMouseEnter={enter} onMouseLeave={leave}>
      <button className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-[15px] font-medium transition-colors ${open ? 'bg-black/[.06] dark:bg-white/[.08] text-black dark:text-white' : 'text-black/70 dark:text-white/70 hover:text-black dark:hover:text-white'}`}>
        {label}
        <ChevronDown size={15} className={`transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className={`mega-panel mega-in absolute left-1/2 top-full z-50 mt-3 -translate-x-1/2 rounded-3xl p-3 ${wide ? 'w-[44rem]' : 'w-[34rem]'}`}>
          {children}
        </div>
      )}
    </div>
  )
}

function Navbar() {
  const navigate = useNavigate()
  const { user } = useStore()
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 24)
    window.addEventListener('scroll', fn)
    return () => window.removeEventListener('scroll', fn)
  }, [])
  return (
    <header className={`glass-nav fixed inset-x-0 top-0 z-50 transition-shadow ${scrolled ? 'shadow-[0_8px_30px_-12px_rgba(20,20,60,.15)]' : ''}`}>
      <div className="mx-auto flex h-[68px] max-w-7xl items-center justify-between px-6">
        <Link to="/"><Logo /></Link>
        <nav className="hidden items-center gap-1 md:flex">
          <MegaMenu label="Portals" wide>
            <p className="px-3 pb-2 pt-2 text-[11px] font-semibold uppercase tracking-[.18em] text-black/40 dark:text-white/40">One login · every role</p>
            <div className="grid grid-cols-3 gap-2">
              {PORTALS.map((p) => (
                <button key={p.title} onClick={() => navigate(`/login?role=${p.role}`)}
                  className="group rounded-2xl bg-black/[.035] dark:bg-white/[.06] p-4 text-left transition-colors hover:bg-black/[.07] dark:hover:bg-white/[.11]">
                  <p.icon size={20} className="text-black/50 dark:text-white/50 transition-colors group-hover:text-indigo-600" />
                  <p className="font-display mt-3 text-[15px] font-medium">{p.title}</p>
                  <p className="mt-1 text-[12.5px] leading-snug text-black/50 dark:text-white/50">{p.desc}</p>
                </button>
              ))}
            </div>
          </MegaMenu>
          <MegaMenu label="Features">
            <p className="px-3 pb-2 pt-2 text-[11px] font-semibold uppercase tracking-[.18em] text-black/40 dark:text-white/40">The whole institute, end to end</p>
            <div className="grid grid-cols-2 gap-2">
              {FEATURES.map((f) => (
                <a key={f.title} href="#features" className="group flex gap-3.5 rounded-2xl bg-black/[.035] dark:bg-white/[.06] p-4 transition-colors hover:bg-black/[.07] dark:hover:bg-white/[.11]">
                  <f.icon size={20} className="mt-0.5 shrink-0 text-black/50 dark:text-white/50 transition-colors group-hover:text-indigo-600" />
                  <span>
                    <span className="font-display block text-[15px] font-medium">{f.title}</span>
                    <span className="mt-0.5 block text-[12.5px] leading-snug text-black/50 dark:text-white/50">{f.desc}</span>
                  </span>
                </a>
              ))}
            </div>
          </MegaMenu>
          <a href="#why" className="rounded-full px-4 py-2 text-[15px] font-medium text-black/70 dark:text-white/70 transition-colors hover:text-black dark:hover:text-white">Why Edkonic Prep</a>
          <a href="#contact" className="rounded-full px-4 py-2 text-[15px] font-medium text-black/70 dark:text-white/70 transition-colors hover:text-black dark:hover:text-white">Contact</a>
        </nav>
        <div className="flex items-center gap-2.5">
          <InstallButton variant="pill" />
          <ThemeToggle />
          {user ? (
            <Link to="/portal" className="btn-ink px-5 py-2.5 text-[14px] font-semibold">Open portal</Link>
          ) : (
            <>
              <Link to="/login" className="hidden rounded-full bg-black/[.06] dark:bg-white/[.08] px-5 py-2.5 text-[14px] font-semibold transition-colors hover:bg-black/10 dark:hover:bg-white/15 sm:block">Login</Link>
              <Link to="/login" className="btn-ink hidden px-5 py-2.5 text-[14px] font-semibold sm:block">Book a demo</Link>
            </>
          )}
          <button onClick={() => setMobileOpen(!mobileOpen)} aria-label="Menu"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black/[.06] dark:bg-white/[.08] md:hidden">
            {mobileOpen ? <X size={17} /> : <Menu size={17} />}
          </button>
        </div>
      </div>

      {/* mobile menu */}
      {mobileOpen && (
        <div className="mega-in absolute inset-x-3 top-[74px] max-h-[78dvh] overflow-y-auto rounded-3xl mega-panel p-4 thin-scroll md:hidden">
          <p className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[.18em] text-black/40 dark:text-white/40">Portals</p>
          <div className="grid grid-cols-2 gap-2">
            {PORTALS.map((p) => (
              <button key={p.title} onClick={() => { setMobileOpen(false); navigate(`/login?role=${p.role}`) }}
                className="rounded-2xl bg-black/[.035] dark:bg-white/[.06] p-3.5 text-left">
                <p.icon size={18} className="text-indigo-500" />
                <p className="font-display mt-2 text-[14px] font-medium leading-tight">{p.title}</p>
              </button>
            ))}
          </div>
          <p className="px-2 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-[.18em] text-black/40 dark:text-white/40">Explore</p>
          <div className="space-y-1">
            {[['Features', '#features'], ['Why Edkonic Prep', '#why'], ['Contact', '#contact']].map(([l, h]) => (
              <a key={l} href={h} onClick={() => setMobileOpen(false)}
                className="flex items-center justify-between rounded-2xl px-3 py-3 text-[15px] font-medium hover:bg-black/[.04] dark:hover:bg-white/[.08]">
                {l} <ArrowUpRight size={16} className="text-black/30 dark:text-white/30" />
              </a>
            ))}
          </div>
          <button onClick={() => { setMobileOpen(false); navigate('/login') }} className="btn-ink mt-4 w-full py-3.5 text-[15px] font-semibold">
            {user ? 'Open portal' : 'Login'}
          </button>
          <div className="mt-2.5">
            <InstallButton variant="row" />
          </div>
        </div>
      )}
    </header>
  )
}

/* ── sections ───────────────────────────────────────────── */

function Hero() {
  const navigate = useNavigate()
  return (
    <section className="aurora grain relative overflow-hidden pb-28 pt-40">
      <div className="mx-auto max-w-7xl px-6">
        <div className="rise-in inline-flex items-center gap-2 rounded-full border border-black/10 dark:border-white/15 bg-white/70 dark:bg-[#14141f]/80 px-4 py-1.5 text-[13px] font-medium text-black/70 dark:text-white/70 backdrop-blur">
          <Sparkles size={14} className="text-indigo-600" /> New — lead management for ads, walk-ins and Google Sheets
        </div>
        <h1 className="font-display rise-in rise-1 mt-7 max-w-4xl text-[clamp(2.8rem,7vw,5.6rem)] font-medium leading-[1.02] tracking-tight">
          Meet Edkonic Prep, the <span className="text-grad">coaching institute OS</span>.
        </h1>
        <p className="rise-in rise-2 mt-6 max-w-xl text-lg leading-relaxed text-black/60 dark:text-white/60">
          From the first enquiry to the final rank list — leads, enrollments, batch timetables,
          tests, fees and parent updates in one place, so your faculty stays focused on results.
        </p>
        <div className="rise-in rise-3 mt-9 flex flex-wrap items-center gap-4">
          <button onClick={() => navigate('/login')} className="btn-ink flex items-center gap-2 px-7 py-3.5 text-[15px] font-semibold">
            Enter your portal <ArrowRight size={17} />
          </button>
          <a href="#features" className="group flex items-center gap-1.5 text-[15px] font-semibold text-black/70 dark:text-white/70 hover:text-black dark:hover:text-white">
            Explore features <ArrowUpRight size={16} className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </a>
        </div>

        {/* floating preview card */}
        <div className="rise-in rise-4 floaty relative mx-auto mt-20 max-w-4xl">
          <div className="rounded-[2rem] border border-black/[.07] dark:border-white/[.09] bg-white/80 dark:bg-[#14141f]/90 p-3 shadow-[0_40px_90px_-30px_rgba(30,30,80,.35)] backdrop-blur">
            <div className="rounded-3xl bg-[#0b0b10] p-6 text-white sm:p-8">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-medium text-white/50">Today · JEE 2027 · Batch A</p>
                <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-3 py-1 text-[12px] font-medium text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> Live</span>
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                {[
                  { icon: CalendarDays, k: 'Next class', v: 'Physics · Room 2', s: 'starts 4:15 pm' },
                  { icon: TrendingUp, k: 'Mock test 6 rank', v: '#4 of 212', s: '+11 places vs Mock 5' },
                  { icon: Bell, k: 'New leads', v: '14 today', s: '6 from Google Ads' },
                ].map((c) => (
                  <div key={c.k} className="rounded-2xl bg-white/[.06] p-5">
                    <c.icon size={18} className="text-indigo-300" />
                    <p className="mt-3 text-[12px] uppercase tracking-wider text-white/40">{c.k}</p>
                    <p className="font-display mt-1 text-xl">{c.v}</p>
                    <p className="mt-0.5 text-[12px] text-white/40">{c.s}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

const MARQUEE = ['Lead Pipeline', 'Google Sheet Import', 'Enrollments', 'Batch Timetables', 'Attendance', 'Test Scores', 'Rankings', 'DPPs', 'Syllabus Tracking', 'AI Doubt Solver', 'Fee Installments', 'Payroll', 'Parent Updates', 'Success Stories']

function Marquee() {
  return (
    <div className="overflow-hidden border-y border-black/[.07] dark:border-white/[.09] bg-white/60 dark:bg-[#14141f]/70 py-5">
      <div className="marquee-track">
        {[...MARQUEE, ...MARQUEE].map((m, i) => (
          <span key={i} className="flex items-center gap-3 whitespace-nowrap rounded-full border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] px-5 py-2 text-[14px] font-medium text-black/70 dark:text-white/70">
            <CheckCircle2 size={15} className="text-indigo-500" /> {m}
          </span>
        ))}
      </div>
    </div>
  )
}

function Features() {
  return (
    <section id="features" className="mx-auto max-w-7xl px-6 py-28">
      <Reveal>
        <p className="text-[13px] font-semibold uppercase tracking-[.2em] text-indigo-600 dark:text-indigo-400">Everything, end to end</p>
        <h2 className="font-display mt-4 max-w-2xl text-[clamp(2rem,4.5vw,3.4rem)] font-medium leading-tight tracking-tight">
          Every enquiry, batch, test and receipt — in one calm interface.
        </h2>
      </Reveal>
      <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, i) => (
          <Reveal key={f.title} delay={(i % 3) + 1}>
            <div className="card-lift h-full rounded-3xl border border-black/[.06] dark:border-white/[.08] bg-white dark:bg-[#14141f] p-7">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/15 to-sky-500/15">
                <f.icon size={22} className="text-indigo-600 dark:text-indigo-400" />
              </div>
              <p className="font-display mt-5 text-xl font-medium">{f.title}</p>
              <p className="mt-2 leading-relaxed text-black/55 dark:text-white/55">{f.desc}</p>
              <p className="mt-4 text-[12px] font-semibold uppercase tracking-widest text-black/25 dark:text-white/25">0{i + 1}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

function Why() {
  const stats = [
    { v: '5', k: 'roles, one login' },
    { v: '40+', k: 'workflows automated' },
    { v: '7', k: 'lead sources tracked' },
    { v: '0', k: 'spreadsheets to chase' },
  ]
  return (
    <section id="why" className="aurora-soft grain relative border-y border-black/[.06] dark:border-white/[.08] py-28">
      <div className="mx-auto grid max-w-7xl items-center gap-14 px-6 lg:grid-cols-2">
        <Reveal>
          <p className="text-[13px] font-semibold uppercase tracking-[.2em] text-indigo-600 dark:text-indigo-400">Why Edkonic Prep</p>
          <h2 className="font-display mt-4 text-[clamp(2rem,4.5vw,3.2rem)] font-medium leading-tight tracking-tight">
            Built for how coaching actually runs.
          </h2>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-black/60 dark:text-white/60">
            Leads from every ad and walk-in land in one pipeline. Faculty grade tests in seconds and
            rankings update instantly. Parents see weekly progress, and directors see every batch,
            every rupee and every result.
          </p>
          <div className="mt-8 flex items-center gap-3 rounded-2xl border border-black/[.08] dark:border-white/[.10] bg-white/70 dark:bg-[#14141f]/80 p-5 backdrop-blur">
            <ShieldCheck size={26} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
            <p className="text-[15px] leading-snug text-black/70 dark:text-white/70">
              <span className="font-semibold text-black dark:text-white">Lead to enrollment in one click</span> — a converted lead gets a student login and a batch seat instantly.
            </p>
          </div>
        </Reveal>
        <div className="grid grid-cols-2 gap-5">
          {stats.map((s, i) => (
            <Reveal key={s.k} delay={i + 1}>
              <div className="card-lift h-full rounded-3xl border border-black/[.06] dark:border-white/[.08] bg-white/80 dark:bg-[#14141f]/90 p-8 backdrop-blur">
                <p className="font-display text-5xl font-medium text-grad">{s.v}</p>
                <p className="mt-2 text-[14px] font-medium text-black/55 dark:text-white/55">{s.k}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

function PortalCards() {
  const navigate = useNavigate()
  const cards = [
    { role: 'parent', name: 'Parent Portal', desc: 'Follow test scores, rankings, attendance and fees — and message faculty.', grad: 'from-indigo-500 to-violet-500' },
    { role: 'student', name: 'Student Portal', desc: 'Batch timetable, DPPs, test rankings and the AI doubt solver.', grad: 'from-sky-500 to-cyan-400' },
    { role: 'teacher', name: 'Faculty Portal', desc: 'Take attendance, grade tests, track syllabus and generate question papers.', grad: 'from-emerald-500 to-teal-400' },
    { role: 'staff', name: 'Front Desk', desc: 'Work the lead pipeline, enroll students and collect fees from one desk.', grad: 'from-amber-500 to-orange-400' },
    { role: 'admin', name: 'Director Console', desc: 'Batches, scheduling, finance and faculty — institute-wide control.', grad: 'from-rose-500 to-pink-400' },
  ]
  return (
    <section className="mx-auto max-w-7xl px-6 py-28">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <h2 className="font-display max-w-xl text-[clamp(2rem,4.5vw,3.2rem)] font-medium leading-tight tracking-tight">
            Pick your portal. Everything is already set up.
          </h2>
          <p className="max-w-sm text-black/55 dark:text-white/55">Demo accounts are pre-filled on the login screen — walk through all five roles in minutes.</p>
        </div>
      </Reveal>
      <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((c, i) => (
          <Reveal key={c.role} delay={(i % 3) + 1}>
            <button onClick={() => navigate(`/login?role=${c.role}`)}
              className="card-lift group relative h-full w-full overflow-hidden rounded-3xl border border-black/[.06] dark:border-white/[.08] bg-white dark:bg-[#14141f] p-7 text-left">
              <div className={`absolute -right-10 -top-10 h-36 w-36 rounded-full bg-gradient-to-br ${c.grad} opacity-[.14] transition-opacity group-hover:opacity-25`} />
              <Rocket size={20} className="text-black/30 dark:text-white/30 transition-colors group-hover:text-indigo-600 dark:group-hover:text-indigo-400" />
              <p className="font-display mt-4 text-2xl font-medium">{c.name}</p>
              <p className="mt-2 leading-relaxed text-black/55 dark:text-white/55">{c.desc}</p>
              <span className="mt-5 inline-flex items-center gap-1.5 text-[14px] font-semibold text-indigo-600 dark:text-indigo-400">
                Open demo <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" />
              </span>
            </button>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

function CTA() {
  const navigate = useNavigate()
  return (
    <section className="mx-auto max-w-7xl px-6 pb-28">
      <Reveal>
        <div className="grain relative overflow-hidden rounded-[2.5rem] bg-[#0b0b10] px-8 py-20 text-center text-white">
          <div className="pointer-events-none absolute inset-0 opacity-60"
            style={{ background: 'radial-gradient(40rem 20rem at 50% 120%, rgba(99,102,241,.5), transparent 65%)' }} />
          <Wallet size={28} className="mx-auto text-indigo-300" />
          <h2 className="font-display mx-auto mt-6 max-w-2xl text-[clamp(2rem,4.5vw,3.2rem)] font-medium leading-tight">
            Your institute, already organised.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-white/55">From enquiry to rank list. One login for every batch.</p>
          <button onClick={() => navigate('/login')} className="glow-pulse mx-auto mt-8 flex items-center gap-2 rounded-full bg-white px-8 py-4 text-[15px] font-semibold text-black transition-transform hover:-translate-y-0.5">
            Launch Edkonic Prep <ArrowRight size={17} />
          </button>
        </div>
      </Reveal>
    </section>
  )
}

function Footer() {
  return (
    <footer id="contact" className="border-t border-black/[.07] dark:border-white/[.09] bg-white/60 dark:bg-[#14141f]/70">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-6 px-6 py-12">
        <Logo />
        <p className="text-[14px] text-black/45 dark:text-white/45">hello@edkonic.in · +91 484 555 0100 · Kochi, Kerala</p>
        <p className="text-[13px] text-black/35 dark:text-white/35">© 2026 Edkonic Prep — Coaching Institute OS. Demo experience.</p>
      </div>
    </footer>
  )
}

export default function Landing() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <Hero />
      <Marquee />
      <Features />
      <Why />
      <PortalCards />
      <CTA />
      <Footer />
    </div>
  )
}
