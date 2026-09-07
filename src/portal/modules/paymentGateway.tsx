import { useMemo, useState } from 'react'
import { ArrowLeft, Banknote, CheckCircle2, CreditCard, Download, FlaskConical, Landmark, Receipt as ReceiptIcon, ShieldCheck, Smartphone, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { api, downloadPath, errorMessage } from '@/lib/api'
import { fmtINR, type FeeInvoice, type Payment, type PaymentMethod } from '@/lib/data'
import { fmtDate } from '@/lib/hooks/useAcademics'
import { GATEWAY_METHODS, METHOD_LABEL, STATUS_TEXT, invoiceLabel, invoiceTone, isOutstanding, outstandingOf, paidOf, payableOf, useInvoices, usePayments } from '@/lib/hooks/useFinance'
import { Card, Empty, Field, Modal, PageHead, Pill, TermTabs, inputCls } from '../ui'
import { WardPicker } from './academics'
import { useActiveTerm, useWard } from './viewer'

// Parent/student fee payments through the gateway flow: POST /fees/gateway/order → (Razorpay checkout | sandbox) → POST /fees/gateway/confirm.
// Staff counter payments live in finance.tsx (CollectionsMod). See .agents/edunova/phase-5-finance.md

/* ── Razorpay checkout (loaded only when the server hands us a key) ── */

interface RazorpayResult { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }
interface RazorpayOptions {
  key: string; amount: number; currency: string; order_id: string; name: string; description?: string
  prefill?: { name?: string; email?: string; contact?: string }; theme?: { color?: string }
  handler: (r: RazorpayResult) => void; modal?: { ondismiss?: () => void }
}
type RazorpayCtor = new (opts: RazorpayOptions) => { open(): void }
const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

function loadRazorpay(): Promise<RazorpayCtor> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { Razorpay?: RazorpayCtor }
    if (w.Razorpay) return resolve(w.Razorpay)
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`)
    const s = existing ?? Object.assign(document.createElement('script'), { src: CHECKOUT_SRC, async: true })
    s.addEventListener('load', () => (w.Razorpay ? resolve(w.Razorpay) : reject(new Error('Razorpay checkout did not initialise'))))
    s.addEventListener('error', () => reject(new Error('Could not load Razorpay checkout — check your connection')))
    if (!existing) document.head.appendChild(s)
  })
}

type OrderRes = { sandbox?: boolean; orderId: string; key?: string; amount?: number; currency?: string }
type Stage = 'idle' | 'ordering' | 'checkout' | 'confirming' | 'done'

const methodIcon = (m: PaymentMethod) => (m === 'UPI' ? <Smartphone size={15} /> : m === 'Card' ? <CreditCard size={15} /> : <Landmark size={15} />)
const ghostBtn = 'flex items-center gap-1.5 rounded-full bg-black/[.06] dark:bg-white/[.08] px-4 py-2 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15'

/* ── module: fee payments ───────────────────────────────── */

export function PaymentGatewayMod() {
  const { db, user } = useStore()
  const { term, setTerm } = useActiveTerm()
  const { students, ward, wardId, setWardId } = useWard()
  const termId = db.terms.length ? term : ''
  const invoices = useInvoices({ studentId: wardId, termId }, !!wardId)
  const payments = usePayments({ studentId: wardId }, !!wardId)
  const rows = useMemo(() => [...(invoices.items ?? [])].sort((a, b) => (isOutstanding(a) === isOutstanding(b) ? a.dueDate.localeCompare(b.dueDate) : isOutstanding(a) ? -1 : 1)), [invoices.items])
  const invoiced = rows.reduce((a, r) => a + payableOf(r), 0)
  const paid = rows.reduce((a, r) => a + paidOf(r, payments.items), 0)
  const due = rows.reduce((a, r) => a + outstandingOf(r, payments.items), 0)
  const paymentsOf = (inv: FeeInvoice) => inv.payments ?? (payments.items ?? []).filter(p => p.invoiceId === inv.id)

  const [selected, setSelected] = useState<FeeInvoice | null>(null)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('UPI')
  const [stage, setStage] = useState<Stage>('idle')
  const [sandbox, setSandbox] = useState(false)
  const [result, setResult] = useState<Payment | null>(null)
  const maxAmount = selected ? outstandingOf(selected, payments.items) : 0
  const amt = Math.max(0, Number(amount) || 0)
  const busy = stage === 'ordering' || stage === 'checkout' || stage === 'confirming'

  const openPay = (inv: FeeInvoice) => {
    setSelected(inv); setAmount(String(outstandingOf(inv, payments.items))); setMethod('UPI'); setStage('idle'); setSandbox(false); setResult(null)
  }
  const close = () => { if (!busy) setSelected(null) }

  const confirm = async (body: { orderId: string; invoiceId: string; amount: number; method: PaymentMethod; paymentId?: string; signature?: string }) => {
    setStage('confirming')
    try {
      const res = await api.post<{ item?: Payment } & Partial<Payment>>('/fees/gateway/confirm', body)
      const p = (res?.item ?? res) as Payment
      setResult(p && p.id ? p : null)
      setStage('done')
      invoices.reload(); payments.reload()
      toast.success(`Payment of ${fmtINR(body.amount)} received${p?.receiptNo ? ` · ${p.receiptNo}` : ''}`)
    } catch (e) { toast.error(errorMessage(e)); setStage('idle') }
  }

  const pay = async () => {
    if (!selected || amt <= 0 || amt > maxAmount) return
    setStage('ordering')
    try {
      const order = await api.post<OrderRes>('/fees/gateway/order', { invoiceId: selected.id, amount: amt })
      if (order.sandbox || !order.key) {
        setSandbox(true)
        await confirm({ orderId: order.orderId, invoiceId: selected.id, amount: amt, method })
        return
      }
      setStage('checkout')
      const Razorpay = await loadRazorpay()
      new Razorpay({
        key: order.key, amount: order.amount ?? Math.round(amt * 100), currency: order.currency ?? 'INR', order_id: order.orderId,
        name: 'EduNova School', description: `${selected.invoiceNo} · ${invoiceLabel(selected)}`, theme: { color: '#4f46e5' },
        prefill: { name: user?.name, email: user?.email, contact: user?.phone },
        handler: r => { void confirm({ orderId: order.orderId, invoiceId: selected.id, amount: amt, method, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }) },
        modal: { ondismiss: () => setStage('idle') },
      }).open()
    } catch (e) { toast.error(errorMessage(e)); setStage('idle') }
  }

  const receipt = async (path: string, name: string) => {
    try { await downloadPath(path, name); toast.success('Receipt downloaded') } catch (e) { toast.error(errorMessage(e)) }
  }
  const paymentReceipt = (p: Payment) => receipt(`/fees/payments/${p.id}/receipt.pdf`, `${p.receiptNo.replace(/\W+/g, '_')}.pdf`)
  const invoiceReceipt = (inv: FeeInvoice) => receipt(`/fees/invoices/${inv.id}/receipt.pdf`, `${inv.invoiceNo.replace(/\W+/g, '_')}.pdf`)

  return (
    <div>
      <PageHead title="Fee Payments" sub={ward ? `Pay fees securely for ${ward.name}` : 'Pay fees securely'}>
        <div className="flex flex-wrap items-center gap-2">
          <WardPicker students={students} value={wardId} onChange={setWardId} />
          {db.terms.length > 0 && <TermTabs terms={db.terms} term={term} setTerm={setTerm} />}
        </div>
      </PageHead>

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Card className="flex items-center gap-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50"><Wallet size={20} className="text-indigo-600" /></span>
          <div><p className="text-[12px] uppercase tracking-wider text-black/40 dark:text-white/40">Invoiced{termId ? ' this term' : ''}</p><p className="font-display text-2xl font-medium">{fmtINR(invoiced)}</p></div>
        </Card>
        <Card className="flex items-center gap-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50"><ShieldCheck size={20} className="text-emerald-600" /></span>
          <div><p className="text-[12px] uppercase tracking-wider text-black/40 dark:text-white/40">Paid</p><p className="font-display text-2xl font-medium">{fmtINR(paid)}</p></div>
        </Card>
        <Card className="flex items-center gap-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50"><Banknote size={20} className="text-amber-600" /></span>
          <div><p className="text-[12px] uppercase tracking-wider text-black/40 dark:text-white/40">Due</p><p className="font-display text-2xl font-medium">{fmtINR(due)}</p></div>
        </Card>
      </div>

      <Card className="p-0">
        {!ward ? <div className="p-6"><Empty text="No student is linked to your account yet." /></div>
          : invoices.loading ? <div className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading invoices…</div>
          : invoices.error ? <div className="p-6"><Empty text={invoices.error} /></div>
          : rows.length === 0 ? <div className="p-6"><Empty text="Nothing here for this term." /></div>
          : rows.map(r => {
            const out = outstandingOf(r, payments.items)
            const ps = paymentsOf(r)
            return (
              <div key={r.id} className="border-b border-black/[.05] dark:border-white/[.07] px-6 py-4 last:border-0">
                <div className="flex flex-wrap items-center gap-4">
                  <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${r.status === 'Paid' ? 'bg-emerald-50 text-emerald-600' : r.status === 'Waived' ? 'bg-black/[.05] text-black/40 dark:bg-white/[.07] dark:text-white/40' : 'bg-amber-50 text-amber-600'}`}>
                    <ReceiptIcon size={18} />
                  </span>
                  <div className="min-w-48 flex-1">
                    <p className="text-[14.5px] font-semibold">{invoiceLabel(r)}</p>
                    <p className="text-[12.5px] text-black/45 dark:text-white/45">{r.invoiceNo} · due {fmtDate(r.dueDate, { day: 'numeric', month: 'short', year: 'numeric' })}{r.concession > 0 ? ` · concession ${fmtINR(r.concession)}` : ''}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[15px] font-bold">{fmtINR(payableOf(r))}</p>
                    {out > 0 && out < payableOf(r) && <p className="text-[12px] text-amber-600">{fmtINR(out)} left</p>}
                  </div>
                  <Pill tone={invoiceTone(r.status)}>{STATUS_TEXT[r.status]}</Pill>
                  <div className="flex gap-2">
                    {isOutstanding(r) && (
                      <button onClick={() => openPay(r)} className="flex items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-indigo-700">
                        <CreditCard size={13} /> Pay
                      </button>
                    )}
                    <button onClick={() => invoiceReceipt(r)} className={ghostBtn}><Download size={13} /> Statement</button>
                  </div>
                </div>
                {ps.length > 0 && (
                  <div className="mt-3 space-y-1.5 rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3 text-[12.5px]">
                    {ps.map(p => (
                      <div key={p.id} className="flex flex-wrap items-center gap-2">
                        <CheckCircle2 size={12} className="text-emerald-600" />
                        <span className="font-semibold">{fmtINR(p.amount)}</span>
                        <span className="text-black/50 dark:text-white/50">{METHOD_LABEL[p.method] ?? p.method} · {fmtDate(p.paidAt, { day: 'numeric', month: 'short', year: 'numeric' })} · {p.receiptNo}</span>
                        <span className="flex-1" />
                        <button onClick={() => paymentReceipt(p)} className="flex items-center gap-1 font-semibold text-indigo-600 hover:underline"><Download size={11} /> Receipt</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
      </Card>

      <Modal open={!!selected} onClose={close} title={stage === 'done' ? 'Payment received' : `Pay ${selected ? fmtINR(amt) : ''}`}>
        {selected && stage === 'done' ? (
          <div className="flex flex-col items-center py-4 text-center">
            <CheckCircle2 size={56} className="text-emerald-500" />
            <p className="mt-4 text-[16px] font-semibold">{fmtINR(result?.amount ?? amt)} paid</p>
            <p className="mt-1 text-[13px] text-black/50 dark:text-white/50">{selected.invoiceNo} · {invoiceLabel(selected)}{result?.receiptNo ? ` · receipt ${result.receiptNo}` : ''}</p>
            {sandbox && <p className="mt-3 rounded-full bg-amber-50 px-3 py-1 text-[12px] font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-200"><FlaskConical size={12} className="mr-1 inline" />Sandbox — no money moved</p>}
            <div className="mt-5 flex gap-2">
              {result ? <button onClick={() => paymentReceipt(result)} className="flex items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-indigo-700"><Download size={13} /> Download receipt</button>
                : <button onClick={() => invoiceReceipt(selected)} className="flex items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-indigo-700"><Download size={13} /> Download statement</button>}
              <button onClick={() => setSelected(null)} className={ghostBtn}>Done</button>
            </div>
          </div>
        ) : selected && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-2xl bg-indigo-50 p-4 dark:bg-indigo-500/10">
              <ReceiptIcon className="text-indigo-600" size={22} />
              <div className="flex-1">
                <p className="text-[13.5px] font-semibold text-indigo-900 dark:text-indigo-100">{invoiceLabel(selected)}</p>
                <p className="text-[12.5px] text-indigo-700/80 dark:text-indigo-200/70">{ward?.name} · {selected.invoiceNo} · {fmtINR(maxAmount)} outstanding</p>
              </div>
            </div>
            {sandbox && (
              <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
                <FlaskConical size={18} className="mt-0.5 text-amber-600" />
                <div>
                  <p className="text-[13.5px] font-semibold text-amber-800 dark:text-amber-200">Sandbox mode</p>
                  <p className="mt-0.5 text-[12.5px] text-amber-700/80 dark:text-amber-200/70">The school hasn't connected a payment gateway yet. This payment is recorded for testing — no money is deducted.</p>
                </div>
              </div>
            )}
            <Field label="Amount (₹)">
              <input type="number" min={1} max={maxAmount} value={amount} onChange={e => setAmount(e.target.value)} disabled={busy} className={inputCls} inputMode="numeric" />
            </Field>
            {amt > 0 && amt < maxAmount && <p className="-mt-2 text-[12.5px] text-black/45 dark:text-white/45">Part payment — {fmtINR(maxAmount - amt)} will remain due.</p>}
            {amt > maxAmount && <p className="-mt-2 text-[12.5px] text-rose-500">Amount exceeds the outstanding balance.</p>}
            <Field label="Pay with">
              <div className="flex gap-2">
                {GATEWAY_METHODS.map(m => (
                  <button key={m} onClick={() => setMethod(m)} disabled={busy}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-semibold transition-colors ${method === m ? 'bg-black text-white' : 'bg-black/[.05] dark:bg-white/[.07] text-black/60 dark:text-white/60 hover:bg-black/10 dark:hover:bg-white/15'}`}>
                    {methodIcon(m)} {METHOD_LABEL[m]}
                  </button>
                ))}
              </div>
            </Field>
            <button onClick={pay} disabled={busy || amt <= 0 || amt > maxAmount} className="btn-ink flex w-full items-center justify-center gap-2 py-3 text-[14px] font-semibold disabled:opacity-40">
              {stage === 'ordering' ? 'Creating order…' : stage === 'checkout' ? 'Complete payment in the checkout window…' : stage === 'confirming' ? 'Confirming payment…' : `Pay ${fmtINR(amt)} via ${METHOD_LABEL[method]}`}
            </button>
            <p className="text-center text-[12px] text-black/40 dark:text-white/40">Secured by the school's payment gateway. A receipt is issued as soon as the payment is confirmed.</p>
            <button onClick={close} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-full py-2 text-[13px] font-semibold text-black/50 dark:text-white/50 hover:bg-black/[.05] dark:hover:bg-white/[.07] disabled:opacity-40">
              <ArrowLeft size={14} /> Cancel and return
            </button>
          </div>
        )}
      </Modal>
    </div>
  )
}
