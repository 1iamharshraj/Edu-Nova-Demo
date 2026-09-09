import { useState } from 'react'
import { useParams } from 'react-router'
import { CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { isAdmin } from '@/lib/access'
import { api, errorMessage } from '@/lib/api'
import { fmtDate } from '@/lib/hooks/useAcademics'
import { RATING_LABEL, reviewTone, useReview } from '@/lib/hooks/useEmployee'
import { RatingStars } from '@/portal/components/RatingStars'
import { ReviewDetail as ReviewEditForm } from '@/portal/modules/employee'
import { Card, Empty, PageHead, Pill, inputCls } from '@/portal/ui'
import { PortalPageShell } from './PortalPageShell'

// Was two different `<Modal>`s in portal/modules/employee.tsx: MyReviewsMod's "viewing" modal (self —
// add comments while Shared, read-only once Acknowledged) and TeamReviewsMod's edit/view modal (manager/HR
// — editable while Draft via the `ReviewDetail` component there, read-only otherwise). Both pointed at the
// same underlying review, so per .agents/edunova/ui-architecture-fix.md Phase D they're unified into one
// routed page, `/portal/reviews/:id`, which picks the right behavior based on the viewer's relationship to
// the review: the employee themself sees the comment/acknowledge flow (logic carried over verbatim from
// MyReviewsMod), everyone else reuses the exported `ReviewDetail` component from employee.tsx as-is.

const ghostBtn = 'flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/15 px-3.5 py-2 text-[13px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06] disabled:opacity-40'

export default function ReviewDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user, db } = useStore()
  const { data: review, loading, error, reload } = useReview(id, !!id)

  const isSelf = !!review && !!user && review.employeeId === user.id
  const targetEmployee = review ? db.users.find(u => u.id === review.employeeId) : undefined
  const canManage = !!review && !isSelf && (isAdmin(user) || targetEmployee?.reportsTo === user?.id)

  const [comments, setComments] = useState('')
  const [initedFor, setInitedFor] = useState<string | null>(null)
  if (review && isSelf && initedFor !== review.id) {
    setInitedFor(review.id)
    setComments(review.employeeComments ?? '')
  }
  const [busy, setBusy] = useState(false)

  const saveComments = async () => {
    if (!review || !comments.trim()) return
    setBusy(true)
    try {
      // A dedicated endpoint, not a general PATCH — the server validates employeeComments as required/non-empty here.
      await api.patch(`/reviews/${review.id}/comments`, { employeeComments: comments.trim() })
      toast.success('Comments saved')
      reload()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const acknowledge = async () => {
    if (!review) return
    setBusy(true)
    try {
      await api.post(`/reviews/${review.id}/acknowledge`, { employeeComments: comments.trim() || undefined })
      toast.success('Review acknowledged')
      reload()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <PortalPageShell backLabel="Back to reviews">
      {loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading review…</p>}
      {!loading && (error || !review) && <Empty text={error || 'Review not found.'} />}
      {!loading && review && (
        <div>
          <PageHead title={`${review.employeeName ?? 'Review'} · ${review.cycle}`} />
          <Card>
            {isSelf ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={reviewTone(review.status)}>{review.status}</Pill>
                  <RatingStars value={review.overallRating} />
                  <span className="text-[12.5px] text-black/50 dark:text-white/50">{RATING_LABEL[review.overallRating] ?? ''}</span>
                </div>
                {([['Strengths', review.strengths], ['Areas for improvement', review.areasForImprovement], ['Goals', review.goals]] as const).map(([label, val]) => (
                  <div key={label}>
                    <p className="text-[13px] font-semibold text-black/60 dark:text-white/60">{label}</p>
                    <p className="mt-1 whitespace-pre-line text-[14px] leading-relaxed text-black/80 dark:text-white/80">{val}</p>
                  </div>
                ))}
                <div>
                  <p className="text-[13px] font-semibold text-black/60 dark:text-white/60">Your comments</p>
                  {review.status === 'Acknowledged' ? (
                    <p className="mt-1 whitespace-pre-line text-[14px] leading-relaxed text-black/80 dark:text-white/80">{review.employeeComments || 'No comments added.'}</p>
                  ) : review.status === 'Shared' ? (
                    <>
                      <textarea value={comments} onChange={e => setComments(e.target.value)} rows={3} placeholder="Add your comments…" className={`${inputCls} mt-1.5`} />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button onClick={saveComments} disabled={busy || !comments.trim()} className={ghostBtn}>Save comments</button>
                        <button onClick={acknowledge} disabled={busy} className="btn-ink flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold disabled:opacity-40"><CheckCircle2 size={14} /> Acknowledge</button>
                      </div>
                    </>
                  ) : (
                    <p className="mt-1 text-[13.5px] text-black/45 dark:text-white/45">Not shared with you yet.</p>
                  )}
                </div>
                {review.sharedAt && (
                  <p className="text-[12px] text-black/40 dark:text-white/40">
                    Shared {fmtDate(review.sharedAt)}{review.acknowledgedAt ? ` · Acknowledged ${fmtDate(review.acknowledgedAt)}` : ''}
                  </p>
                )}
              </div>
            ) : (
              <ReviewEditForm review={review} readOnly={review.status !== 'Draft' || !canManage} onSaved={reload} />
            )}
          </Card>
        </div>
      )}
    </PortalPageShell>
  )
}
