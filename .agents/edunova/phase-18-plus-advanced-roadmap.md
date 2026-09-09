# EduNova — Advanced Features Roadmap (Phases 18+)

Continuation of the "complete ERP" roadmap (Phases 11–17, all done). This covers everything from the syllabus-tracking brainstorm and the two rounds of "features you won't find in a regular ERP" — organized into 13 phases, each built the same way every previous phase was: a detailed spec, server+frontend agent pairs, hand-integration, full gate verification (tsc/eslint/tests), live testing, then reset.

**Two honest scope notes before starting:**
- **WhatsApp integration** (Phase 23) can only be built as a real *provider abstraction* — following the exact pattern already used for email/SMS in `server/src/lib/notify.ts` (console-log fallback when no credentials are configured). It cannot be made to actually deliver WhatsApp messages without the school's own Meta WhatsApp Business API credentials, which nobody has yet. This is the same honest limitation the existing email/SMS system already has, and it's built the same way.
- **UDISE+ auto-generation** (Phase 29) requires knowing the exact current UDISE+ form field list, which changes periodically and isn't something to guess at. It'll be built against a documented, versioned field-mapping file that's easy to update, rather than hardcoded blindly.

Everything else below is buildable fully real and end-to-end with what already exists in the codebase.

---

## Phase 18 — Syllabus & Teaching Progress Tracking
Chapters live on `CurriculumSubject` (board+grade+subject — defined once, inherited by every section and teacher, consistent with the existing multi-board architecture). Per-class-subject progress log, auto-computed expected pace from real scheduled periods minus holidays/absences ("lost periods"), assessment-to-chapter linkage for a coverage-vs-actually-learned view, and a shared per-chapter teaching-resource library (lesson plans/worksheets attached once, visible to every teacher of that subject — survives staff turnover). Full detail in `phase-18-syllabus-tracking.md`.

## Phase 19 — Early Warning & Teaching Analytics
Student risk scoring (attendance + marks + homework + fee dues + discipline, computed and surfaced to the class teacher before a student fails, not after), a lost-instructional-time report (which classes/subjects lost the most periods and why), teacher workload balancing during timetable building, homework-load clash flags (too many teachers assigning heavy homework to the same class/night), and smart substitute-teacher suggestion when a teacher is marked absent.

## Phase 20 — AI-Powered Teaching & Communication
Extends the existing Claude-backed AI module: scope the student doubt-clearing tutor to only the syllabus chapters actually covered so far (built on Phase 18's progress data); AI-generated worksheets/question papers per chapter; AI-drafted report-card remarks from real marks/attendance/achievement data (teacher edits and approves, never auto-sent); AI-translated parent communications (notices, messages, report-card remarks) into Hindi/other Indian languages on demand.

## Phase 21 — Financial Intelligence
Extends the real GL from Phase 17: cash-flow forecasting (projected balance using known fee schedules and payroll obligations), per-program profitability (does the hostel/IB stream/a given campus pay for itself), concession/scholarship impact modeling, a formal scholarship program with an approval workflow that posts correctly to the ledger, and parent-facing fee installment plans (quarterly/monthly) with auto-generated schedules and reminders.

## Phase 22 — Campus Safety & Security
Authorized-pickup list per student with parent-app OTP approval for early/unlisted pickup; visitor log (badge, purpose, host, check-in/out); a confidential counseling record tier — genuinely more restricted than health records (counselor + optionally principal only, invisible to class teachers/admin) — plus anonymous anti-bullying/concern reporting; medication administration log with allergy alerts surfaced wherever relevant (cafeteria, trips, health screen).

## Phase 23 — Parent Experience
A real combined "family view" (one parent login, all wards, one combined fee/attendance/calendar summary — the current app makes a multi-child parent pick one ward everywhere, confirmed by code read); a daily "my child today" digest notification pulling from attendance, syllabus progress, homework, and fees due; a WhatsApp notification channel (provider abstraction, same honest caveat as above); parent-facing fee installment UI (ties to Phase 21's backend).

## Phase 24 — Boarding & Hostel Extensions
Hostel outpass/leave request workflow (student requests → warden approves → parent notified → gate log), night roll-call/hostel attendance separate from class attendance with missing-at-roll-call alerts, mess menu + meal feedback.

## Phase 25 — Exam Operations
Exam seating-plan auto-generation (rooms + capacities + roster → a seating chart mixing classes/subjects), invigilation roster auto-assignment (from teacher free periods + duties), hall ticket / admit card PDF generation (extends the existing certificate/PDF infrastructure), a board-exam readiness dashboard for 10th/12th combining syllabus completion + mock scores + board registration status, and exam-schedule clash detection for elective subject combinations.

## Phase 26 — Timetable Auto-Generation
Constraint-based auto-generation of a first-draft weekly timetable (teacher availability, room type matching, lab-period pairing, no-double-same-subject rules) built on top of the existing conflict-detection engine, with the admin free to hand-edit the result exactly as today.

## Phase 27 — Culture & Engagement
Live inter-house points leaderboard on the school feed (built on the existing Activities/IHA structure), and a student digital portfolio accumulating achievements/certificates/activities/projects across years, exportable — connects to the Alumni module.

## Phase 28 — Multi-School / Group Management
A group-admin role that spans multiple `School` tenants for trusts/groups running many campuses — cross-campus comparison of fee collection %, attendance, syllabus pace, teacher load. This is the most architecturally significant item in this roadmap (our current multi-tenancy is one school per root `School` row with no cross-school aggregation layer) — it gets the most design care, similar to how Accounting/GL got extra scrutiny in the previous roadmap.

## Phase 29 — India Compliance & Offline Resilience
UDISE+ data export built against a versioned, documented field-mapping file (not a blind hardcode); offline-first attendance marking (service worker + local queue + background sync) for schools with unreliable connectivity — this is real frontend engineering, not a small add-on.

## Phase 30 — Canteen Prepaid Wallet
Student QR-ID-linked prepaid wallet: parent tops up, purchases debit the balance, parent sees a spend log. Reuses the existing ID-card/QR infrastructure from Employee Management and ties into the GL for real accounting of canteen revenue.

---

## Sequencing

Given the size (13 phases, several genuinely large), phases run in the same dependency-aware waves used throughout this project: independent phases in parallel, dependent ones sequenced after what they build on.

1. **Phase 18** first, alone — everything downstream (19, 20's tutor-scoping, 25's readiness dashboard) depends on real chapter data existing.
2. **Phase 19 + Phase 21** in parallel — both extend existing modules (analytics on top of everything; finance on top of the GL), independent of each other.
3. **Phase 20 + Phase 22** in parallel — both extend existing modules (AI; welfare/health), independent.
4. **Phase 23 + Phase 24** in parallel — both are UI/workflow-heavy extensions of existing domains (communication; hostel).
5. **Phase 25 + Phase 27** in parallel — both extend assessment/activities.
6. **Phase 26** alone — algorithmically the trickiest, benefits from focus.
7. **Phase 28** alone, with a dedicated design pass first (like Accounting/GL got) — it's the one genuine architecture change in this whole list.
8. **Phase 29 + Phase 30** in parallel — both are self-contained.
9. **Full-system regression** — every module built across the entire project (Phases 0–30), not just what's new, live-tested the same way the original deep audit was done (parallel domain-audit agents), before calling this complete.

Starting now with Phase 18.
