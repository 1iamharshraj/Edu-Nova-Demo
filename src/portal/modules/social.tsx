import { useEffect, useRef, useState } from 'react'
import { BrainCircuit, CheckCheck, ChevronLeft, Heart, ImageIcon, MessageCircle, Phone, Play, Search, Send, Smile, Sparkles, Video } from 'lucide-react'
import { useStore } from '@/lib/store'
import { HIGHLIGHTS } from '@/lib/data'
import { Avatar, Card, Empty, PageHead, Pill, inputCls } from '../ui'
import { useTerm } from '../Portal'

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

  return (
    <div>
      <PageHead title="School Feed" sub="Everything happening around campus, as it happens" />
      <div className="mx-auto max-w-xl space-y-6">
        {posts.map((p) => (
          <Card key={p.id} className="p-0">
            <div className="flex items-center gap-3 p-5 pb-4">
              <div className="rounded-full bg-gradient-to-tr from-indigo-500 via-fuchsia-500 to-amber-400 p-[2.5px]">
                <span className="block rounded-full bg-white dark:bg-[#14141f] p-[2px]">
                  <Avatar name={p.author} hue={p.author.includes('Club') || p.author.includes('Art') ? 180 : 262} size={40} />
                </span>
              </div>
              <div className="flex-1">
                <p className="text-[14.5px] font-semibold">{p.author}</p>
                <p className="text-[12px] text-black/45 dark:text-white/45">{p.role} · {p.time}</p>
              </div>
              <Pill tone="indigo">{p.tag}</Pill>
            </div>
            <div className="relative flex h-52 items-center justify-center overflow-hidden" style={{ background: p.gradient }}>
              <span className="text-6xl drop-shadow-lg">{FEED_EMOJI[p.id] ?? '📸'}</span>
              <span className="absolute inset-0 bg-gradient-to-t from-black/25 to-transparent" />
              <ImageIcon size={18} className="absolute bottom-3 right-3 text-white/80" />
            </div>
            <div className="p-5">
              <p className="text-[14.5px] leading-relaxed text-black/75 dark:text-white/75">{p.text}</p>
              <div className="mt-4 flex items-center gap-5 border-t border-black/[.06] dark:border-white/[.08] pt-4">
                <button onClick={() => toggleLike(p.id)}
                  className={`flex items-center gap-1.5 text-[13.5px] font-semibold transition-transform active:scale-125 ${p.liked ? 'text-rose-500' : 'text-black/50 dark:text-white/50 hover:text-rose-500'}`}>
                  <Heart size={17} fill={p.liked ? 'currentColor' : 'none'} className={p.liked ? 'animate-[bubbleIn_.3s]' : ''} /> {p.likes}
                </button>
                <button onClick={() => setCommentFor(commentFor === p.id ? null : p.id)} className="flex items-center gap-1.5 text-[13.5px] font-semibold text-black/50 dark:text-white/50 hover:text-indigo-600">
                  <MessageCircle size={17} /> {p.comments.length}
                </button>
              </div>
              {p.comments.map((c, i) => (
                <div key={i} className="mt-3 flex gap-2.5 text-[13.5px]">
                  <Avatar name={c.by} hue={200} size={26} />
                  <p className="rounded-2xl bg-black/[.04] dark:bg-white/[.06] px-3.5 py-2"><b>{c.by}</b> · {c.text}</p>
                </div>
              ))}
              {commentFor === p.id && (
                <div className="fade-in mt-3 flex gap-2">
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
  const threads = db.threads.filter(t => t.term === term)
  const [activeId, setActiveId] = useState(threads[0]?.id ?? '')
  const active = db.threads.find(t => t.id === activeId) ?? threads[0]
  const [text, setText] = useState('')
  const [typing, setTyping] = useState(false)
  const [query, setQuery] = useState('')
  const [mobileChat, setMobileChat] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [active?.messages.length, typing, activeId])

  const send = () => {
    if (!text.trim() || !active) return
    const id = active.id
    update(d => {
      d.threads.find(t => t.id === id)!.messages.push({ from: 'me', text: text.trim(), time: 'Just now' })
      return d
    })
    setText('')
    setTyping(true)
    setTimeout(() => {
      setTyping(false)
      update(d => {
        d.threads.find(t => t.id === id)!.messages.push({ from: 'them', text: 'Thanks for the message — I’ll get back to you right after class. 🙌', time: 'Just now' })
        return d
      })
    }, 2100)
  }

  const openThread = (id: string) => {
    setActiveId(id); setMobileChat(true)
    update(d => { const th = d.threads.find(x => x.id === id); if (th) th.unread = 0; return d })
  }

  const visible = threads.filter(t => t.person.toLowerCase().includes(query.toLowerCase()))

  const ThreadList = (
    <div className="flex h-full flex-col">
      <div className="border-b border-black/[.06] dark:border-white/[.08] p-4">
        <div className="relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-black/30 dark:text-white/30" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search chats"
            className="w-full rounded-full border border-black/[.08] dark:border-white/[.1] bg-black/[.03] dark:bg-white/[.05] py-2.5 pl-10 pr-4 text-[13.5px] outline-none transition focus:border-indigo-400 focus:bg-white dark:focus:bg-[#14141f]" />
        </div>
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto thin-scroll">
        {visible.map((t, i) => (
          <button key={t.id} onClick={() => openThread(t.id)}
            className={`group flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-all ${active?.id === t.id ? 'bg-gradient-to-r from-indigo-500/[.09] to-transparent' : 'hover:bg-black/[.02] dark:hover:bg-white/[.04]'}`}>
            <span className="relative">
              <Avatar name={t.person} hue={(i * 70 + 40) % 360} size={46} />
              <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white dark:border-[#14141f] bg-emerald-400" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between">
                <span className="truncate text-[14.5px] font-semibold">{t.person}</span>
                <span className="ml-2 shrink-0 text-[10.5px] text-black/35 dark:text-white/35">{t.messages[t.messages.length - 1]?.time.split(' ')[0]}</span>
              </span>
              <span className="mt-0.5 flex items-center justify-between gap-2">
                <span className={`truncate text-[12.5px] ${t.unread ? 'font-semibold text-black dark:text-white' : 'text-black/45 dark:text-white/45'}`}>
                  {t.messages[t.messages.length - 1]?.from === 'me' && <CheckCheck size={13} className="mr-1 inline text-indigo-400" />}
                  {t.messages[t.messages.length - 1]?.text}
                </span>
                {t.unread > 0 && <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 px-1.5 text-[10px] font-bold text-white">{t.unread}</span>}
              </span>
            </span>
          </button>
        ))}
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
          <Avatar name={active.person} hue={130} size={40} />
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white dark:border-[#14141f] bg-emerald-400" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14.5px] font-semibold">{active.person}</p>
          <p className="truncate text-[11.5px] font-medium text-emerald-500">{typing ? 'typing…' : `online · ${active.subtitle}`}</p>
        </div>
        <button className="rounded-full bg-black/[.04] dark:bg-white/[.06] p-2.5 text-black/50 dark:text-white/50 transition hover:bg-black/[.08] dark:hover:bg-white/[.12] hover:text-indigo-600"><Phone size={16} /></button>
        <button className="rounded-full bg-black/[.04] dark:bg-white/[.06] p-2.5 text-black/50 dark:text-white/50 transition hover:bg-black/[.08] dark:hover:bg-white/[.12] hover:text-indigo-600"><Video size={16} /></button>
      </div>

      {/* bubbles */}
      <div className="flex-1 space-y-1.5 overflow-y-auto bg-[#f2f1ee] dark:bg-[#0c0c14] px-4 py-5 thin-scroll sm:px-6">
        <p className="pb-3 text-center text-[11px] font-medium text-black/35 dark:text-white/30">🔒 Verified conversation · {active.subtitle}</p>
        {active.messages.map((m, i) => {
          const mine = m.from === 'me'
          const prev = active.messages[i - 1]
          const sameAsPrev = prev && prev.from === m.from
          return (
            <div key={i} className={`bubble-in flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'} ${sameAsPrev ? '' : 'pt-2'}`}>
              {!mine && (
                <span className="w-7 shrink-0">
                  {!sameAsPrev && <Avatar name={active.person} hue={130} size={28} />}
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
            <Avatar name={active.person} hue={130} size={28} />
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
          placeholder={`Message ${active.person.split(' ')[0]}…`}
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
      <PageHead title={user?.role === 'teacher' ? 'Parent Messages' : 'Teacher Messages'} sub="Direct, verified conversations">
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

export function AIDoubtsMod() {
  const [log, setLog] = useState<{ q: string; a: string }[]>([])
  const [q, setQ] = useState('')
  const [thinking, setThinking] = useState(false)

  const ask = () => {
    if (!q.trim()) return
    const question = q.trim(); setQ(''); setThinking(true)
    setTimeout(() => {
      const hit = AI_ANSWERS.find(([re]) => re.test(question))
      const a = hit ? hit[1] : `Great question! Here’s how I’d approach “${question}”: break it into what’s given, what’s asked, and which chapter formula connects them. For Class X, this maps to your current Term 3 syllabus — check the worked examples in your notes, and ask your subject teacher during doubt hour if you’d like it on the board.`
      setLog(l => [...l, { q: question, a }]); setThinking(false)
    }, 1100)
  }

  return (
    <div>
      <PageHead title="AI Doubt Clearing" sub="Curriculum-aware answers, any hour of the night" />
      <div className="mx-auto max-w-2xl">
        <Card className="flex h-[520px] flex-col p-0">
          <div className="flex items-center gap-3 border-b border-black/[.06] dark:border-white/[.08] px-5 py-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white"><BrainCircuit size={20} /></span>
            <div>
              <p className="text-[14.5px] font-semibold">Nova Tutor</p>
              <p className="text-[11.5px] text-emerald-600">● trained on Class X syllabus</p>
            </div>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto bg-[#fafafa] dark:bg-[#0e0e17] p-5 thin-scroll">
            {log.length === 0 && (
              <div className="mt-16 text-center">
                <Sparkles size={30} className="mx-auto text-indigo-400" />
                <p className="mt-3 text-[15px] font-semibold">Ask anything from your subjects</p>
                <div className="mx-auto mt-5 grid max-w-sm gap-2">
                  {['How do I solve quadratic equations?', 'Explain Newton’s second law', 'What happens in photosynthesis?'].map(s => (
                    <button key={s} onClick={() => setQ(s)} className="rounded-xl bg-white dark:bg-[#14141f] px-4 py-2.5 text-left text-[13px] text-black/60 dark:text-white/60 ring-1 ring-black/[.07] dark:ring-white/10 hover:text-black dark:hover:text-white">{s}</button>
                  ))}
                </div>
              </div>
            )}
            {log.map((m, i) => (
              <div key={i} className="space-y-2.5">
                <div className="flex justify-end"><p className="max-w-[80%] rounded-2xl rounded-br-md bg-black px-4 py-2.5 text-[13.5px] text-white">{m.q}</p></div>
                <div className="flex justify-start"><p className="max-w-[85%] rounded-2xl rounded-bl-md bg-white dark:bg-[#14141f] px-4 py-3 text-[13.5px] leading-relaxed ring-1 ring-black/[.07] dark:ring-white/10">{m.a}</p></div>
              </div>
            ))}
            {thinking && <p className="text-[13px] text-black/40 dark:text-white/40">Nova is thinking…</p>}
          </div>
          <div className="flex gap-2 border-t border-black/[.06] dark:border-white/[.08] p-4">
            <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && ask()}
              placeholder="Type your doubt…" className={inputCls} />
            <button onClick={ask} className="btn-ink px-5"><Send size={16} /></button>
          </div>
        </Card>
      </div>
    </div>
  )
}
