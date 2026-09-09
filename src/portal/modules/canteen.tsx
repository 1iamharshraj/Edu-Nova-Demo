import { useState } from 'react'
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, Banknote, CheckCircle2, CreditCard, Landmark, Scale, ShoppingBag, Smartphone, Utensils, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { ApiError, errorMessage } from '@/lib/api'
import type { PaymentMethod, WalletTransaction } from '@/lib/data'
import { fmtDate } from '@/lib/hooks/useAcademics'
import { toPaise } from '@/lib/hooks/useAccounting'
import { fmtWallet, useCanteenReconciliation, usePurchaseWallet, useTopUpWallet, useWallet, useWalletTransactions, WALLET_TXN_LABEL } from '@/lib/hooks/useCanteen'
import { Card, Empty, Field, Modal, PageHead, inputCls } from '../ui'
import { AsyncEntityPicker } from '../components/AsyncEntityPicker'
import { WardPicker } from './academics'
import { useWard } from './viewer'

// Phase 30 — Canteen prepaid wallet (frontend). Reuses the Payment Gateway's top-up-form UI pattern
// (paymentGateway.tsx) and the student search pattern from library.tsx's BorrowerPicker. Endpoint shapes
// reconciled against the live server/src/modules/canteen/{router,schema,service}.ts once it landed — see
// useCanteen.ts's header note (wire amounts are decimal rupees, same convention as Payment.amount
// everywhere else; GET /wallets/:id returns `{studentId,balance,recent}`, the transactions endpoint
// returns `{studentId,balance,items}` with each row's true running balance, and reconciliation is a
// dedicated `GET /canteen/reconciliation` admin summary rather than a per-wallet list). See
// .agents/edunova/phase-30-canteen-wallet.md

const GATEWAY_METHODS: PaymentMethod[] = ['UPI', 'Card', 'NetBanking', 'Cash']
const METHOD_LABEL: Record<PaymentMethod, string> = { UPI: 'UPI', Card: 'Card', NetBanking: 'Net banking', Cash: 'Cash', Cheque: 'Cheque' }
const methodIcon = (m: PaymentMethod) => (m === 'UPI' ? <Smartphone size={15} /> : m === 'Card' ? <CreditCard size={15} /> : m === 'Cash' ? <Banknote size={15} /> : <Landmark size={15} />)
const muted = 'text-[12.5px] text-black/50 dark:text-white/50'

function TxnRow({ t }: { t: WalletTransaction }) {
  const positive = t.amount >= 0
  return (
    <div className="flex items-center gap-3 border-b border-black/[.05] dark:border-white/[.07] px-5 py-3 last:border-0">
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${positive ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300'}`}>
        {positive ? <ArrowUpCircle size={16} /> : <ArrowDownCircle size={16} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-semibold">{WALLET_TXN_LABEL[t.type]}{t.itemsSummary ? ` · ${t.itemsSummary}` : ''}</p>
        <p className={muted}>{fmtDate(t.occurredAt, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}{t.reason ? ` · ${t.reason}` : ''}</p>
      </div>
      <div className="text-right">
        <p className={`text-[14px] font-bold ${positive ? 'text-emerald-600' : 'text-rose-600'}`}>{positive ? '+' : '−'}{fmtWallet(Math.abs(t.amount))}</p>
        {t.runningBalance !== undefined && <p className={muted}>Bal. {fmtWallet(t.runningBalance)}</p>}
      </div>
    </div>
  )
}

function SpendLog({ studentId, enabled, title }: { studentId?: string; enabled: boolean; title: string }) {
  const txns = useWalletTransactions(studentId, {}, enabled)
  const rows = txns.data?.items ?? []
  return (
    <Card className="p-0">
      <p className="border-b border-black/[.06] px-5 py-3.5 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:border-white/[.08] dark:text-white/40">{title}</p>
      {txns.loading ? <div className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading…</div>
        : txns.error ? <div className="p-6"><Empty text={txns.error} /></div>
        : rows.length === 0 ? <div className="p-6"><Empty text="No wallet activity yet." /></div>
        : rows.map(t => <TxnRow key={t.id} t={t} />)}
    </Card>
  )
}

/* ── Parent-facing: wallet card + top-up + spend log ──────────────────────── */

export function CanteenWalletMod() {
  const { students, ward, wardId, setWardId } = useWard()
  const wallet = useWallet(wardId, !!wardId)
  const topUp = useTopUpWallet()

  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('500')
  const [method, setMethod] = useState<PaymentMethod>('UPI')
  const [busy, setBusy] = useState(false)
  const amt = Math.max(0, Number(amount) || 0)

  const balance = wallet.data?.balance ?? 0

  const doTopUp = async () => {
    if (!wardId || amt <= 0) return
    setBusy(true)
    try {
      await topUp(wardId, { amount: amt, method })
      toast.success(`${fmtWallet(amt)} added to ${ward?.name ?? 'the'} wallet`)
      wallet.reload()
      setOpen(false); setAmount('500')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <div>
      <PageHead title="Canteen Wallet" sub={ward ? `Prepaid canteen balance for ${ward.name}` : 'Prepaid canteen balance'}>
        <WardPicker students={students} value={wardId} onChange={setWardId} />
      </PageHead>

      {!ward ? (
        <Card><Empty text="No student is linked to your account yet." /></Card>
      ) : (
        <div className="space-y-5">
          <Card className="flex flex-wrap items-center gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-500/10"><Wallet size={22} className="text-indigo-600 dark:text-indigo-300" /></span>
            <div className="flex-1">
              <p className="text-[12px] uppercase tracking-wider text-black/40 dark:text-white/40">Wallet balance</p>
              <p className="font-display text-2xl font-medium">{wallet.loading ? '…' : fmtWallet(balance)}</p>
            </div>
            <button onClick={() => setOpen(true)} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold">
              <CreditCard size={14} /> Top up
            </button>
          </Card>

          <SpendLog studentId={wardId} enabled={!!wardId} title="Spend log" />
        </div>
      )}

      <Modal open={open} onClose={() => !busy && setOpen(false)} title="Top up canteen wallet">
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-2xl bg-indigo-50 p-4 dark:bg-indigo-500/10">
            <Utensils className="text-indigo-600 dark:text-indigo-300" size={22} />
            <div>
              <p className="text-[13.5px] font-semibold text-indigo-900 dark:text-indigo-100">{ward?.name}</p>
              <p className="text-[12.5px] text-indigo-700/80 dark:text-indigo-200/70">Current balance {fmtWallet(balance)}</p>
            </div>
          </div>
          <Field label="Amount (₹)">
            <input type="number" min={1} value={amount} onChange={e => setAmount(e.target.value)} disabled={busy} className={inputCls} inputMode="numeric" />
          </Field>
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
          <button onClick={doTopUp} disabled={busy || amt <= 0} className="btn-ink flex w-full items-center justify-center gap-2 py-3 text-[14px] font-semibold disabled:opacity-40">
            {busy ? 'Adding funds…' : `Add ${fmtWallet(amt)} to wallet`}
          </button>
        </div>
      </Modal>
    </div>
  )
}

/* ── Student self-view: read-only balance + recent spend ─────────────────── */

export function MyWalletMod() {
  const { user } = useStore()
  const wallet = useWallet(user?.id, !!user)
  const balance = wallet.data?.balance ?? 0

  return (
    <div>
      <PageHead title="My Canteen Wallet" sub="Your prepaid canteen balance and recent spend" />
      <div className="space-y-5">
        <Card className="flex items-center gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-500/10"><Wallet size={22} className="text-indigo-600 dark:text-indigo-300" /></span>
          <div>
            <p className="text-[12px] uppercase tracking-wider text-black/40 dark:text-white/40">Wallet balance</p>
            <p className="font-display text-2xl font-medium">{wallet.loading ? '…' : fmtWallet(balance)}</p>
          </div>
        </Card>
        <SpendLog studentId={user?.id} enabled={!!user} title="Recent spend" />
      </div>
    </div>
  )
}

/* ── Canteen-staff-facing: point of sale ──────────────────────────────────── */

export function CanteenPOSMod() {
  const [studentId, setStudentId] = useState('')
  const wallet = useWallet(studentId, !!studentId)
  const purchase = usePurchaseWallet()
  const [amount, setAmount] = useState('')
  const [items, setItems] = useState('')
  const [busy, setBusy] = useState(false)
  const [rejected, setRejected] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ amount: number; balance: number } | null>(null)

  const balance = wallet.data?.balance ?? 0
  const amt = Math.max(0, Number(amount) || 0)
  // Float-safe compare: same integer-paise convention as the accounting module's balance check.
  const insufficient = amt > 0 && toPaise(amt) > toPaise(balance)

  const reset = () => { setAmount(''); setItems(''); setRejected(null); setSuccess(null) }
  const pickStudent = (id: string) => { setStudentId(id); reset() }

  const doPurchase = async () => {
    if (!studentId || amt <= 0) return
    setBusy(true); setRejected(null); setSuccess(null)
    try {
      const res = await purchase(studentId, { amount: amt, itemsSummary: items.trim() || undefined })
      setSuccess({ amount: amt, balance: res.wallet.balance })
      setAmount(''); setItems('')
      wallet.reload()
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) setRejected(errorMessage(e))
      else toast.error(errorMessage(e))
    } finally { setBusy(false) }
  }

  return (
    <div>
      <PageHead title="Canteen Point of Sale" sub="Search a student to check balance and record a purchase" />

      <Card className="mb-5">
        <p className="text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Student</p>
        <div className="mt-3"><AsyncEntityPicker role="student" value={studentId} onChange={pickStudent} placeholder="Search by name or email…" /></div>
      </Card>

      {!studentId ? (
        <Card><Empty text="Search for a student to begin a sale." /></Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="flex items-center gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-500/10"><Wallet size={22} className="text-indigo-600 dark:text-indigo-300" /></span>
            <div>
              <p className="text-[12px] uppercase tracking-wider text-black/40 dark:text-white/40">Current balance</p>
              <p className="font-display text-2xl font-medium">{wallet.loading ? '…' : fmtWallet(balance)}</p>
            </div>
          </Card>

          <Card>
            <p className="text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">New sale</p>
            {success ? (
              <div className="mt-4 flex flex-col items-center py-4 text-center">
                <CheckCircle2 size={44} className="text-emerald-500" />
                <p className="mt-3 text-[15px] font-semibold">{fmtWallet(success.amount)} charged</p>
                <p className={`mt-1 ${muted}`}>New balance {fmtWallet(success.balance)}</p>
                <button onClick={reset} className="mt-4 rounded-full bg-black/[.06] dark:bg-white/[.08] px-4 py-2 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">New sale</button>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <Field label="Purchase amount (₹)">
                  <input type="number" min={1} value={amount} onChange={e => { setAmount(e.target.value); setRejected(null) }} disabled={busy} className={inputCls} inputMode="numeric" autoFocus />
                </Field>
                <Field label="Items (optional)">
                  <input value={items} onChange={e => setItems(e.target.value)} placeholder="e.g. 2x Samosa, 1x Juice" disabled={busy} className={inputCls} />
                </Field>
                {insufficient && (
                  <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                    <span>Insufficient balance — {fmtWallet(balance)} available, {fmtWallet(amt)} requested.</span>
                  </div>
                )}
                {rejected && (
                  <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                    <span>{rejected}</span>
                  </div>
                )}
                <button onClick={doPurchase} disabled={busy || amt <= 0 || insufficient} className="btn-ink flex w-full items-center justify-center gap-2 py-3 text-[14px] font-semibold disabled:opacity-40">
                  <ShoppingBag size={15} /> {busy ? 'Charging…' : `Charge ${amt > 0 ? fmtWallet(amt) : ''}`}
                </button>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}

/* ── Admin-facing: reconciliation ─────────────────────────────────────────── */

export function CanteenReconciliationMod() {
  const recon = useCanteenReconciliation()
  const data = recon.data
  const loading = recon.loading

  return (
    <div>
      <PageHead title="Canteen Wallet Reconciliation" sub="Sum of student wallet balances vs. the GL's Canteen Wallet Liability account" />

      {recon.error ? <Card><Empty text={recon.error} /></Card> : (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="flex items-center gap-4">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-500/10"><Wallet size={20} className="text-indigo-600 dark:text-indigo-300" /></span>
            <div>
              <p className="text-[12px] uppercase tracking-wider text-black/40 dark:text-white/40">Wallets outstanding ({loading ? '…' : data?.walletCount ?? 0})</p>
              <p className="font-display text-2xl font-medium">{loading ? '…' : fmtWallet(data?.sumWalletBalances ?? 0)}</p>
            </div>
          </Card>
          <Card className="flex items-center gap-4">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-50 dark:bg-sky-500/10"><Landmark size={20} className="text-sky-600 dark:text-sky-300" /></span>
            <div>
              <p className="text-[12px] uppercase tracking-wider text-black/40 dark:text-white/40">GL Canteen Wallet Liability</p>
              <p className="font-display text-2xl font-medium">{loading ? '…' : fmtWallet(data?.glLiabilityBalance ?? 0)}</p>
            </div>
          </Card>
          <Card className={`flex items-center gap-4 ${loading || data?.reconciled ? '' : 'ring-1 ring-rose-300 dark:ring-rose-500/40'}`}>
            <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${loading ? 'bg-black/[.05] dark:bg-white/[.07]' : data?.reconciled ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'bg-rose-50 dark:bg-rose-500/10'}`}>
              <Scale size={20} className={loading ? 'text-black/40 dark:text-white/40' : data?.reconciled ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'} />
            </span>
            <div>
              <p className="text-[12px] uppercase tracking-wider text-black/40 dark:text-white/40">Reconciled</p>
              <p className={`font-display text-2xl font-medium ${loading ? '' : data?.reconciled ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>
                {loading ? '…' : data?.reconciled ? 'Yes' : 'Mismatch'}
              </p>
            </div>
          </Card>
        </div>
      )}

      {!loading && data && !data.reconciled && (
        <Card className="mt-5 flex items-start gap-2 border border-rose-200 bg-rose-50 text-[13px] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>Wallet balances ({fmtWallet(data.sumWalletBalances)}) do not tie to the GL liability account ({fmtWallet(data.glLiabilityBalance)}) — difference of {fmtWallet(Math.abs(data.sumWalletBalances - data.glLiabilityBalance))}. This should never happen — every top-up/purchase posts to both in the same operation.</span>
        </Card>
      )}
    </div>
  )
}
