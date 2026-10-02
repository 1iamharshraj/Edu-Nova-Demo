import { api, errorMessage } from '../api'
import { useFetch } from './useTimetable'
import { qs, useList } from './useAcademics'

export const LEAD_SOURCES = ['Website', 'Google Ads', 'Facebook/Instagram Ads', 'Walk-in', 'Phone Enquiry', 'Referral', 'Google Sheet Import'] as const
export const LEAD_STATUSES = ['New', 'Contacted', 'Trial Scheduled', 'Trial Attended', 'Enrolled', 'Lost'] as const
export type LeadStatus = typeof LEAD_STATUSES[number]
export type LeadSource = typeof LEAD_SOURCES[number]

export interface LeadNote { at: string; by: string; text: string }
export interface Lead {
  id: string; name: string; phone: string; email?: string
  source: LeadSource; campaign?: string; interestedCourse: string
  status: LeadStatus; score: number; assignedToId?: string; assignedToName?: string
  importBatch?: string; notes: LeadNote[]; convertedApplicationId?: string; createdAt: string
}
export interface LeadsSummary { total: number; newThisWeek: number; byStatus: Record<string, number>; bySource: Record<string, number> }

export function leadStatusTone(s: LeadStatus): 'green' | 'amber' | 'rose' | 'slate' | 'indigo' | 'sky' {
  if (s === 'New') return 'slate'
  if (s === 'Contacted') return 'sky'
  if (s === 'Trial Scheduled' || s === 'Trial Attended') return 'amber'
  if (s === 'Enrolled') return 'green'
  return 'rose'
}

export function useLeads(filters: { status?: string; source?: string; assignedToId?: string; q?: string } = {}) {
  return useList<Lead>(`/leads${qs(filters)}`)
}

export function useLead(id?: string) {
  const r = useFetch<{ item?: Lead } | Lead>(id ? `/leads/${encodeURIComponent(id)}` : null)
  const data = r.data ? ('item' in r.data && r.data.item ? r.data.item : (r.data as Lead)) : undefined
  return { data, error: r.error, loading: r.loading, reload: r.reload }
}

export function useLeadsSummary() {
  const r = useFetch<LeadsSummary>('/leads-summary')
  return { data: r.data, error: r.error, loading: r.loading, reload: r.reload }
}

export async function createLead(input: { name: string; phone: string; email?: string; source: LeadSource; campaign?: string; interestedCourse?: string; assignedToId?: string }) {
  return api.post<{ item: Lead }>('/leads', input)
}

export async function updateLeadStatus(id: string, newStatus: LeadStatus) {
  return api.post<{ item: Lead }>(`/leads/${encodeURIComponent(id)}/status`, { status: newStatus })
}

export async function addLeadNote(id: string, text: string) {
  return api.post<{ item: Lead }>(`/leads/${encodeURIComponent(id)}/notes`, { text })
}

export async function convertLead(id: string) {
  return api.post<{ item: Lead; applicationId: string }>(`/leads/${encodeURIComponent(id)}/convert`)
}

export async function importLeadsFromRows(rows: Array<{ name: string; phone: string; email?: string; interestedCourse?: string }>, batchLabel?: string) {
  return api.post<{ imported: number; simulated: boolean; items: Lead[] }>('/leads/import', { rows, batchLabel })
}

export async function importLeadsFromSheet(sheetUrl: string, batchLabel?: string) {
  return api.post<{ imported: number; simulated: boolean; items: Lead[] }>('/leads/import', { sheetUrl, batchLabel })
}

/** Parses a simple CSV string (name,phone,email,interestedCourse — header row optional) into import rows. */
export function parseLeadsCsv(text: string): Array<{ name: string; phone: string; email?: string; interestedCourse?: string }> {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const headerish = /name/i.test(lines[0]) && /phone/i.test(lines[0])
  const dataLines = headerish ? lines.slice(1) : lines
  return dataLines.map(line => {
    const [name, phone, email, interestedCourse] = line.split(',').map(c => c.trim())
    return { name: name ?? '', phone: phone ?? '', email: email || undefined, interestedCourse: interestedCourse || undefined }
  }).filter(r => r.name && r.phone)
}

export { errorMessage }
