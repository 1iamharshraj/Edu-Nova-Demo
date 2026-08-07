import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

const KEY = 'edunova_theme'

function initial(): 'light' | 'dark' {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'dark' || saved === 'light') return saved
  } catch { /* ignore */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(initial)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem(KEY, theme)
  }, [theme])
  return { theme, toggle: () => setTheme(t => (t === 'dark' ? 'light' : 'dark')) }
}

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggle } = useTheme()
  return (
    <button onClick={toggle} aria-label="Toggle theme"
      className={`relative flex h-9 w-9 items-center justify-center rounded-full bg-black/[.06] text-black/60 transition-all hover:bg-black/10 hover:text-black dark:bg-white/[.08] dark:text-white/70 dark:hover:bg-white/[.14] dark:hover:text-white ${className}`}>
      <span className={`absolute transition-all duration-300 ${theme === 'dark' ? 'rotate-0 scale-100 opacity-100' : 'rotate-90 scale-50 opacity-0'}`}>
        <Moon size={16} />
      </span>
      <span className={`absolute transition-all duration-300 ${theme === 'light' ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-50 opacity-0'}`}>
        <Sun size={16} />
      </span>
    </button>
  )
}
