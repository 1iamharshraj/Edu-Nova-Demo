import { Link, useNavigate } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { ThemeToggle } from '@/lib/theme'

// Chrome for a standalone routed page under /portal/* that isn't hosted inside Portal.tsx's sidebar/tab shell
// (see .agents/edunova/ui-architecture-fix.md's "Routing decision (finalized)"). Reuses Login.tsx's exact
// header structure (glass-nav, Logo + ThemeToggle + a Back control) so these detail pages don't invent a new
// layout language, just drop the persistent sidebar for a real bookmarkable URL.
export function PortalPageShell({ backLabel, backTo, children }: { backLabel: string; backTo?: string; children: React.ReactNode }) {
  const navigate = useNavigate()
  const goBack = () => (backTo ? navigate(backTo) : navigate(-1))
  return (
    <div className="min-h-screen bg-[#f6f6f4] dark:bg-[#090911]">
      <header className="glass-nav">
        <div className="mx-auto flex h-[68px] max-w-7xl items-center justify-between px-6">
          <Link to="/portal"><Logo /></Link>
          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            <button onClick={goBack} className="flex items-center gap-1.5 text-[14px] font-medium text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white">
              <ArrowLeft size={16} /> {backLabel}
            </button>
          </div>
        </div>
      </header>
      <main className="module-in mx-auto max-w-6xl px-4 py-6 pb-28 sm:px-8 sm:py-8 lg:pb-10">
        {children}
      </main>
    </div>
  )
}
