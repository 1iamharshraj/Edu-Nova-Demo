import { useEffect, useState, useCallback } from 'react'
import { flushQueue, listQueue, onQueueChanged, type QueuedSubmission } from '../offlineAttendance'

/** navigator.onLine, kept live via the `online`/`offline` events. Advisory only — the real offline/online
 *  signal for whether to queue a submission is always the outcome of the actual request (see
 *  `isNetworkFailure` in offlineAttendance.ts); this is for UI hinting (e.g. an "offline" banner). */
export function useOnlineStatus() {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return online
}

/** Live view of the offline attendance queue, plus the triggers that replay it: the `online` event, a
 *  foreground focus/visibility fallback (covers Safari, which has no Background Sync API), and messages
 *  from the service worker's `sync` event (see public/sw.js) when Background Sync fires while the tab is
 *  in the background. */
export function useAttendanceQueue() {
  const [items, setItems] = useState<QueuedSubmission[]>([])
  const [syncing, setSyncing] = useState(false)

  const reload = useCallback(() => { listQueue().then(setItems).catch(() => {}) }, [])

  const sync = useCallback(async () => {
    setSyncing(true)
    try { await flushQueue() } finally { setSyncing(false); reload() }
  }, [reload])

  useEffect(() => {
    reload()
    const unsub = onQueueChanged(reload)
    const onOnline = () => { sync() }
    const onVisible = () => { if (document.visibilityState === 'visible') sync() }
    const onSwMessage = (e: MessageEvent) => { if (e.data?.type === 'EDUNOVA_ATTENDANCE_SYNC') sync() }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    navigator.serviceWorker?.addEventListener?.('message', onSwMessage)
    // Also try once on mount — covers reopening the app after it was closed while items were still queued.
    // Deferred a tick so the initial setState (setSyncing) doesn't fire synchronously within the effect body.
    Promise.resolve().then(() => { sync() })
    return () => {
      unsub()
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      navigator.serviceWorker?.removeEventListener?.('message', onSwMessage)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { items, syncing, reload, sync }
}
