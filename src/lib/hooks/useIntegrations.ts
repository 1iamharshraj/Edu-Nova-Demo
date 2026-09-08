import { useList } from './useAcademics'
import type { AiConversationRec, HighlightRec } from '../data'

// Data hooks for Phase 9: AI doubt clearing and the event-highlights CMS.
// Components live in src/portal/modules/social.tsx. See .agents/edunova/phase-9-10-integrations-hardening.md

/* ── AI doubt clearing ──────────────────────────────────── */

/** `GET /ai/conversations` — the signed-in student's own threads (one per subject), each with its messages, newest first. */
export function useAiConversations(enabled = true) {
  return useList<AiConversationRec>(enabled ? '/ai/conversations' : null)
}

/* ── event highlights ───────────────────────────────────── */

/** `GET /highlights` — audience-filtered for the caller by the server. */
export function useHighlights(enabled = true) {
  return useList<HighlightRec>(enabled ? '/highlights' : null)
}
