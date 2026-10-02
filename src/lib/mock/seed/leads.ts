// Lead Management — coaching-institute demo. Every enquiry into the institute (walk-in, phone call,
// website form, paid ad click, or a bulk import from a counselor's Google Sheet) lands here as one
// `Lead` row and moves through a pipeline until it is enrolled straight into a batch (student login +
// enrollment — see modules/leads.ts `POST /leads/:id/convert`) or is marked Lost.

import type { Collections, Row } from '../store'
import { SCHOOL_ID } from '../store'
import { addSeedFragment } from './index'

export const LEAD_SOURCES = ['Website', 'Google Ads', 'Facebook/Instagram Ads', 'Walk-in', 'Phone Enquiry', 'Referral', 'Google Sheet Import'] as const
export const LEAD_STATUSES = ['New', 'Contacted', 'Trial Scheduled', 'Trial Attended', 'Enrolled', 'Lost'] as const

export function seedLeads(db: Collections) {
  const mk = (over: Partial<Row> & { id: string; name: string; phone: string; source: string; status: string; interestedCourse: string; createdAt: string }): Row => ({
    schoolId: SCHOOL_ID,
    assignedToId: 'u-st',
    score: 50,
    notes: [],
    ...over,
  })

  db.Lead = [
    mk({
      id: 'lead-1', name: 'Aditya Rao', phone: '+91 98450 11234', email: 'aditya.rao.parent@gmail.com',
      source: 'Google Ads', campaign: 'JEE_Main_2027_Search_Bangalore', interestedCourse: 'JEE 2027 · A',
      status: 'New', score: 72, createdAt: '2026-09-28T10:15:00.000Z', assignedToId: 'u-st',
      notes: [],
    }),
    mk({
      id: 'lead-2', name: 'Sneha Kulkarni', phone: '+91 98230 45678', email: 'sneha.k2010@gmail.com',
      source: 'Website', interestedCourse: 'NEET Dropper Batch',
      status: 'Contacted', score: 65, createdAt: '2026-09-25T14:30:00.000Z', assignedToId: 'u-ad',
      notes: [
        { at: '2026-09-25T16:00:00.000Z', by: 'Priya Menon', text: 'Called — interested, wants to know about scholarship test.' },
      ],
    }),
    mk({
      id: 'lead-3', name: 'Rohit Deshmukh', phone: '+91 99870 23456', email: 'rohit.deshmukh@yahoo.com',
      source: 'Facebook/Instagram Ads', campaign: 'NEET_2027_Reels_Pune', interestedCourse: 'NEET 2027 — Batch B',
      status: 'Trial Scheduled', score: 80, createdAt: '2026-09-20T09:00:00.000Z', assignedToId: 'u-st',
      notes: [
        { at: '2026-09-20T11:00:00.000Z', by: 'Kavita Joshi', text: 'Spoke to father, scheduled a free demo class for Physics.' },
        { at: '2026-09-22T09:00:00.000Z', by: 'Kavita Joshi', text: 'Trial class booked for Oct 2, Batch B — Physics, 4pm.' },
      ],
    }),
    mk({
      id: 'lead-4', name: 'Fatima Sheikh', phone: '+91 97420 56789',
      source: 'Walk-in', interestedCourse: 'Foundation IX · A',
      status: 'Trial Attended', score: 88, createdAt: '2026-09-15T12:00:00.000Z', assignedToId: 'u-ad',
      notes: [
        { at: '2026-09-15T12:30:00.000Z', by: 'Priya Menon', text: 'Walked in with mother, picked up brochure, attended trial Maths class same day.' },
        { at: '2026-09-16T10:00:00.000Z', by: 'Priya Menon', text: 'Very positive feedback — ready to enroll, discussing fee installments.' },
      ],
    }),
    mk({
      id: 'lead-5', name: 'Karan Mehta', phone: '+91 96540 67890', email: 'karan.mehta.09@gmail.com',
      source: 'Referral', interestedCourse: 'JEE 2027 · A',
      status: 'Enrolled', score: 95, createdAt: '2026-08-28T08:00:00.000Z', assignedToId: 'u-st',

      notes: [
        { at: '2026-08-28T09:00:00.000Z', by: 'Kavita Joshi', text: 'Referred by an existing JEE batch student — strong intent from day one.' },
        { at: '2026-09-02T09:00:00.000Z', by: 'Kavita Joshi', text: 'Converted to admission and enrolled. See linked application.' },
      ],
    }),
    mk({
      id: 'lead-6', name: 'Ananya Bhattacharya', phone: '+91 95430 78901',
      source: 'Google Ads', campaign: 'Foundation_Class9_Search_Kolkata', interestedCourse: 'Foundation IX · B',
      status: 'Lost', score: 30, createdAt: '2026-09-10T10:00:00.000Z', assignedToId: 'u-ad',
      notes: [
        { at: '2026-09-18T10:00:00.000Z', by: 'Priya Menon', text: 'Chose a competitor closer to home. Marked lost.' },
      ],
    }),
    mk({
      id: 'lead-7', name: 'Vikram Choudhary', phone: '+91 94320 89012', email: 'vikram.c.parent@outlook.com',
      source: 'Google Sheet Import', interestedCourse: 'NEET Dropper Batch',
      status: 'New', score: 55, createdAt: '2026-09-29T07:00:00.000Z', assignedToId: 'u-st',
      importBatch: 'edu-expo-oct-2026', notes: [],
    }),
    mk({
      id: 'lead-8', name: 'Pooja Nair', phone: '+91 93210 90123', email: 'pooja.nair.in@gmail.com',
      source: 'Google Sheet Import', interestedCourse: 'JEE 2027 · B',
      status: 'New', score: 60, createdAt: '2026-09-29T07:00:00.000Z', assignedToId: 'u-ad',
      importBatch: 'edu-expo-oct-2026', notes: [],
    }),
    mk({
      id: 'lead-9', name: 'Siddharth Iyer', phone: '+91 92100 01234',
      source: 'Phone Enquiry', interestedCourse: 'JEE 2027 · A',
      status: 'Contacted', score: 58, createdAt: '2026-09-27T15:00:00.000Z', assignedToId: 'u-st',
      notes: [{ at: '2026-09-27T15:10:00.000Z', by: 'Kavita Joshi', text: 'Called in asking about fee structure and batch timings.' }],
    }),
    mk({
      id: 'lead-10', name: 'Meera Pillai', phone: '+91 91090 12345', email: 'meera.pillai@gmail.com',
      source: 'Website', interestedCourse: 'NEET 2027 — Batch B',
      status: 'Trial Scheduled', score: 70, createdAt: '2026-09-24T11:00:00.000Z', assignedToId: 'u-ad',
      notes: [{ at: '2026-09-26T09:00:00.000Z', by: 'Priya Menon', text: 'Demo Biology class booked for Oct 3.' }],
    }),
    mk({
      id: 'lead-11', name: 'Arjun Khanna', phone: '+91 90980 23456',
      source: 'Facebook/Instagram Ads', campaign: 'JEE_2027_Reels_Delhi', interestedCourse: 'JEE 2027 · A',
      status: 'New', score: 45, createdAt: '2026-09-30T06:30:00.000Z', assignedToId: 'u-st', notes: [],
    }),
    mk({
      id: 'lead-12', name: 'Divya Agarwal', phone: '+91 89870 34567', email: 'divya.agarwal.09@gmail.com',
      source: 'Referral', interestedCourse: 'Foundation IX · A',
      status: 'Enrolled', score: 90, createdAt: '2026-08-20T08:00:00.000Z', assignedToId: 'u-ad',

      notes: [{ at: '2026-08-25T09:00:00.000Z', by: 'Priya Menon', text: 'Sibling of an existing student. Fast conversion.' }],
    }),
  ]
}

addSeedFragment(seedLeads)
