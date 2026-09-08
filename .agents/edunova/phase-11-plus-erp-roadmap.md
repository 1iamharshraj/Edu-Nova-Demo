# EduNova — Employee Management Fix + Complete-ERP Roadmap

> **✅ Update 2026-09-08: this entire roadmap is done.** All 7 phases (11–17, listed below) landed as Phase 0-10-style spec-driven agent pairs, each integrated by hand (Portal.tsx wiring, type/RBAC reconciliation, tsc/eslint/87-test verification) and live-tested after every wave. See `current-state.md`'s rebuild status table for the authoritative per-phase summary. The tables below are the original planning breakdown — kept for reference on scope/sizing decisions, not as an open task list.

This is the continuation of `rebuild-plan.md` (Phases 0–10, all done) and the deep audit (`deep-audit-2026-09-08.md`, all findings fixed). Everything below is new scope, prompted by: "tell me what all the things I need to do to fix employee management and create this as a complete ERP."

Two tracks, deliberately separated since they're different sizes and different kinds of work:

- **Track A — Employee Management fixes**: bounded, mostly additive to the existing HR/Payroll/People modules. Roughly Phase-8-sized (a few days of agent-driven work).
- **Track B — New ERP domains**: each one is effectively its own mini-product (new Prisma models, new module, new UI) — Hostel, Transport, Library, Inventory/Procurement, Alumni, Accounting/GL. Each is roughly Phase-5-to-8-sized on its own.

---

## Track A — Employee Management (fixing what exists)

| # | Gap | What "fixed" looks like |
|---|---|---|
| A1 | No employee ID numbers | Auto-generated, human-readable ID (e.g. `EMP-2026-0042`) assigned at account creation, shown on profile/People/payslip/contract screens. Small: one new `User` column + a generator + a few display spots. |
| A2 | `reportsTo` is a dead database column — no org chart, no UI | Turn it into a real relation (`reportsTo → User.id`), add a picker in the People/onboarding form, and build a simple org-chart or "my team" view (a manager sees their direct reports; anyone sees who they report to). Doesn't need to be a fancy visual org chart — a clean tree/list view is enough to start. |
| A3 | No performance reviews / appraisals | New `PerformanceReview` model: review cycle (e.g. annual/half-yearly), reviewer, ratings per competency or a simple overall rating + free-text feedback, goals for next cycle, employee acknowledgement. New module + a "My Reviews" (self) and "Team Reviews" (manager/HR) screen. |
| A4 | No promotion / role-change / salary-change history | A single append-only `EmploymentHistory` model logging every role, designation, department, and salary-structure change with an effective date and who made it — solves this AND the payroll "no raise history" gap from Q2 in one model. Surfaced as a timeline on the employee's profile. |
| A5 | No staff disciplinary system (student Discipline module is hard-scoped to students only) | Either extend the existing `DisciplinaryCase` model to allow a `subjectType: student \| staff` (careful: visibility/RBAC rules are different for staff cases — HR/admin only, not "class teacher"), or a parallel lightweight `StaffConduct` model if the workflows genuinely diverge. Needs a product decision on how sensitive this should be (likely HR/admin-only, not general staff-visible). |
| A6 | No employee document repository / ID card | Reuse the existing `files` upload module (already built) to let HR attach documents (ID proof, degree certificates, etc.) to an employee record. ID card: a small PDF generator (reuse the existing pdfkit helpers already used for certificates/payslips/contracts) — photo, name, employee ID, role, a QR code linking to a verification page is a nice-to-have, not required. |
| A7 | Onboarding form doesn't collect phone for teacher/staff (only for parent) | One-line fix: add a phone field to the teacher/staff/admin branches of the People & Roles creation form. |
| A8 | Payroll: no raise history (same root issue as A4) | Covered by A4's `EmploymentHistory` — a salary-structure change becomes a logged event with an effective date instead of a silent overwrite. |

**Effort**: A1, A7 are trivial (hours). A2, A6 are small (about a day each). A3, A4, A5 are the real work — each is a genuine mini-module (new model, RBAC, UI) — call it 1-2 days each with the agent-parallelization pattern already used throughout this project.

---

## Track B — New ERP domains (things that don't exist at all)

Each row is independently shippable — you don't need all of them, and they don't depend on each other except where noted.

| # | Domain | Core entities | Depends on |
|---|---|---|---|
| B1 | **Hostel management** | `Hostel`, `Room`, `Bed`, allocation (student ↔ bed, with transfer/vacate), warden assignment, optional mess/meal tracking, optional visitor log. Fee integration: a "Hostel" fee head that plugs into the existing Fees module. | Fees module (exists) |
| B2 | **Transport / bus management** | `Route`, `Stop`, `Vehicle`, driver/conductor assignment, student-to-stop assignment, a live-location read/write API. **Per your earlier decision**: the web app should NOT build a driver-facing GPS-reporting screen — that's the future KMM app's job, calling the same API. Web scope here is: admin route/stop/vehicle setup, and a parent-facing "where's the bus" live map reading from the same location endpoint. | Nothing blocking — can build the whole data model + admin UI + parent map now; the live-location endpoint just sits unused until the KMM app calls it. |
| B3 | **Library management** | `Book` (catalog), `BookCopy` (physical copies, barcode), `Loan` (issue/return, due date, fine calculation), member borrow limits per role. | Fees module, if fines should be payable through it |
| B4 | **Inventory / procurement** | `Asset`/`Item` (consumable vs. fixed asset), `StockMovement` (in/out), `Vendor`, `PurchaseOrder`. This is the piece that lets the school track lab equipment, sports gear, stationery, furniture — and optionally ties into accounting (B6) for vendor payments. | Loosely related to B6 |
| B5 | **Alumni management** | `Alumnus` (a converted/linked former-student record), events, a donation/fundraising ledger if wanted. Smallest of the new domains. | Admissions/certificates (student → alumni conversion on graduation/TC) |
| B6 | **Accounting / general ledger** | This is the biggest one. Right now "accounting" = Fees (money in) + Payroll (money out to staff). A real GL needs: chart of accounts, a proper double-entry ledger, expense tracking (utilities, maintenance, vendor payments from B4), and financial reports (P&L, balance sheet). This is a genuinely large, specialized domain — worth scoping as its own multi-phase effort, not a quick add-on. |

**Effort**: B2, B5 are the smallest (a few days each, similar to Phase 8's welfare module). B1, B3 are medium (a week-ish each — real allocation/inventory logic). B4 is medium-large. B6 (real accounting) is the largest single item on this whole list — genuinely comparable in scope to everything built in Phases 5+6 (Fees + Payroll) combined, and probably deserves its own dedicated planning pass rather than being bolted on quickly.

---

## Suggested sequencing

1. **Track A first** (A1–A8) — bounded, fast, and directly answers "fix employee management." Can likely all land in one multi-agent pass like Phase 8/9/10 did.
2. **B2 (Transport) and B5 (Alumni)** — smallest new domains, good next wins.
3. **B1 (Hostel) and B3 (Library)** — medium domains, each self-contained.
4. **B4 (Inventory)** — medium-large, somewhat depends on how far you want procurement/vendor tracking to go.
5. **B6 (Accounting/GL)** — treat as its own dedicated planning exercise when you get here; don't rush it in alongside the others.

This ordering front-loads value and defers the one item (B6) that's genuinely a different scale of effort from everything else in this project so far.
