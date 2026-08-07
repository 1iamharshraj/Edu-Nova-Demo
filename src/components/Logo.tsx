export function Logo({ size = 34, dark = true }: { size?: number; dark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 select-none">
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
        <defs>
          <linearGradient id="lg1" x1="0" y1="0" x2="40" y2="40">
            <stop offset="0" stopColor="#6366f1" />
            <stop offset=".55" stopColor="#0ea5e9" />
            <stop offset="1" stopColor="#ec4899" />
          </linearGradient>
        </defs>
        {[0, 60, 120, 180, 240, 300].map((r) => (
          <ellipse key={r} cx="20" cy="12.5" rx="5.2" ry="9.5" fill="url(#lg1)" opacity="0.92"
            transform={`rotate(${r} 20 20)`} />
        ))}
        <circle cx="20" cy="20" r="4.2" fill={dark ? '#0b0b10' : '#fff'} />
      </svg>
      <span className={`font-display text-[1.35rem] font-medium tracking-tight ${dark ? 'text-[#0b0b10] dark:text-white' : 'text-white'}`}>
        EduNova
      </span>
    </span>
  )
}
