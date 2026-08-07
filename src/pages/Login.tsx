import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ArrowLeft, ArrowRight, Eye, EyeOff, GraduationCap, Landmark, LayoutDashboard, ShieldCheck, Users, BookOpen } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { useStore } from '@/lib/store'
import { ThemeToggle } from '@/lib/theme'
import type { Role } from '@/lib/data'

const ROLES: { role: Role; label: string; icon: any; email: string; pass: string; grad: string; blurb: string }[] = [
  { role: 'parent', label: 'Parent', icon: Users, email: 'parent@edunova.in', pass: 'parent123', grad: 'from-indigo-500 to-violet-500', blurb: 'Nisha Sharma · Parent of Aarav, X-A' },
  { role: 'student', label: 'Student', icon: GraduationCap, email: 'student@edunova.in', pass: 'student123', grad: 'from-sky-500 to-cyan-400', blurb: 'Aarav Sharma · Class X-A, Roll 12' },
  { role: 'teacher', label: 'Teacher', icon: BookOpen, email: 'teacher@edunova.in', pass: 'teacher123', grad: 'from-emerald-500 to-teal-400', blurb: 'Meera Krishnan · Mathematics' },
  { role: 'staff', label: 'Staff', icon: LayoutDashboard, email: 'staff@edunova.in', pass: 'staff123', grad: 'from-amber-500 to-orange-400', blurb: 'Farhan Qureshi · Office' },
  { role: 'admin', label: 'Admin', icon: Landmark, email: 'admin@edunova.in', pass: 'admin123', grad: 'from-rose-500 to-pink-400', blurb: 'Dr. Leela Menon · Principal' },
]

export default function Login() {
  const [params] = useSearchParams()
  const initial = (params.get('role') as Role) || 'parent'
  const [role, setRole] = useState<Role>(ROLES.some(r => r.role === initial) ? initial : 'parent')
  const active = ROLES.find(r => r.role === role)!
  const [email, setEmail] = useState(active.email)
  const [pass, setPass] = useState(active.pass)
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const { login } = useStore()
  const navigate = useNavigate()

  const pick = (r: Role) => {
    const cfg = ROLES.find(x => x.role === r)!
    setRole(r); setEmail(cfg.email); setPass(cfg.pass); setError('')
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const u = login(email, pass)
    if (u) navigate('/portal')
    else setError('Those credentials don’t match any EduNova account. Try the demo login.')
  }

  return (
    <div className="aurora grain relative flex min-h-screen flex-col">
      <header className="glass-nav">
        <div className="mx-auto flex h-[68px] max-w-7xl items-center justify-between px-6">
          <Link to="/"><Logo /></Link>
          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            <Link to="/" className="flex items-center gap-1.5 text-[14px] font-medium text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white">
              <ArrowLeft size={16} /> Back to site
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 items-center gap-14 px-6 py-16">
        {/* left copy */}
        <div className="rise-in hidden flex-1 lg:block">
          <h1 className="font-display text-[clamp(2.4rem,4.5vw,3.8rem)] font-medium leading-[1.05] tracking-tight">
            One login.<br />The whole <span className="text-grad">school day</span>.
          </h1>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-black/60 dark:text-white/60">
            Pick a role to step into its portal — demo credentials are filled in for you.
          </p>
          <div className="mt-8 space-y-3">
            {ROLES.map((r) => (
              <button key={r.role} onClick={() => pick(r.role)}
                className={`flex w-full max-w-md items-center gap-4 rounded-2xl border p-4 text-left transition-all ${role === r.role ? 'border-indigo-500/40 bg-white dark:bg-[#14141f] shadow-[0_12px_30px_-12px_rgba(80,80,200,.3)]' : 'border-black/[.07] dark:border-white/[.09] bg-white/60 dark:bg-[#14141f]/70 hover:bg-white'}`}>
                <span className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${r.grad} text-white`}>
                  <r.icon size={20} />
                </span>
                <span className="flex-1">
                  <span className="block text-[15px] font-semibold">{r.label}</span>
                  <span className="block text-[13px] text-black/50 dark:text-white/50">{r.blurb}</span>
                </span>
                <span className={`h-2.5 w-2.5 rounded-full ${role === r.role ? 'bg-indigo-500' : 'bg-black/15'}`} />
              </button>
            ))}
          </div>
        </div>

        {/* form card */}
        <div className="rise-in rise-1 mx-auto w-full max-w-md">
          <form onSubmit={submit} className="rounded-[2rem] border border-black/[.07] dark:border-white/[.09] bg-white/85 dark:bg-[#14141f]/95 p-8 shadow-[0_30px_70px_-30px_rgba(30,30,80,.35)] backdrop-blur">
            <div className="mb-6 flex gap-2 lg:hidden">
              {ROLES.map((r) => (
                <button type="button" key={r.role} onClick={() => pick(r.role)}
                  className={`flex-1 rounded-xl py-2 text-[12px] font-semibold ${role === r.role ? 'bg-black text-white' : 'bg-black/[.05] dark:bg-white/[.07] text-black/60 dark:text-white/60'}`}>
                  {r.label}
                </button>
              ))}
            </div>
            <div className={`mb-6 flex items-center gap-3 rounded-2xl bg-gradient-to-r ${active.grad} p-4 text-white`}>
              <active.icon size={22} />
              <div>
                <p className="text-[15px] font-semibold">{active.label} portal</p>
                <p className="text-[12.5px] text-white/75">{active.blurb}</p>
              </div>
            </div>
            <label className="block text-[13px] font-semibold text-black/60 dark:text-white/60">Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required
              className="mt-1.5 w-full rounded-xl border border-black/10 dark:border-white/15 bg-white dark:bg-[#14141f] px-4 py-3 text-[15px] outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" />
            <label className="mt-4 block text-[13px] font-semibold text-black/60 dark:text-white/60">Password</label>
            <div className="relative mt-1.5">
              <input value={pass} onChange={(e) => setPass(e.target.value)} type={show ? 'text' : 'password'} required
                className="w-full rounded-xl border border-black/10 dark:border-white/15 bg-white dark:bg-[#14141f] px-4 py-3 pr-11 text-[15px] outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" />
              <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white">
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {error && <p className="mt-3 rounded-xl bg-rose-50 px-4 py-2.5 text-[13px] font-medium text-rose-600">{error}</p>}
            <button type="submit" className="btn-ink mt-6 flex w-full items-center justify-center gap-2 py-3.5 text-[15px] font-semibold">
              Sign in <ArrowRight size={17} />
            </button>
            <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[12.5px] text-black/45 dark:text-white/45">
              <ShieldCheck size={14} className="text-emerald-600" /> Demo build — all data stays in your browser.
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}
