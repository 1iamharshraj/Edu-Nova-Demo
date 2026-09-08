import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bell, BrainCircuit, Check, CheckCheck, ChevronLeft, ExternalLink, Film, Heart, MessageCircle, MessageSquare,
  Pencil, Pin, Plus, Search, Send, Sparkles, Trash2, Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAcademic, useStore } from '@/lib/store'
import { api, ApiError, errorMessage } from '@/lib/api'
import { isStaffOrAdmin } from '@/lib/access'
import type { ContactPerson, ConversationRec, HighlightAudience, HighlightRec, MessageRec, PostComment, PostRec, Role } from '@/lib/data'
import {
  CAN_POST_ROLES, conversationTitle, fmtDayTime, seenByOthers, useConversationMessages, useConversations,
  useContacts, useEventStream, useFeed, useLivePoll, useNotifications,
} from '@/lib/hooks/useComms'
import { useAiConversations, useHighlights } from '@/lib/hooks/useIntegrations'
import { Avatar, Card, Empty, Field, Modal, PageHead, Pill, inputCls } from '../ui'

/* ── School feed ────────────────────────────────────────── */

const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', superadmin: 'Admin', staff: 'Staff', teacher: 'Teacher', parent: 'Parent', student: 'Student' }

function ComposeModal({ open, onClose, editing, onSaved }: { open: boolean; onClose: () => void; editing: PostRec | null; onSaved: () => void }) {
  const { user } = useStore()
  const { classesTaughtBy, classes } = useAcademic()
  const isTeacher = user?.role === 'teacher'
  const myClasses = isTeacher ? classesTaughtBy(user!.id) : classes
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<'School' | 'Class' | 'Role'>('School')
  const [classId, setClassId] = useState('')
  const [targetRole, setTargetRole] = useState<Role>('student')
  const [busy, setBusy] = useState(false)

  // Reset the form once per open (fresh for a new post, prefilled for an edit) — adjusted during render
  // rather than in an effect, per https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const openKey = open ? (editing?.id ?? '__new__') : null
  const [initedKey, setInitedKey] = useState<string | null>(null)
  if (openKey !== initedKey) {
    setInitedKey(openKey)
    if (editing) {
      setTitle(editing.title ?? ''); setBody(editing.body); setAudience(editing.audience)
      setClassId(editing.classId ?? myClasses[0]?.id ?? ''); setTargetRole((editing.role as Role) ?? 'student')
    } else if (openKey) {
      setTitle(''); setBody(''); setAudience('School'); setClassId(myClasses[0]?.id ?? ''); setTargetRole('student')
    }
  }

  const save = async () => {
    if (!body.trim()) return
    if (audience === 'Class' && !classId) { toast.error('Pick a class'); return }
    setBusy(true)
    try {
      const payload = {
        title: title.trim() || undefined,
        body: body.trim(),
        audience,
        classId: audience === 'Class' ? classId : undefined,
        role: audience === 'Role' ? targetRole : undefined,
      }
      if (editing) await api.patch(`/feed/${editing.id}`, payload)
      else await api.post('/feed', payload)
      toast.success(editing ? 'Post updated' : 'Posted to the feed')
      onSaved()
      onClose()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit post' : 'New post'} wide>
      <div className="space-y-4">
        <Field label="Title (optional)"><input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder="e.g. Annual Sports Day" /></Field>
        <Field label="Message"><textarea value={body} onChange={e => setBody(e.target.value)} rows={4} className={inputCls} placeholder="What's happening?" /></Field>
        <Field label="Audience">
          <div className="inline-flex rounded-full border border-black/[.08] dark:border-white/[.1] bg-white dark:bg-[#14141f] p-1">
            {(['School', 'Class', ...(isTeacher ? [] : ['Role'])] as ('School' | 'Class' | 'Role')[]).map(a => (
              <button key={a} type="button" onClick={() => setAudience(a)}
                className={`rounded-full px-4 py-1.5 text-[12.5px] font-semibold transition-all ${audience === a ? 'bg-black text-white shadow' : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'}`}>
                {a === 'School' ? 'Everyone' : a === 'Class' ? (isTeacher ? 'My classes' : 'A class') : 'A role'}
              </button>
            ))}
          </div>
        </Field>
        {audience === 'Class' && (
          <Field label="Class">
            <select value={classId} onChange={e => setClassId(e.target.value)} className={inputCls}>
              {myClasses.length === 0 && <option value="">No classes available</option>}
              {myClasses.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </Field>
        )}
        {audience === 'Role' && !isTeacher && (
          <Field label="Role">
            <select value={targetRole} onChange={e => setTargetRole(e.target.value as Role)} className={inputCls}>
              {(['student', 'parent', 'teacher', 'staff'] as Role[]).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}s</option>)}
            </select>
          </Field>
        )}
        <button onClick={save} disabled={busy || !body.trim() || (audience === 'Class' && !classId)}
          className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Post'}
        </button>
      </div>
    </Modal>
  )
}

function PostCard({ post, onPin, onEdit, onDelete }: {
  post: PostRec
  onPin?: (p: PostRec) => void
  onEdit?: (p: PostRec) => void
  onDelete?: (p: PostRec) => void
}) {
  const { user } = useStore()
  const { classById } = useAcademic()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'
  const isMine = user?.id === post.author.id
  const [reacted, setReacted] = useState(post.liked)
  const [count, setCount] = useState(post.likes)
  const [busyReact, setBusyReact] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(false)
  // Comments arrive embedded in the post; kept in local state so add/delete can update without a refetch.
  const [comments, setComments] = useState<PostComment[]>(post.comments ?? [])
  const [draft, setDraft] = useState('')

  // Re-sync the optimistic reaction/comment state whenever the underlying post object changes (a fresh feed fetch).
  const [syncedPost, setSyncedPost] = useState(post)
  if (syncedPost !== post) {
    setSyncedPost(post)
    setReacted(post.liked)
    setCount(post.likes)
    setComments(post.comments ?? [])
  }

  const toggleReact = async () => {
    if (busyReact) return
    setBusyReact(true)
    const next = !reacted
    setReacted(next); setCount(c => c + (next ? 1 : -1))
    try {
      const res = await api.post<{ item?: PostRec } | PostRec>(`/feed/${post.id}/react`)
      const item = (res && typeof res === 'object' && 'item' in res && res.item) ? res.item : (res as PostRec)
      if (item) { setReacted(item.liked); setCount(item.likes) }
    } catch (e) { setReacted(!next); setCount(c => c + (next ? -1 : 1)); toast.error(errorMessage(e)) }
    finally { setBusyReact(false) }
  }

  const addComment = async () => {
    if (!draft.trim()) return
    try {
      const res = await api.post<{ item?: PostComment } | PostComment>(`/feed/${post.id}/comments`, { body: draft.trim() })
      const c = (res && typeof res === 'object' && 'item' in res && res.item) ? res.item : (res as PostComment)
      setComments(cs => [...cs, c])
      setDraft('')
    } catch (e) { toast.error(errorMessage(e)) }
  }

  const removeComment = async (c: PostComment) => {
    try { await api.del(`/feed/${post.id}/comments/${c.id}`); setComments(cs => cs.filter(x => x.id !== c.id)) }
    catch (e) { toast.error(errorMessage(e)) }
  }

  const classLabel = post.classId ? classById.get(post.classId)?.label ?? 'A class' : 'A class'
  const audienceLabel = post.audience === 'School' ? 'Everyone' : post.audience === 'Class' ? classLabel : `${ROLE_LABEL[post.role as Role] ?? post.role}s`

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-center gap-3.5 p-5 pb-4">
        <div className="rounded-full bg-gradient-to-tr from-indigo-500 via-fuchsia-500 to-amber-400 p-[2.5px]">
          <span className="block rounded-full bg-white dark:bg-[#14141f] p-[2px]">
            <Avatar name={post.author.name} hue={262} size={42} />
          </span>
        </div>
        <div className="flex-1">
          <p className="flex items-center gap-1.5 text-[15.5px] font-semibold">
            {post.author.name}
            {post.pinned && <Pin size={13} className="text-indigo-500" />}
          </p>
          <p className="text-[12.5px] text-black/45 dark:text-white/45">{ROLE_LABEL[post.author.role] ?? post.author.role} · {fmtDayTime(post.publishedAt || post.createdAt)}</p>
        </div>
        <Pill tone="indigo">{audienceLabel}</Pill>
        {(isMine || isAdmin) && (
          <div className="flex items-center gap-1">
            {isMine && onEdit && <button onClick={() => onEdit(post)} className="rounded-full p-1.5 text-black/40 hover:bg-black/[.06] hover:text-black dark:text-white/40 dark:hover:bg-white/[.08] dark:hover:text-white" aria-label="Edit"><Pencil size={14} /></button>}
            {isAdmin && onPin && <button onClick={() => onPin(post)} className={`rounded-full p-1.5 hover:bg-black/[.06] dark:hover:bg-white/[.08] ${post.pinned ? 'text-indigo-500' : 'text-black/40 dark:text-white/40'}`} aria-label="Pin"><Pin size={14} /></button>}
            {(isMine || isAdmin) && onDelete && <button onClick={() => onDelete(post)} className="rounded-full p-1.5 text-black/40 hover:bg-rose-50 hover:text-rose-500 dark:text-white/40 dark:hover:bg-rose-500/10" aria-label="Delete"><Trash2 size={14} /></button>}
          </div>
        )}
      </div>
      <div className="px-5 pb-2">
        {post.title && <p className="mb-1 text-[15.5px] font-semibold">{post.title}</p>}
        <p className="text-[15px] leading-relaxed text-black/75 dark:text-white/75 whitespace-pre-wrap">{post.body}</p>
      </div>
      <div className="px-5 pb-5">
        <div className="mt-3 flex items-center gap-6 border-t border-black/[.06] dark:border-white/[.08] pt-4">
          <button onClick={toggleReact} disabled={busyReact}
            className={`flex items-center gap-1.5 text-[14px] font-semibold transition-transform active:scale-125 ${reacted ? 'text-rose-500' : 'text-black/50 dark:text-white/50 hover:text-rose-500'}`}>
            <Heart size={18} fill={reacted ? 'currentColor' : 'none'} /> {count}
          </button>
          <button onClick={() => setCommentsOpen(o => !o)} className="flex items-center gap-1.5 text-[14px] font-semibold text-black/50 dark:text-white/50 hover:text-indigo-600">
            <MessageCircle size={18} /> {comments.length}
          </button>
        </div>
        {commentsOpen && (
          <div className="mt-4 space-y-3">
            {comments.map(c => (
              <div key={c.id} className="flex items-start gap-2.5 text-[13.5px]">
                <Avatar name={c.author.name} hue={200} size={28} />
                <p className="flex-1 rounded-2xl bg-black/[.04] dark:bg-white/[.06] px-3.5 py-2">
                  <b>{c.author.name}</b> · {c.body}
                </p>
                {(user?.id === c.author.id || isAdmin) && (
                  <button onClick={() => removeComment(c)} className="mt-1 rounded-full p-1 text-black/30 hover:bg-rose-50 hover:text-rose-500 dark:text-white/30 dark:hover:bg-rose-500/10" aria-label="Delete comment"><Trash2 size={12} /></button>
                )}
              </div>
            ))}
            {comments.length === 0 && <p className="text-[12.5px] text-black/40 dark:text-white/40">No comments yet.</p>}
            <div className="flex gap-2 pt-1">
              <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && addComment()}
                placeholder="Write a comment…" className={inputCls} />
              <button onClick={addComment} disabled={!draft.trim()} className="btn-ink px-4 disabled:opacity-40"><Send size={15} /></button>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

export function FeedMod() {
  const { user } = useStore()
  const { items: posts, loading, error, reload } = useFeed()
  const [composeOpen, setComposeOpen] = useState(false)
  const [editing, setEditing] = useState<PostRec | null>(null)
  const canPost = !!user && (CAN_POST_ROLES as readonly string[]).includes(user.role)

  const pin = async (p: PostRec) => {
    try { await api.post(`/feed/${p.id}/pin`); reload() } catch (e) { toast.error(errorMessage(e)) }
  }
  const remove = async (p: PostRec) => {
    if (!confirm('Delete this post?')) return
    try { await api.del(`/feed/${p.id}`); reload(); toast.success('Post deleted') } catch (e) { toast.error(errorMessage(e)) }
  }
  const edit = (p: PostRec) => { setEditing(p); setComposeOpen(true) }
  const openNew = () => { setEditing(null); setComposeOpen(true) }

  return (
    <div>
      <PageHead title="School Feed" sub="Everything happening around campus, as it happens">
        {canPost && (
          <button onClick={openNew} className="btn-ink flex items-center gap-2 px-4 py-2 text-[13.5px] font-semibold"><Plus size={15} /> New post</button>
        )}
      </PageHead>
      <div className="mx-auto grid max-w-5xl gap-6">
        {loading && <p className="py-8 text-center text-[14px] text-black/40 dark:text-white/40">Loading feed…</p>}
        {error && <Empty text={error} />}
        {!loading && !error && (posts ?? []).map(p => (
          <PostCard key={p.id} post={p} onPin={pin} onEdit={edit} onDelete={remove} />
        ))}
        {!loading && !error && (posts ?? []).length === 0 && <Empty text="Nothing posted yet." />}
      </div>
      <ComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} editing={editing} onSaved={reload} />
    </div>
  )
}

/* ── Messages ───────────────────────────────────────────── */

function ContactPicker({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { user } = useStore()
  const { classesTaughtBy, classes } = useAcademic()
  const { groups, loading } = useContacts(open)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'dm' | 'group'>('dm')
  const [classId, setClassId] = useState('')
  const [groupTitle, setGroupTitle] = useState('')
  const canGroup = user && (user.role === 'teacher' || user.role === 'staff' || user.role === 'admin' || user.role === 'superadmin')
  const myClasses = user?.role === 'teacher' ? classesTaughtBy(user.id) : classes

  // Reset the picker's fields each time it opens — adjusted during render (see ComposeModal above).
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) { setQuery(''); setMode('dm'); setClassId(myClasses[0]?.id ?? ''); setGroupTitle('') }
  }

  const filtered = groups.map(g => ({ ...g, people: g.people.filter(p => p.name.toLowerCase().includes(query.toLowerCase())) })).filter(g => g.people.length > 0)

  const startDm = async (p: ContactPerson) => {
    setBusy(true)
    try {
      const res = await api.post<{ item?: ConversationRec } | ConversationRec>('/messages/conversations', { userIds: [p.id] })
      const conv = (res && typeof res === 'object' && 'item' in res && res.item) ? res.item : (res as ConversationRec)
      onCreated(conv.id)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  const startGroup = async () => {
    if (!classId) return
    setBusy(true)
    try {
      const res = await api.post<{ item?: ConversationRec } | ConversationRec>('/messages/conversations', { classId, title: groupTitle.trim() || undefined })
      const conv = (res && typeof res === 'object' && 'item' in res && res.item) ? res.item : (res as ConversationRec)
      onCreated(conv.id)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="New conversation" wide>
      <div className="space-y-4">
        {canGroup && (
          <div className="inline-flex rounded-full border border-black/[.08] dark:border-white/[.1] bg-white dark:bg-[#14141f] p-1">
            {(['dm', 'group'] as const).map(m => (
              <button key={m} type="button" onClick={() => setMode(m)}
                className={`rounded-full px-4 py-1.5 text-[12.5px] font-semibold transition-all ${mode === m ? 'bg-black text-white shadow' : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'}`}>
                {m === 'dm' ? 'Direct message' : 'Class group'}
              </button>
            ))}
          </div>
        )}
        {mode === 'group' && canGroup ? (
          <div className="space-y-4">
            <Field label="Class">
              <select value={classId} onChange={e => setClassId(e.target.value)} className={inputCls}>
                {myClasses.length === 0 && <option value="">No classes available</option>}
                {myClasses.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Title (optional)"><input value={groupTitle} onChange={e => setGroupTitle(e.target.value)} className={inputCls} placeholder="e.g. X-A Parents" /></Field>
            <button onClick={startGroup} disabled={busy || !classId} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">
              {busy ? 'Creating…' : 'Create group'}
            </button>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-black/30 dark:text-white/30" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search people"
                className="w-full rounded-full border border-black/[.08] dark:border-white/[.1] bg-black/[.03] dark:bg-white/[.05] py-2.5 pl-10 pr-4 text-[13.5px] outline-none transition focus:border-indigo-400 focus:bg-white dark:focus:bg-[#14141f]" />
            </div>
            <div className="max-h-80 space-y-4 overflow-y-auto thin-scroll">
              {loading && <p className="py-6 text-center text-[13px] text-black/40 dark:text-white/40">Loading contacts…</p>}
              {!loading && filtered.length === 0 && <Empty text="No one available to message." />}
              {filtered.map(g => (
                <div key={g.group}>
                  <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">{g.group}</p>
                  <div className="space-y-1">
                    {g.people.map(p => (
                      <button key={p.id} type="button" disabled={busy} onClick={() => startDm(p)}
                        className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-black/[.04] dark:hover:bg-white/[.06] disabled:opacity-40">
                        <Avatar name={p.name} hue={200} size={34} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium">{p.name}</span>
                          <span className="block text-[11.5px] text-black/40 dark:text-white/40">{ROLE_LABEL[p.role] ?? p.role}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

export function MessagesMod() {
  const { user } = useStore()
  const { items: conversations, loading, reload: reloadConvos } = useConversations()
  useLivePoll('message', reloadConvos)

  const [activeId, setActiveId] = useState('')
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  const [mobileChat, setMobileChat] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [localMessages, setLocalMessages] = useState<MessageRec[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  const list = useMemo(() => conversations ?? [], [conversations])
  const active = useMemo(() => list.find(c => c.id === activeId) ?? list[0], [list, activeId])
  const effectiveActiveId = active?.id ?? ''

  const { items: fetchedMessages, reload: reloadMessages } = useConversationMessages(effectiveActiveId || undefined)

  // Reseed local (optimistic + live-appended) messages whenever a fresh fetch for the thread lands.
  const [syncedMessages, setSyncedMessages] = useState(fetchedMessages)
  if (syncedMessages !== fetchedMessages) {
    setSyncedMessages(fetchedMessages)
    setLocalMessages(fetchedMessages ?? [])
  }

  const markRead = (id: string) => { api.post(`/messages/conversations/${id}/read`).catch(() => {}) }

  useEffect(() => {
    if (effectiveActiveId) markRead(effectiveActiveId)
  }, [effectiveActiveId])

  // keeps the open thread fresh even if an individual SSE event is missed / the connection is down
  useLivePoll('message', reloadMessages)

  const { subscribe } = useEventStream()
  useEffect(() => subscribe(e => {
    if (e.type !== 'message') return
    const payload = e.payload as { conversationId?: string; message?: MessageRec } | undefined
    if (!payload?.conversationId) { reloadConvos(); return }
    if (payload.conversationId === effectiveActiveId) {
      if (payload.message) setLocalMessages(ms => (ms.some(m => m.id === payload.message!.id) ? ms : [...ms, payload.message!]))
      else reloadMessages()
      markRead(effectiveActiveId)
    }
    reloadConvos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [subscribe, effectiveActiveId])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [localMessages.length])

  const send = async () => {
    if (!text.trim() || !active) return
    const body = text.trim()
    setText('')
    try {
      const res = await api.post<{ item?: MessageRec } | MessageRec>(`/messages/conversations/${active.id}/messages`, { body })
      const m = (res && typeof res === 'object' && 'item' in res && res.item) ? res.item : (res as MessageRec)
      setLocalMessages(ms => [...ms, m])
      reloadConvos()
    } catch (e) { toast.error(errorMessage(e)); setText(body) }
  }

  const openThread = (id: string) => { setActiveId(id); setMobileChat(true) }
  const onCreated = (id: string) => { setPickerOpen(false); reloadConvos(); setActiveId(id); setMobileChat(true) }

  const visible = list.filter(c => conversationTitle(c, user?.id).toLowerCase().includes(query.toLowerCase()))

  const ThreadList = (
    <div className="flex h-full flex-col">
      <div className="border-b border-black/[.06] dark:border-white/[.08] p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-[13.5px] font-semibold">Conversations</p>
          <button onClick={() => setPickerOpen(true)} className="flex items-center gap-1.5 rounded-full bg-black text-white px-3 py-1.5 text-[12px] font-semibold hover:bg-black/85">
            <Plus size={13} /> New
          </button>
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-black/30 dark:text-white/30" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search chats"
            className="w-full rounded-full border border-black/[.08] dark:border-white/[.1] bg-black/[.03] dark:bg-white/[.05] py-2.5 pl-10 pr-4 text-[13.5px] outline-none transition focus:border-indigo-400 focus:bg-white dark:focus:bg-[#14141f]" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll">
        {loading && <p className="p-6 text-center text-[13px] text-black/40 dark:text-white/40">Loading…</p>}
        {visible.map(c => {
          const name = conversationTitle(c, user?.id)
          const last = c.lastMessage
          return (
            <button key={c.id} onClick={() => openThread(c.id)}
              className={`group flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-all ${active?.id === c.id ? 'bg-gradient-to-r from-indigo-500/[.09] to-transparent' : 'hover:bg-black/[.02] dark:hover:bg-white/[.04]'}`}>
              <span className="relative">
                {c.kind === 'Group' ? (
                  <span className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20"><Users size={20} /></span>
                ) : <Avatar name={name} hue={262} size={46} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between">
                  <span className="truncate text-[14.5px] font-semibold">{name}</span>
                  {last && <span className="ml-2 shrink-0 text-[10.5px] text-black/35 dark:text-white/35">{fmtDayTime(last.sentAt).split(',')[0]}</span>}
                </span>
                <span className="mt-0.5 flex items-center justify-between gap-2">
                  <span className={`truncate text-[12.5px] ${c.unread ? 'font-semibold text-black dark:text-white' : 'text-black/45 dark:text-white/45'}`}>
                    {last?.senderId === user?.id && <CheckCheck size={13} className="mr-1 inline text-indigo-400" />}
                    {last?.body ?? 'No messages yet'}
                  </span>
                  {!!c.unread && <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 px-1.5 text-[10px] font-bold text-white">{c.unread}</span>}
                </span>
              </span>
            </button>
          )
        })}
        {!loading && visible.length === 0 && <div className="p-6"><Empty text="No chats found." /></div>}
      </div>
    </div>
  )

  const ChatPane = active ? (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-black/[.06] dark:border-white/[.08] px-4 py-3 sm:px-5">
        <button onClick={() => setMobileChat(false)} className="rounded-full p-1.5 hover:bg-black/[.05] dark:hover:bg-white/[.08] md:hidden">
          <ChevronLeft size={20} />
        </button>
        {active.kind === 'Group' ? (
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20"><Users size={18} /></span>
        ) : <Avatar name={conversationTitle(active, user?.id)} hue={262} size={40} />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14.5px] font-semibold">{conversationTitle(active, user?.id)}</p>
          <p className="truncate text-[11.5px] font-medium text-black/40 dark:text-white/40">{active.kind === 'Group' ? `${(active.participants ?? []).length} members` : ''}</p>
        </div>
      </div>

      <div className="flex-1 space-y-1.5 overflow-y-auto bg-[#f2f1ee] dark:bg-[#0c0c14] px-4 py-5 thin-scroll sm:px-6">
        {localMessages.map((m, i) => {
          const mine = m.sender.id === user?.id
          const prev = localMessages[i - 1]
          const sameAsPrev = prev && prev.sender.id === m.sender.id
          return (
            <div key={m.id} className={`bubble-in flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'} ${sameAsPrev ? '' : 'pt-2'}`}>
              {!mine && (
                <span className="w-7 shrink-0">
                  {!sameAsPrev && <Avatar name={m.sender.name} hue={200} size={28} />}
                </span>
              )}
              <div className={`max-w-[75%] px-4 py-2.5 text-[13.5px] leading-relaxed sm:max-w-[65%] ${mine
                ? `chat-me ${sameAsPrev ? 'rounded-2xl rounded-br-md' : 'rounded-2xl rounded-br-sm'}`
                : `chat-them ${sameAsPrev ? 'rounded-2xl rounded-bl-md' : 'rounded-2xl rounded-bl-sm'}`}`}>
                {active.kind === 'Group' && !mine && !sameAsPrev && <p className="mb-0.5 text-[11px] font-semibold text-indigo-500">{m.sender.name}</p>}
                {m.body}
                <span className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${mine ? 'text-white/70' : 'text-black/35 dark:text-white/35'}`}>
                  {fmtDayTime(m.sentAt)}{mine && <CheckCheck size={12} />}
                </span>
              </div>
            </div>
          )
        })}
        {localMessages.length > 0 && seenByOthers(active, localMessages[localMessages.length - 1], user?.id) && (
          <p className="pr-1 text-right text-[10.5px] text-black/35 dark:text-white/35">Seen</p>
        )}
        {localMessages.length === 0 && <p className="pt-10 text-center text-[13px] text-black/35 dark:text-white/30">Say hello 👋</p>}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-center gap-2 border-t border-black/[.06] dark:border-white/[.08] bg-white dark:bg-[#14141f] p-3 sm:p-4">
        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="Type a message…"
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
      <PageHead title="Messages" sub="Direct, verified conversations" />
      {!loading && list.length === 0 ? (
        <div>
          <Empty text="No conversations yet." />
          <button onClick={() => setPickerOpen(true)} className="btn-ink mt-4 flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold"><Plus size={15} /> Start a conversation</button>
        </div>
      ) : (
        <Card className="h-[calc(100dvh-280px)] min-h-[480px] overflow-hidden p-0 md:h-[620px]">
          <div className="hidden h-full md:grid md:grid-cols-[320px_1fr]">
            <div className="border-r border-black/[.06] dark:border-white/[.08]">{ThreadList}</div>
            {ChatPane}
          </div>
          <div className="h-full md:hidden">
            {mobileChat && active ? ChatPane : ThreadList}
          </div>
        </Card>
      )}
      <ContactPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onCreated={onCreated} />
    </div>
  )
}

/* ── Notification bell (exported for the header) ───────── */

export function NotificationBell({ onNavigate }: { onNavigate?: (moduleId: string) => void }) {
  const { items, loading, reload } = useNotifications({ unread: false })
  useLivePoll('notification', reload)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const list = items ?? []
  const unread = list.filter(n => !n.readAt).length

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [open])

  const markAllRead = async () => {
    setBusy(true)
    try { await api.post('/notifications/read-all'); reload() } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  const click = async (n: (typeof list)[number]) => {
    if (!n.readAt) { try { await api.post(`/notifications/${n.id}/read`); reload() } catch { /* noop */ } }
    if (n.link) onNavigate?.(n.link)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} className="relative rounded-full bg-black/[.04] dark:bg-white/[.06] p-2.5 text-black/60 dark:text-white/60 transition hover:bg-black/[.08] dark:hover:bg-white/[.12]" aria-label="Notifications">
        <Bell size={17} />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9.5px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="fade-in absolute right-0 top-full z-50 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-2xl border border-black/[.08] dark:border-white/[.1] bg-white dark:bg-[#14141f] shadow-2xl">
          <div className="flex items-center justify-between border-b border-black/[.06] dark:border-white/[.08] px-4 py-3">
            <p className="text-[13.5px] font-semibold">Notifications</p>
            <button onClick={markAllRead} disabled={busy || unread === 0} className="flex items-center gap-1 text-[12px] font-semibold text-indigo-600 hover:underline disabled:opacity-40 dark:text-indigo-300">
              <Check size={12} /> Mark all read
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto thin-scroll">
            {loading && <p className="p-6 text-center text-[12.5px] text-black/40 dark:text-white/40">Loading…</p>}
            {!loading && list.length === 0 && <div className="p-6"><Empty text="No notifications yet." /></div>}
            {list.map(n => (
              <button key={n.id} onClick={() => click(n)}
                className={`flex w-full items-start gap-2 border-b border-black/[.05] px-4 py-3 text-left transition last:border-0 hover:bg-black/[.03] dark:border-white/[.06] dark:hover:bg-white/[.05] ${!n.readAt ? 'bg-indigo-50/60 dark:bg-indigo-500/10' : ''}`}>
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${!n.readAt ? 'bg-indigo-500' : 'bg-transparent'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold">{n.title}</span>
                  {n.body && <span className="block truncate text-[12px] text-black/50 dark:text-white/50">{n.body}</span>}
                  <span className="block text-[10.5px] text-black/35 dark:text-white/35">{fmtDayTime(n.createdAt)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Event highlights (YouTube/Drive) — Phase 9 CMS ────────
 * `GET /highlights` is audience-filtered server-side; staff/admin/superadmin additionally get an inline
 * publish form and a delete button. See .agents/edunova/phase-9-10-integrations-hardening.md */

/** Extracts a YouTube video id from watch/short/embed/youtu.be URLs, else null (Drive & other links fall back to a plain-link card). */
function youtubeId(url: string): string | null {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (u.pathname === '/watch') return u.searchParams.get('v')
      if (u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2] || null
      if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || null
    }
  } catch { /* not a valid URL — treated as a plain link below */ }
  return null
}

function HighlightForm({ onSaved }: { onSaved: () => void }) {
  const { classes } = useAcademic()
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [audience, setAudience] = useState<HighlightAudience>('School')
  const [classId, setClassId] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!title.trim() || !url.trim()) return
    if (audience === 'Class' && !classId) { toast.error('Pick a class'); return }
    setBusy(true)
    try {
      await api.post('/highlights', { title: title.trim(), url: url.trim(), audience, classId: audience === 'Class' ? classId : undefined })
      toast.success('Highlight published')
      setTitle(''); setUrl(''); setAudience('School'); setClassId('')
      onSaved()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Card>
      <p className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Publish a highlight</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title"><input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder="e.g. Annual Day 2026" /></Field>
        <Field label="Video URL (YouTube or Drive)"><input value={url} onChange={e => setUrl(e.target.value)} className={inputCls} placeholder="https://youtube.com/watch?v=…" /></Field>
        <Field label="Audience">
          <select value={audience} onChange={e => setAudience(e.target.value as HighlightAudience)} className={inputCls}>
            <option value="School">Whole school</option>
            <option value="Class">One class</option>
          </select>
        </Field>
        {audience === 'Class' && (
          <Field label="Class">
            <select value={classId} onChange={e => setClassId(e.target.value)} className={inputCls} disabled={classes.length === 0}>
              <option value="">{classes.length === 0 ? 'No classes yet' : 'Select a class'}</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </Field>
        )}
      </div>
      <button onClick={save} disabled={busy || !title.trim() || !url.trim() || (audience === 'Class' && !classId)}
        className="btn-ink mt-5 flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40">
        <Plus size={15} /> {busy ? 'Publishing…' : 'Publish'}
      </button>
    </Card>
  )
}

export function HighlightsMod() {
  const { user } = useStore()
  const { classById } = useAcademic()
  const canManage = isStaffOrAdmin(user)
  const { items, loading, error, reload } = useHighlights()
  const [play, setPlay] = useState<string | null>(null)
  const list = items ?? []

  const remove = async (h: HighlightRec) => {
    if (!confirm('Delete this highlight?')) return
    try { await api.del(`/highlights/${h.id}`); reload(); toast.success('Highlight removed') } catch (e) { toast.error(errorMessage(e)) }
  }

  return (
    <div>
      <PageHead title="Event Highlights" sub="Official aftermovies and recordings" />
      <div className="space-y-6">
        {canManage && <HighlightForm onSaved={reload} />}
        {loading && <p className="py-8 text-center text-[14px] text-black/40 dark:text-white/40">Loading highlights…</p>}
        {error && <Empty text={error} />}
        {!loading && !error && list.length === 0 && <Empty text="No highlights published yet." />}
        {!loading && !error && list.length > 0 && (
          <div className="grid gap-5 sm:grid-cols-2">
            {list.map(h => {
              const yt = youtubeId(h.url)
              const audienceLabel = h.audience === 'Class' ? (classById.get(h.classId ?? '')?.label ?? 'A class') : 'Everyone'
              return (
                <Card key={h.id} className="overflow-hidden p-0">
                  {yt ? (
                    play === h.id ? (
                      <iframe className="aspect-video w-full" src={`https://www.youtube.com/embed/${yt}?autoplay=1`}
                        title={h.title} allow="autoplay; encrypted-media" allowFullScreen />
                    ) : (
                      <button onClick={() => setPlay(h.id)} className="group relative flex aspect-video w-full items-center justify-center bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-500">
                        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/95 dark:bg-[#14141f]/95 shadow-xl transition-transform group-hover:scale-110">
                          <Film size={24} className="text-black dark:text-white" />
                        </span>
                        <span className="absolute bottom-3 right-3 rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">YouTube</span>
                      </button>
                    )
                  ) : (
                    <a href={h.url} target="_blank" rel="noreferrer"
                      className="group relative flex aspect-video w-full items-center justify-center bg-gradient-to-br from-slate-600 via-slate-700 to-slate-800">
                      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/95 dark:bg-[#14141f]/95 shadow-xl transition-transform group-hover:scale-110">
                        <ExternalLink size={22} className="text-black dark:text-white" />
                      </span>
                      <span className="absolute bottom-3 right-3 rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">Open link</span>
                    </a>
                  )}
                  <div className="flex items-start justify-between gap-2 p-5">
                    <div className="min-w-0">
                      <p className="truncate font-display text-[16px] font-medium">{h.title}</p>
                      <p className="mt-0.5 text-[12.5px] text-black/45 dark:text-white/45">{fmtDayTime(h.publishedAt).split(',')[0]} · {audienceLabel}</p>
                    </div>
                    {canManage && (
                      <button onClick={() => remove(h)} className="shrink-0 rounded-full p-1.5 text-black/40 hover:bg-rose-50 hover:text-rose-500 dark:text-white/40 dark:hover:bg-rose-500/10" aria-label="Delete highlight">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── AI doubt clearing — Phase 9 ────────────────────────────
 * `POST /ai/ask { question, subjectId? }` calls the real Claude tutor server-side and returns
 * `{ conversationId, userMessage, assistantMessage }` (201) — or, when unconfigured, a 503 body of
 * `{ error: "AI tutor not configured", conversationId, userMessage }` (no regex/keyword fallback).
 * `GET /ai/conversations` returns the student's own threads — one per (subject | none), each carrying its
 * `messages` oldest-first; asking again with the same subject continues that thread. A 429 carries a
 * ready-made friendly message from the server (today's limit reached). Student-only — gated by Portal's
 * module registry, not by this component. */

const SUGGESTIONS = [
  'How do I solve quadratic equations?',
  'Explain Newton’s second law of motion',
  'What happens in photosynthesis?',
  'When do I use present perfect vs past simple?',
]

export function AIDoubtsMod() {
  const { user } = useStore()
  const { classOf, classSubjects, subjectById } = useAcademic()
  const { items: conversations, loading: historyLoading, reload } = useAiConversations()
  const [subjectId, setSubjectId] = useState('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [notConfigured, setNotConfigured] = useState(false)
  const [limitMessage, setLimitMessage] = useState<string | null>(null)
  const [pendingQ, setPendingQ] = useState<string | null>(null)
  const [activeConvoId, setActiveConvoId] = useState<string | null>(null)

  const myClass = user ? classOf(user.id) : undefined
  const mySubjects = useMemo(
    () => (myClass ? classSubjects.filter(cs => cs.classId === myClass.id).map(cs => subjectById.get(cs.subjectId)).filter((s): s is NonNullable<typeof s> => !!s) : []),
    [myClass, classSubjects, subjectById],
  )
  const subjectName = (id?: string) => (id ? subjectById.get(id)?.name : undefined)

  const list = useMemo(() => conversations ?? [], [conversations])
  // Default to the most recent thread until an explicit pick (sidebar click, or a fresh `ask()`) sets
  // activeConvoId — derived at render time so there's no effect/setState loop over the list reference.
  const active = (activeConvoId ? list.find(c => c.id === activeConvoId) : undefined) ?? list[0]
  const activeMessages = active?.messages ?? []

  const ask = async (question?: string) => {
    const raw = (question ?? q).trim()
    if (!raw || busy || notConfigured) return
    setQ('')
    setBusy(true)
    setPendingQ(raw)
    setLimitMessage(null)
    try {
      const res = await api.post<{ conversationId: string }>('/ai/ask', { question: raw, subjectId: subjectId || undefined })
      await reload()
      setActiveConvoId(res.conversationId)
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        setLimitMessage(e.message)
        toast.error(e.message)
      } else if (e instanceof ApiError && (e.status === 503 || /not configured/i.test(e.message))) {
        setNotConfigured(true)
        const body = e.body as { conversationId?: string } | undefined
        if (body?.conversationId) { await reload(); setActiveConvoId(body.conversationId) }
      } else {
        toast.error(errorMessage(e))
        setQ(raw)
      }
    } finally {
      setBusy(false)
      setPendingQ(null)
    }
  }

  const HistorySidebar = (
    <div className="flex h-full flex-col border-b border-black/[.06] dark:border-white/[.08] md:border-b-0 md:border-r">
      <div className="flex items-center gap-3 border-b border-black/[.06] dark:border-white/[.08] px-4 py-3.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white"><BrainCircuit size={18} /></span>
        <div>
          <p className="text-[13.5px] font-semibold">Nova Tutor</p>
          <p className="text-[11px] text-black/40 dark:text-white/40">Threads</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 thin-scroll">
        {historyLoading && <p className="px-3 py-6 text-center text-[12.5px] text-black/40 dark:text-white/40">Loading…</p>}
        {!historyLoading && list.length === 0 && (
          <div className="px-3 py-6 text-center text-[12.5px] text-black/35 dark:text-white/35">
            <MessageSquare size={28} className="mx-auto mb-2" />
            No questions yet.
          </div>
        )}
        {list.map((c) => {
          const last = c.messages?.[c.messages.length - 1]
          const label = c.title || subjectName(c.subjectId) || 'General doubts'
          return (
            <button key={c.id} onClick={() => { setActiveConvoId(c.id); setPendingQ(null) }}
              className={`w-full rounded-xl px-3 py-2.5 text-left transition ${activeConvoId === c.id ? 'bg-indigo-50 dark:bg-indigo-500/15' : 'hover:bg-black/[.04] dark:hover:bg-white/[.06]'}`}>
              <p className={`truncate text-[13px] font-medium ${activeConvoId === c.id ? 'text-indigo-700 dark:text-indigo-300' : 'text-black/70 dark:text-white/70'}`}>{label}</p>
              {last && <p className="truncate text-[11.5px] text-black/40 dark:text-white/40">{last.content.slice(0, 50)}…</p>}
            </button>
          )
        })}
      </div>
    </div>
  )

  const notConfiguredCard = (
    <div className="mt-12 text-center sm:mt-16">
      <BrainCircuit size={30} className="mx-auto text-black/25 dark:text-white/25" />
      <p className="mt-3 text-[15px] font-semibold">AI tutor not configured</p>
      <p className="mx-auto mt-1 max-w-sm text-[13px] text-black/40 dark:text-white/40">
        The school hasn’t connected an AI provider yet. Ask your admin to set it up, or check back later.
      </p>
    </div>
  )

  const ChatArea = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-black/[.06] dark:border-white/[.08] px-4 py-3 sm:px-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white"><BrainCircuit size={20} /></span>
          <div>
            <p className="text-[14.5px] font-semibold">Nova Tutor</p>
            <p className={`text-[11.5px] ${notConfigured ? 'text-black/40 dark:text-white/40' : 'text-emerald-600'}`}>
              {notConfigured ? 'offline' : '● curriculum-aware'}
            </p>
          </div>
        </div>
        {mySubjects.length > 0 && (
          <select value={subjectId} onChange={e => setSubjectId(e.target.value)} disabled={notConfigured}
            className="rounded-full border border-black/[.08] dark:border-white/[.1] bg-white dark:bg-[#14141f] px-3 py-1.5 text-[12.5px] font-medium outline-none disabled:opacity-50">
            <option value="">General (no subject)</option>
            {mySubjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto bg-[#fafafa] dark:bg-[#0e0e17] p-4 sm:p-5 thin-scroll">
        {notConfigured ? notConfiguredCard : (
          <>
            {activeMessages.length === 0 && !pendingQ && (
              <div className="mt-12 text-center sm:mt-16">
                <Sparkles size={30} className="mx-auto text-indigo-400" />
                <p className="mt-3 text-[15px] font-semibold">Ask anything from your subjects</p>
                <p className="mt-1 text-[13px] text-black/40 dark:text-white/40">Pick a suggestion or type your own doubt — answers are scoped to your class syllabus.</p>
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
            {activeMessages.map(m => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.role === 'user' ? (
                  <p className="max-w-[80%] rounded-2xl rounded-br-md bg-black px-4 py-2.5 text-[13.5px] text-white">{m.content}</p>
                ) : (
                  <div className="max-w-[85%] overflow-hidden rounded-2xl rounded-tl-md bg-white dark:bg-[#14141f] ring-1 ring-black/[.07] dark:ring-white/10">
                    <div className="h-1 w-full bg-gradient-to-r from-indigo-500 to-fuchsia-500" />
                    <div className="flex items-start gap-3 px-4 py-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white"><BrainCircuit size={14} /></span>
                      <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">{m.content}</p>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {pendingQ && (
              <div className="flex justify-end">
                <p className="max-w-[80%] rounded-2xl rounded-br-md bg-black px-4 py-2.5 text-[13.5px] text-white">{pendingQ}</p>
              </div>
            )}
            {busy && (
              <div className="flex items-start gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white"><BrainCircuit size={16} /></span>
                <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md bg-white dark:bg-[#14141f] px-4 py-3 ring-1 ring-black/[.07] dark:ring-white/10">
                  <span className="typing-dot h-2 w-2 rounded-full bg-black/40 dark:bg-white/50" />
                  <span className="typing-dot h-2 w-2 rounded-full bg-black/40 dark:bg-white/50" />
                  <span className="typing-dot h-2 w-2 rounded-full bg-black/40 dark:bg-white/50" />
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {limitMessage && !notConfigured && (
        <div className="border-t border-amber-200 bg-amber-50 px-4 py-2.5 text-center text-[12.5px] font-medium text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400 sm:px-5">
          {limitMessage}
        </div>
      )}
      <div className="flex flex-wrap gap-2 border-t border-black/[.06] dark:border-white/[.08] bg-white dark:bg-[#14141f] p-3 sm:p-4">
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && ask()}
          placeholder={notConfigured ? 'AI tutor unavailable' : 'Type your doubt…'} disabled={notConfigured || busy}
          className={`${inputCls} min-w-0 flex-1 disabled:opacity-50`} />
        <button onClick={() => ask()} disabled={notConfigured || busy || !q.trim()} className="btn-ink px-5 disabled:opacity-40"><Send size={16} /></button>
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
