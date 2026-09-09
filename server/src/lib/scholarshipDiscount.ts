// Phase 21 item 4 — shared, pure discount-allocation logic used both by scholarships/service.ts
// (retroactively applying an award to a student's existing invoices on approval) and by
// fees/service.ts#generateInvoices (applying an already-Approved award to a brand-new invoice at
// generation time). Kept here (not in either module) so fees/service.ts never has to import from
// scholarships/service.ts — avoids a circular module dependency (this codebase compiles to CommonJS).
//
// Percentage discounts apply independently to every invoice passed in (each invoice loses
// `discountValue`% of its own total, capped at whatever of that invoice isn't already discounted).
// FixedAmount discounts draw down a single pool across the invoices in the order given, so calling this
// twice for the same award (once at approval for existing invoices, once later for a newly generated one)
// never over-discounts as long as the caller passes the pool already consumed so far.

export type DiscountType = 'Percentage' | 'FixedAmount'

const round2 = (n: number) => Math.round(n * 100) / 100

export interface DiscountableInvoice {
  id: string
  total: number
  concession: number
}

// Returns a Map<invoiceId, discountAmount> — only invoices that actually receive a non-zero discount are
// present. `alreadyConsumed` is how much of a FixedAmount scholarship's pool earlier passes have already
// used (ignored for Percentage).
export function allocateScholarshipDiscount(
  discountType: DiscountType,
  discountValue: number,
  invoices: DiscountableInvoice[],
  alreadyConsumed = 0,
): Map<string, number> {
  const out = new Map<string, number>()
  let remainingFixed = discountType === 'FixedAmount' ? round2(discountValue - alreadyConsumed) : null
  for (const inv of invoices) {
    const available = round2(inv.total - inv.concession)
    if (available <= 0) continue
    let discount = discountType === 'Percentage'
      ? round2(inv.total * (discountValue / 100))
      : Math.max(0, remainingFixed ?? 0)
    discount = Math.min(discount, available)
    if (discount <= 0) continue
    out.set(inv.id, discount)
    if (remainingFixed !== null) remainingFixed = round2(remainingFixed - discount)
  }
  return out
}
