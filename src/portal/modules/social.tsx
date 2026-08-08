import { useEffect, useMemo, useRef, useState } from 'react'
import { BrainCircuit, CheckCheck, ChevronLeft, Heart, ImageIcon, MessageCircle, MessageSquare, Phone, Play, Search, Send, Smile, Sparkles, Video } from 'lucide-react'
import { useStore } from '@/lib/store'
import { HIGHLIGHTS } from '@/lib/data'
import type { Message, Thread, User } from '@/lib/data'
import { Avatar, Card, Empty, PageHead, Pill, inputCls } from '../ui'
import { useTerm } from '../Portal'

/* ── helpers for viewer-relative threads ───────────────── */

function isMine(m: Message, thread: Thread, user: User | null) {
  if (thread.kind === 'teacher') return m.from === 'me'
  // parent-kind threads are seeded from the parent/student perspective
  if (user?.role === 'teacher') return m.from === 'them'
  return m.from === 'me'
}

function myFrom(thread: Thread, user: User | null): 'me' | 'them' {
  if (thread.kind === 'teacher') return 'me'
  if (user?.role === 'teacher') return 'them'
  return 'me'
}

function otherName(thread: Thread, user: User | null) {
  if (thread.kind === 'teacher') return thread.person
  if (user?.role === 'teacher') return thread.parentName || 'Parent'
  return thread.person
}

function otherHue(thread: Thread, user: User | null) {
  if (thread.kind === 'teacher') return 190
  if (user?.role === 'teacher') return 25
  return 262
}

function autoReplyText(thread: Thread, user: User | null): string {
  const firstName = (name: string) => name.split(' ')[0]
  const other = otherName(thread, user)
  if (thread.kind === 'teacher') return `Got it, ${firstName(user?.name ?? 'colleague')}. I'll review and update the roster if needed.`
  if (user?.role === 'teacher') return `Thank you, ${firstName(other)}. We'll follow up at home and let you know if anything is needed.`
  return `Thanks for the message — I'll get back to you right after class. 🙌`
}

/* ── School feed (all terms, always live) ──────────────── */

const FEED_EMOJI: Record<string, string> = { f1: '🏆', f2: '🌒', f3: '📋', f4: '🎨', f5: '🎉' }

export function FeedMod() {
  const { db, update, user } = useStore()
  const posts = db.feed
  const [commentFor, setCommentFor] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const toggleLike = (id: string) => update(d => {
    const p = d.feed.find(f => f.id === id)!
    p.liked = !p.liked; p.likes += p.liked ? 1 : -1
    return d
  })
  const addComment = (id: string) => {
    if (!draft.trim()) return
    update(d => { d.feed.find(f => f.id === id)!.comments.push({ by: user?.name ?? 'You', text: draft.trim() }); return d })
    setDraft(''); setCommentFor(null)
  }

  const placeholder = (tag: string) => {
    if (tag.includes('Sports')) return '🏆'
    if (tag.includes('Exam') || tag.includes('Academic')) return '📝'
    if (tag.includes('Art') || tag.includes('Cultural')) return '🎨'
    return '📢'
  }

  return (
    <div>
      <PageHead title="School Feed" sub="Everything happening around campus, as it happens" />
      <div className="mx-auto grid max-w-5xl gap-6">
        {posts.map((p) => (
          <Card key={p.id} className="p-0 overflow-hidden">
            <div className="flex items-center gap-3.5 p-5 pb-4">
              <div className="rounded-full bg-gradient-to-tr from-indigo-500 via-fuchsia-500 to-amber-400 p-[2.5px]">
                <span className="block rounded-full bg-white dark:bg-[#14141f] p-[2px]">
                  <Avatar name={p.author} hue={p.author.includes('Club') || p.author.includes('Art') ? 180 : 262} size={42} />
                </span>
              </div>
              <div className="flex-1">
                <p className="text-[15.5px] font-semibold">{p.author}</p>
                <p className="text-[12.5px] text-black/45 dark:text-white/45">{p.role} · {p.time}</p>
              </div>
              <Pill tone="indigo">{p.tag}</Pill>
            </div>
            <div className="relative flex h-48 items-center justify-center overflow-hidden sm:h-56" style={{ background: p.gradient }}>
              <span className="text-4xl opacity-90 drop-shadow-lg">{FEED_EMOJI[p.id] ?? placeholder(p.tag)}</span>
              <span className="absolute inset-0 bg-gradient-to-t from-black/25 to-transparent" />
              <span className="absolute bottom-3 right-3 flex items-center gap-1 rounded-md bg-black/50 px-2 py-0.5 text-[11px] font-semibold text-white">
                <ImageIcon size={12} /> {p.tag}
              </span>
            </div>
            <div className="p-5">
              <p className="text-[15px] leading-relaxed text-black/75 dark:text-white/75">{p.text}</p>
              <div className="mt-5 flex items-center gap-6 border-t border-black/[.06] dark:border-white/[.08] pt-5">
                <button onClick={() => toggleLike(p.id)}
                  className={`flex items-center gap-1.5 text-[14px] font-semibold transition-transform active:scale-125 ${p.liked ? 'text-rose-500' : 'text-black/50 dark:text-white/50 hover:text-rose-500'}`}>
                  <Heart size={18} fill={p.liked ? 'currentColor' : 'none'} className={p.liked ? 'animate-[bubbleIn_.3s]' : ''} /> {p.likes}
                </button>
                <button onClick={() => setCommentFor(commentFor === p.id ? null : p.id)} className="flex items-center gap-1.5 text-[14px] font-semibold text-black/50 dark:text-white/50 hover:text-indigo-600">
                  <MessageCircle size={18} /> {p.comments.length}
                </button>
              </div>
              {p.comments.map((c, i) => (
                <div key={i} className="mt-3.5 flex gap-2.5 text-[13.5px]">
                  <Avatar name={c.by} hue={200} size={28} />
                  <p className="rounded-2xl bg-black/[.04] dark:bg-white/[.06] px-3.5 py-2"><b>{c.by}</b> · {c.text}</p>
                </div>
              ))}
              {commentFor === p.id && (
                <div className="fade-in mt-4 flex gap-2">
                  <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && addComment(p.id)}
                    placeholder="Write a comment…" className={inputCls} autoFocus />
                  <button onClick={() => addComment(p.id)} className="btn-ink px-4"><Send size={15} /></button>
                </div>
              )}
            </div>
          </Card>
        ))}
        {posts.length === 0 && <Empty text="Nothing posted yet." />}
      </div>
    </div>
  )
}

/* ── Messages — premium chat ───────────────────────────── */

export function MessagesMod() {
  const { db, update, user } = useStore()
  const { term, setTerm } = useTerm()
  const isTeacher = user?.role === 'teacher'
  const [tab, setTab] = useState<'parent' | 'teacher'>('parent')

  const baseThreads = useMemo(() => db.threads.filter(t => t.term === term), [db.threads, term])
  const filteredThreads = useMemo(() => {
    if (isTeacher) return baseThreads.filter(t => t.kind === tab)
    return baseThreads.filter(t => t.kind === 'parent' || !t.kind)
  }, [baseThreads, isTeacher, tab])

  const [activeId, setActiveId] = useState(filteredThreads[0]?.id ?? '')
  const [text, setText] = useState('')
  const [typing, setTyping] = useState(false)
  const [query, setQuery] = useState('')
  const [mobileChat, setMobileChat] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const active = useMemo(() => {
    const found = filteredThreads.find(t => t.id === activeId)
    return found && filteredThreads.some(t => t.id === found.id) ? found : filteredThreads[0]
  }, [filteredThreads, activeId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [active?.messages.length, typing, activeId])

  const send = () => {
    if (!text.trim() || !active) return
    const id = active.id
    const from = myFrom(active, user)
    update(d => {
      d.threads.find(t => t.id === id)!.messages.push({ from, text: text.trim(), time: 'Just now' })
      return d
    })
    setText('')
    setTyping(true)
    setTimeout(() => {
      setTyping(false)
      update(d => {
        const replyFrom: 'me' | 'them' = from === 'me' ? 'them' : 'me'
        d.threads.find(t => t.id === id)!.messages.push({ from: replyFrom, text: autoReplyText(active, user), time: 'Just now' })
        return d
      })
    }, 2100)
  }

  const openThread = (id: string) => {
    setActiveId(id); setMobileChat(true)
    update(d => { const th = d.threads.find(x => x.id === id); if (th) th.unread = 0; return d })
  }

  const visible = filteredThreads.filter(t => t.person.toLowerCase().includes(query.toLowerCase()))

  const title = isTeacher ? 'Messages' : 'Teacher Messages'
  const sub = isTeacher ? 'Direct conversations with parents and faculty' : 'Direct, verified conversations with teachers'

  const ThreadList = (
    <div className="flex h-full flex-col">
      <div className="border-b border-black/[.06] dark:border-white/[.08] p-4">
        {isTeacher && (
          <div className="mb-3 inline-flex rounded-full border border-black/[.08] dark:border-white/[.1] bg-white dark:bg-[#14141f] p-1">
            {(['parent', 'teacher'] as const).map(k => (
              <button key={k} onClick={() => setTab(k)}
                className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-all ${tab === k ? 'bg-black text-white shadow' : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'}`}>
                {k === 'parent' ? 'Parents' : 'Teachers'}
              </button>
            ))}
          </div>
        )}
        <div className="relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-black/30 dark:text-white/30" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search chats"
            className="w-full rounded-full border border-black/[.08] dark:border-white/[.1] bg-black/[.03] dark:bg-white/[.05] py-2.5 pl-10 pr-4 text-[13.5px] outline-none transition focus:border-indigo-400 focus:bg-white dark:focus:bg-[#14141f]" />
        </div>
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto thin-scroll">
        {visible.map((t) => {
          const name = otherName(t, user)
          const hue = otherHue(t, user)
          const last = t.messages[t.messages.length - 1]
          return (
            <button key={t.id} onClick={() => openThread(t.id)}
              className={`group flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-all ${active?.id === t.id ? 'bg-gradient-to-r from-indigo-500/[.09] to-transparent' : 'hover:bg-black/[.02] dark:hover:bg-white/[.04]'}`}>
              <span className="relative">
                <Avatar name={name} hue={hue} size={46} />
                <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white dark:border-[#14141f] bg-emerald-400" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between">
                  <span className="truncate text-[14.5px] font-semibold">{name}</span>
                  <span className="ml-2 shrink-0 text-[10.5px] text-black/35 dark:text-white/35">{last?.time.split(' ')[0]}</span>
                </span>
                <span className="mt-0.5 flex items-center justify-between gap-2">
                  <span className={`truncate text-[12.5px] ${t.unread ? 'font-semibold text-black dark:text-white' : 'text-black/45 dark:text-white/45'}`}>
                    {last && isMine(last, t, user) && <CheckCheck size={13} className="mr-1 inline text-indigo-400" />}
                    {last?.text}
                  </span>
                  {t.unread > 0 && <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 px-1.5 text-[10px] font-bold text-white">{t.unread}</span>}
                </span>
              </span>
            </button>
          )
        })}
        {visible.length === 0 && <div className="p-6"><Empty text="No chats found." /></div>}
      </div>
    </div>
  )

  const ChatPane = active ? (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="flex items-center gap-3 border-b border-black/[.06] dark:border-white/[.08] px-4 py-3 sm:px-5">
        <button onClick={() => setMobileChat(false)} className="rounded-full p-1.5 hover:bg-black/[.05] dark:hover:bg-white/[.08] md:hidden">
          <ChevronLeft size={20} />
        </button>
        <span className="relative">
          <Avatar name={otherName(active, user)} hue={otherHue(active, user)} size={40} />
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white dark:border-[#14141f] bg-emerald-400" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14.5px] font-semibold">{otherName(active, user)}</p>
          <p className="truncate text-[11.5px] font-medium text-emerald-500">{typing ? 'typing…' : `online · ${active.subtitle}`}</p>
        </div>
        <button className="rounded-full bg-black/[.04] dark:bg-white/[.06] p-2.5 text-black/50 dark:text-white/50 transition hover:bg-black/[.08] dark:hover:bg-white/[.12] hover:text-indigo-600"><Phone size={16} /></button>
        <button className="rounded-full bg-black/[.04] dark:bg-white/[.06] p-2.5 text-black/50 dark:text-white/50 transition hover:bg-black/[.08] dark:hover:bg-white/[.12] hover:text-indigo-600"><Video size={16} /></button>
      </div>

      {/* bubbles */}
      <div className="flex-1 space-y-1.5 overflow-y-auto bg-[#f2f1ee] dark:bg-[#0c0c14] px-4 py-5 thin-scroll sm:px-6">
        <p className="pb-3 text-center text-[11px] font-medium text-black/35 dark:text-white/30">🔒 Verified conversation · {active.subtitle}</p>
        {active.messages.map((m, i) => {
          const mine = isMine(m, active, user)
          const prev = active.messages[i - 1]
          const sameAsPrev = prev && isMine(prev, active, user) === mine
          return (
            <div key={i} className={`bubble-in flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'} ${sameAsPrev ? '' : 'pt-2'}`}>
              {!mine && (
                <span className="w-7 shrink-0">
                  {!sameAsPrev && <Avatar name={otherName(active, user)} hue={otherHue(active, user)} size={28} />}
                </span>
              )}
              <div className={`max-w-[75%] px-4 py-2.5 text-[13.5px] leading-relaxed sm:max-w-[65%] ${mine
                ? `chat-me ${sameAsPrev ? 'rounded-2xl rounded-br-md' : 'rounded-2xl rounded-br-sm'}`
                : `chat-them ${sameAsPrev ? 'rounded-2xl rounded-bl-md' : 'rounded-2xl rounded-bl-sm'}`}`}>
                {m.text}
                <span className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${mine ? 'text-white/70' : 'text-black/35 dark:text-white/35'}`}>
                  {m.time}{mine && <CheckCheck size={12} />}
                </span>
              </div>
            </div>
          )
        })}
        {typing && (
          <div className="bubble-in flex items-end gap-2">
            <Avatar name={otherName(active, user)} hue={otherHue(active, user)} size={28} />
            <div className="chat-them flex gap-1.5 rounded-2xl rounded-bl-sm px-4 py-3.5">
              <span className="typing-dot h-2 w-2 rounded-full bg-black/40 dark:bg-white/50" />
              <span className="typing-dot h-2 w-2 rounded-full bg-black/40 dark:bg-white/50" />
              <span className="typing-dot h-2 w-2 rounded-full bg-black/40 dark:bg-white/50" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* composer */}
      <div className="flex items-center gap-2 border-t border-black/[.06] dark:border-white/[.08] bg-white dark:bg-[#14141f] p-3 sm:p-4">
        <button className="rounded-full p-2 text-black/40 dark:text-white/40 transition hover:text-amber-500"><Smile size={20} /></button>
        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()}
          placeholder={`Message ${otherName(active, user).split(' ')[0]}…`}
          className="w-full rounded-full border border-black/[.08] dark:border-white/[.1] bg-black/[.03] dark:bg-white/[.05] px-5 py-3 text-[14px] outline-none transition focus:border-indigo-400 focus:bg-white dark:focus:bg-[#1a1a27] focus:ring-4 focus:ring-indigo-100 dark:focus:ring-indigo-500/10" />
        <button onClick={send} disabled={!text.trim()}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-lg shadow-indigo-500/30 transition-all hover:scale-105 active:scale-95 disabled:opacity-40 disabled:shadow-none">
          <Send size={17} className="-ml-0.5 mt-0.5" />
        </button>
      </div>
    </div>
  ) : (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-black/35 dark:text-white/30">
      <MessageCircle size={40} />
      <p className="text-[14px] font-medium">Pick a conversation to start</p>
    </div>
  )

  return (
    <div>
      <PageHead title={title} sub={sub}>
        <TermBar term={term} setTerm={setTerm} />
      </PageHead>
      <Card className="h-[calc(100dvh-280px)] min-h-[480px] overflow-hidden p-0 md:h-[620px]">
        {/* desktop: side-by-side · mobile: list OR chat */}
        <div className="hidden h-full md:grid md:grid-cols-[320px_1fr]">
          <div className="border-r border-black/[.06] dark:border-white/[.08]">{ThreadList}</div>
          {ChatPane}
        </div>
        <div className="h-full md:hidden">
          {mobileChat && active ? ChatPane : ThreadList}
        </div>
      </Card>
    </div>
  )
}

function TermBar({ term, setTerm }: { term: string; setTerm: (t: string) => void }) {
  const { db } = useStore()
  return (
    <div className="inline-flex rounded-full border border-black/[.08] dark:border-white/[.1] bg-white dark:bg-[#14141f] p-1">
      {db.terms.map((t) => (
        <button key={t.id} onClick={() => setTerm(t.id)}
          className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-all ${term === t.id ? 'bg-black text-white shadow' : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'}`}>
          {t.name}{t.current ? ' ·' : ''}
        </button>
      ))}
    </div>
  )
}

/* ── Event highlights (YouTube) ────────────────────────── */

export function HighlightsMod() {
  const [play, setPlay] = useState<string | null>(null)
  return (
    <div>
      <PageHead title="Event Highlights" sub="Official aftermovies and recordings" />
      <div className="grid gap-5 sm:grid-cols-2">
        {HIGHLIGHTS.map((h) => (
          <Card key={h.id} className="overflow-hidden p-0">
            {play === h.id ? (
              <iframe className="aspect-video w-full" src={`https://www.youtube.com/embed/${h.yt}?autoplay=1`}
                title={h.title} allow="autoplay; encrypted-media" allowFullScreen />
            ) : (
              <button onClick={() => setPlay(h.id)} className="group relative flex aspect-video w-full items-center justify-center bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-500">
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/95 dark:bg-[#14141f]/95 shadow-xl transition-transform group-hover:scale-110">
                  <Play size={24} className="ml-1 text-black dark:text-white" fill="currentColor" />
                </span>
                <span className="absolute bottom-3 right-3 rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">YouTube</span>
              </button>
            )}
            <div className="p-5">
              <p className="font-display text-[16px] font-medium">{h.title}</p>
              <p className="mt-0.5 text-[12.5px] text-black/45 dark:text-white/45">{h.date}</p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

/* ── AI doubt clearing ─────────────────────────────────── */

const AI_ANSWERS: [RegExp, string][] = [
  [/quadratic|x\^?2/i, 'For ax² + bx + c = 0, try factorising first. If that fails, use x = (−b ± √(b²−4ac)) / 2a. Example: x² − 5x + 6 = 0 factors to (x−2)(x−3), so x = 2 or 3. Want a worked problem?'],
  [/newton|force|f\s*=\s*ma/i, 'Newton’s second law: F = ma. A 2 kg mass accelerating at 3 m/s² feels 6 N. Remember force is a vector — direction matters as much as magnitude.'],
  [/photo|light reaction/i, 'Photosynthesis: 6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂, driven by light energy absorbed by chlorophyll. The light reactions make ATP/NADPH; the Calvin cycle fixes carbon.'],
  [/tense|grammar|english/i, 'Quick rule: use present perfect (“has finished”) for actions connected to now, past simple (“finished”) for completed past with a time marker. “She has finished her homework” vs “She finished it yesterday.”'],
]

const SUGGESTIONS = [
  'How do I solve quadratic equations?',
  'Explain Newton’s second law',
  'What happens in photosynthesis?',
  'When do I use present perfect vs past simple?',
]

const aiTsId = () => Date.now()

export function AIDoubtsMod() {
  const [log, setLog] = useState<{ id: string; q: string; a: string }[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [thinking, setThinking] = useState(false)

  const active = activeId ? log.find(m => m.id === activeId) : null

  const ask = (question?: string) => {
    const raw = (question ?? q).trim()
    if (!raw) return
    const id = 'ai_' + aiTsId()
    setQ('')
    setThinking(true)
    if (question) setActiveId(id)
    setTimeout(() => {
      const hit = AI_ANSWERS.find(([re]) => re.test(raw))
      const a = hit ? hit[1] : `Great question! Here’s how I’d approach “${raw}”: break it into what’s given, what’s asked, and which chapter formula connects them. For Class X, this maps to your current Term 3 syllabus — check the worked examples in your notes, and ask your subject teacher during doubt hour if you’d like it on the board.`
      setLog(l => [...l, { id, q: raw, a }])
      setActiveId(id)
      setThinking(false)
    }, 1100)
  }

  const HistorySidebar = (
    <div className="flex h-full flex-col border-b border-black/[.06] dark:border-white/[.08] md:border-b-0 md:border-r">
      <div className="flex items-center gap-3 border-b border-black/[.06] dark:border-white/[.08] px-4 py-3.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white"><BrainCircuit size={18} /></span>
        <div>
          <p className="text-[13.5px] font-semibold">Nova Tutor</p>
          <p className="text-[11px] text-black/40 dark:text-white/40">History</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 thin-scroll">
        {log.length === 0 && (
          <div className="px-3 py-6 text-center text-[12.5px] text-black/35 dark:text-white/35">
            <MessageSquare size={28} className="mx-auto mb-2" />
            No questions yet.
          </div>
        )}
        {log.map((m) => (
          <button key={m.id} onClick={() => setActiveId(m.id)}
            className={`w-full rounded-xl px-3 py-2.5 text-left transition ${activeId === m.id ? 'bg-indigo-50 dark:bg-indigo-500/15' : 'hover:bg-black/[.04] dark:hover:bg-white/[.06]'}`}>
            <p className={`truncate text-[13px] font-medium ${activeId === m.id ? 'text-indigo-700 dark:text-indigo-300' : 'text-black/70 dark:text-white/70'}`}>{m.q}</p>
            <p className="truncate text-[11.5px] text-black/40 dark:text-white/40">{m.a.slice(0, 50)}…</p>
          </button>
        ))}
      </div>
    </div>
  )

  const ChatArea = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-black/[.06] dark:border-white/[.08] px-4 py-3 sm:px-5">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white"><BrainCircuit size={20} /></span>
        <div>
          <p className="text-[14.5px] font-semibold">Nova Tutor</p>
          <p className="text-[11.5px] text-emerald-600">● trained on Class X syllabus</p>
        </div>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto bg-[#fafafa] dark:bg-[#0e0e17] p-4 sm:p-5 thin-scroll">
        {!active && log.length === 0 && (
          <div className="mt-12 text-center sm:mt-16">
            <Sparkles size={30} className="mx-auto text-indigo-400" />
            <p className="mt-3 text-[15px] font-semibold">Ask anything from your subjects</p>
            <p className="mt-1 text-[13px] text-black/40 dark:text-white/40">Your syllabus-aware tutor is ready. Pick a suggestion or type your own doubt.</p>
            <div className="mx-auto mt-5 flex max-w-lg flex-wrap justify-center gap-2">
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => ask(s)}
                  className="rounded-full bg-white dark:bg-[#14141f] px-4 py-2 text-[12.5px] text-black/60 dark:text-white/60 ring-1 ring-black/[.07] dark:ring-white/10 hover:text-black dark:hover:text-white hover:ring-indigo-300">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {active && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <p className="max-w-[80%] rounded-2xl rounded-br-md bg-black px-4 py-2.5 text-[13.5px] text-white">{active.q}</p>
            </div>
            <div className="flex justify-start">
              <div className="max-w-[85%] overflow-hidden rounded-2xl rounded-tl-md bg-white dark:bg-[#14141f] ring-1 ring-black/[.07] dark:ring-white/10">
                <div className="h-1 w-full bg-gradient-to-r from-indigo-500 to-fuchsia-500" />
                <div className="flex items-start gap-3 px-4 py-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white"><BrainCircuit size={14} /></span>
                  <p className="text-[13.5px] leading-relaxed">{active.a}</p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => ask(s)} className="rounded-full bg-white dark:bg-[#14141f] px-3 py-1.5 text-[11.5px] text-black/50 dark:text-white/50 ring-1 ring-black/[.06] dark:ring-white/10 hover:text-indigo-600 dark:hover:text-indigo-300">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {thinking && (
          <div className="flex items-start gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white"><BrainCircuit size={16} /></span>
            <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md bg-white dark:bg-[#14141f] px-4 py-3 ring-1 ring-black/[.07] dark:ring-white/10">
              <span className="typing-dot h-2 w-2 rounded-full bg-black/40 dark:bg-white/50" />
              <span className="typing-dot h-2 w-2 rounded-full bg-black/40 dark:bg-white/50" />
              <span className="typing-dot h-2 w-2 rounded-full bg-black/40 dark:bg-white/50" />
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-black/[.06] dark:border-white/[.08] bg-white dark:bg-[#14141f] p-3 sm:p-4">
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && ask()}
          placeholder="Type your doubt…" className={`${inputCls} min-w-0 flex-1`} />
        <button onClick={() => ask()} className="btn-ink px-5"><Send size={16} /></button>
      </div>
    </div>
  )

  return (
    <div>
      <PageHead title="AI Doubt Clearing" sub="Curriculum-aware answers, any hour of the night" />
      <Card className="flex h-[520px] flex-col overflow-hidden p-0 md:grid md:grid-cols-[280px_1fr]">
        {HistorySidebar}
        {ChatArea}
      </Card>
    </div>
  )
}
