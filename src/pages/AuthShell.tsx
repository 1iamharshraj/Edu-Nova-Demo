import { Link } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { ThemeToggle } from '@/lib/theme'

/** Shared chrome for the small auth pages (change / forgot / reset password): the login page's header and card. */
export function AuthShell({ title, sub, children, back = { to: '/login', label: 'Back to sign in' } }: {
  title: string; sub?: string; children: React.ReactNode; back?: { to: string; label: string } | null
}) {
  return (
    <div className="aurora grain relative flex min-h-screen flex-col">
      <header className="glass-nav">
        <div className="mx-auto flex h-[68px] max-w-7xl items-center justify-between px-6">
          <Link to="/"><Logo /></Link>
          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            {back && (
              <Link to={back.to} className="flex items-center gap-1.5 text-[14px] font-medium text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white">
                <ArrowLeft size={16} /> {back.label}
              </Link>
            )}
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-md flex-1 items-center px-6 py-16">
        <div className="rise-in w-full rounded-[2rem] border border-black/[.07] dark:border-white/[.09] bg-white/85 dark:bg-[#14141f]/95 p-8 shadow-[0_30px_70px_-30px_rgba(30,30,80,.35)] backdrop-blur">
          <h1 className="font-display text-[1.7rem] font-medium tracking-tight">{title}</h1>
          {sub && <p className="mt-1.5 text-[14px] leading-relaxed text-black/55 dark:text-white/55">{sub}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  )
}

export const authInputCls = 'w-full rounded-xl border border-black/10 dark:border-white/15 bg-white dark:bg-[#14141f] px-4 py-3 text-[15px] outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100'

export function AuthField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[13px] font-semibold text-black/60 dark:text-white/60">{label}</span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  )
}

export function AuthError({ text }: { text: string }) {
  if (!text) return null
  return <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-[13px] font-medium text-rose-600 dark:bg-rose-500/10">{text}</p>
}
