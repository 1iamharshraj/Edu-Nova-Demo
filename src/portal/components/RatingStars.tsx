import { Star } from 'lucide-react'

// Shared by portal/modules/employee.tsx (MyReviewsMod/TeamReviewsMod list rows, ReviewDetail's read-only
// view) and the routed `/portal/reviews/:id` page (src/pages/portal/ReviewDetail.tsx) — split into its own
// component file (rather than exported from employee.tsx) purely to satisfy the react-refresh/
// only-export-components lint rule, which flags a component file that also exports a plain constant
// (RATING_LABEL lives in src/lib/hooks/useEmployee.ts for the same reason).

export function RatingStars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} size={14} className={i < value ? 'fill-amber-400 text-amber-400' : 'text-black/15 dark:text-white/15'} />
      ))}
    </span>
  )
}
