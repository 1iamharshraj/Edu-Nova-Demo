export function Logo({ size = 34, dark = true }: { size?: number; dark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 select-none">
      <img src="/brand/icon-transparent.png" alt="" width={size} height={size} style={{ width: size, height: size }} className="shrink-0" />
      <span className={`font-display text-[1.35rem] font-medium tracking-tight ${dark ? 'text-[#0b0b10] dark:text-white' : 'text-white'}`}>
        Edkonic
      </span>
    </span>
  )
}
