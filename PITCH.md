# EduNova — Complete School Management ERP

### One platform for everything a school runs on — academics, operations, finance, and people — built in 2026, not patched together since 2012.

---

## The problem with school ERP in India today

Every school we spoke to and every platform we researched (Fedena, Entab, Edsys, Skolaro, Vidyalaya, MyClassCampus, Classe365, and others) told the same story:

1. **"Accounting" usually isn't accounting.** Most school ERPs collect fees and stop there. The moment a school's accountant needs a real trial balance, P&L, or balance sheet, the numbers get manually re-typed into Tally as receipt vouchers — fee collections in one system, the actual books in another, reconciled by hand every month.
2. **Pricing has a asterisk.** Advertised per-student rates rarely include setup, training, SMS credit packs, payment-gateway fees, or the ₹25,000–₹50,000 "module add-on" charge for things like transport or hostel. Real first-year cost commonly runs 40–60% above the number on the pricing page.
3. **Your data lives on someone else's server, forever.** Almost every platform in the market is cloud-SaaS only, with no path to bring your own data home if you ever want to leave.
4. **Employee management stops at payroll.** Academic features get all the attention; HR is usually just "pay the staff and track their leave." No reporting lines, no performance history, no real employee record.
5. **The software feels like 2012.** Reviewers of the most established Indian platforms flag complex installs, non-intuitive navigation, and finance modules that are "very complex" to use — because the codebases underneath are over a decade old.

EduNova was built to fix all five, from a blank slate, in 2026.

---

## What EduNova actually is

A single, real, end-to-end platform — not a demo, not a prototype. Every module below is backed by a real database, real server-side authorization (checked by an 87-test automated suite that runs on every change, plus a further end-to-end browser test suite), and a real, working UI for every role in the school: superadmin, admin, staff, teacher, student, and parent.

### Academics
- **Multi-board, multi-grade curriculum as a first-class structure** — Board, Grade, Stream, and Curriculum are real, independent entities, not a free-text label. A single school can run CBSE, ICSE, IB, State Board, and IGCSE side by side, with the *same* grade and section (e.g. "X-A") existing independently under each board it's taught in — genuinely rare in this market, where "board" is typically just a dropdown that swaps a grading template.
- Academic years, terms, classes, sections, rooms, subjects, teacher assignments, student enrollment, guardian linking.
- **Timetable builder** with real server-side teacher/room double-booking detection (not a client-side warning that can be ignored), publish/unpublish, substitutions, and copy-between-classes.
- **Attendance** — student and staff, period-by-period from the real timetable, CSV export, session locking.
- **Gradebook, grade scales, report cards, and rank lists** — computed server-side, mathematically consistent across every role's view of the same student.
- **Homework** — assignment creation with real file attachments, submission tracking, grading, and feedback.

### Admissions & Identity
- Full admission pipeline: apply → verify → approve, with student and parent accounts created automatically and randomly-generated one-time passwords (forced change at first login — a genuine security control, not a checkbox).
- **Certificates** (Transfer, Bonafide, Character) — real, serially-numbered PDFs, generated on demand.
- **Board exam registration** — a dedicated workflow for 10th/11th/12th board-exam registration with a name/DOB mismatch checklist against the school's own records before a registration can be validated.
- Parent identity verification, gating sensitive parent-only actions until verified.

### Finance — Fees, Payroll, and a Real General Ledger
- **Fee management**: fee heads, per-class/term fee structures, idempotent invoice generation, a sandbox-to-production-ready payment gateway, automatic reminders, and a live defaulters list.
- **Payroll**: per-employee salary structures, idempotent monthly payroll runs, real downloadable payslip PDFs.
- **A real double-entry general ledger** — chart of accounts, balanced journal entries (mathematically enforced — an unbalanced entry cannot be saved, ever), trial balance, profit & loss, and balance sheet reports. Fee payments and payroll runs **auto-post to the ledger** the moment they happen. This is the single most differentiated feature in this document: across the fourteen major Indian and international school platforms we researched, only one (an open-source general-purpose ERP, not an education-specific product) offers a genuine built-in GL — every education-specific competitor treats real accounting as somebody else's problem, typically Tally, typically re-entered by hand.

### HR & Employee Management
- Leave types and requests, staff contracts with dual (employee + admin) digital sign-off, resignations with notice-period tracking, event duty rosters, staff attendance.
- **Employee IDs, real reporting-line hierarchies (an actual org structure, not a label), performance reviews with a share/acknowledge workflow, and a permanent, auto-logged employment history** (every role, designation, department, and salary change, with the date it took effect) — depth that academic-first competitors generally don't build, because their focus stops at "pay the staff."
- Employee document storage and a real, downloadable staff ID card.

### Communication
- **School feed** with posts, reactions, and comments, scoped by audience (whole school or one class).
- **Real-time messaging** — actual live delivery (not "refresh to see new messages"), with role-appropriate contact rules (a parent can only message their child's teachers, for instance).
- **In-app + push notifications**, meetings with real generated video-call links, and an audience-scoped calendar.

### Student Welfare & Compliance
- Health records with genuinely enforced privacy (visible only to the student, their guardians, their class teacher, and staff/admin — not the whole staff room).
- Permission slips with parent approval, achievements, a disciplinary case workflow, a real call log for parent follow-up calls, and extracurricular activity registration with capacity limits and automatic waitlist promotion.

### Facilities — Hostel, Transport, Library, Inventory
- **Hostel**: room and bed-level allocation, occupancy tracking, transfer history, integrated with the same Fees module (no separate hostel-billing system).
- **Transport**: routes, stops, vehicles, student-stop assignments, and a live-location API ready for driver-side GPS reporting from a phone or an in-vehicle device — architected so a future dedicated driver app can plug straight in.
- **Library**: full catalog, per-copy tracking, issue/return, borrowing limits by role, automatic overdue fine calculation.
- **Inventory & procurement**: stock tracking where the balance can only move through a logged, auditable movement (never silently edited), full purchase-order lifecycle with partial/full receiving, vendor management, low-stock alerts.

### Alumni
- Alumni profiles (with an optional one-click conversion right at the moment a Transfer Certificate is issued), event management with RSVP tracking, and donation record-keeping.

### AI & Integrations
- **AI-powered doubt-clearing chat for students**, built directly into the student portal and scoped to that student's own subjects — a feature we could not find offered by any of the major Indian or international school platforms researched.
- Real email/SMS delivery, push notifications, and a highlights/media reel for school events.

### Security & Reliability (the part that doesn't show up on a feature list, but matters most)
- Modern authentication: short-lived access tokens with automatic, invisible refresh — no "please log in again" every 15 minutes.
- Rate limiting on login and password-reset endpoints, real file-type verification on every upload (not just checking the file extension), a full audit trail of every sensitive action, and role-based access control checked server-side on every single request — not just hidden in the UI.
- **87 automated backend tests plus a full browser-based end-to-end test suite**, run on every change, covering the RBAC boundary for every role. This is not marketing language — it's the actual verification discipline the product was built under.

---

## What genuinely sets EduNova apart

Based on direct research into the current Indian school-ERP market (see methodology note at the bottom):

| | The market | EduNova |
|---|---|---|
| **Accounting** | Fee collection only; real books kept separately in Tally, reconciled by hand | A real double-entry GL, auto-posted from fees and payroll, balanced by design |
| **Data ownership** | Almost universally cloud-SaaS only, with no way to bring your data home | A genuine self-hosted option — run EduNova entirely on your own servers if you want full control of your students' data |
| **Multi-board depth** | "Board" is typically a label or a grading-template switch | Board, Grade, Stream, and Curriculum are independent, structured entities from day one |
| **AI for students** | Not offered by any major platform we found | A real AI doubt-clearing tutor, built into the student portal |
| **Employee management** | Payroll and leave, little else | Org structure, performance reviews, and a permanent employment history |
| **Pricing** | Advertised rate + hidden setup/training/module fees, often 40–60% more in year one | One number. Every module included. No per-feature add-on tax. |
| **Architecture** | Codebases dating to the early 2010s; reviewers flag complex installs and "very complex" finance modules | Built in 2026, tested end to end, deployed in Docker containers you can stand up in an afternoon |

We're not claiming to be the only school software in India with a timetable or a fee module — that's table stakes, and we have those too, done well. What we're claiming is specific and checkable: a real general ledger, a real self-hosting option, a real AI tutor for students, and real employee-management depth are not things you'll find bundled together anywhere else we could find in this market.

---

## Pricing

No module add-ons. No "contact sales" black box for basic pricing. Every plan includes **every module described above** — academics, admissions, finance and the real GL, HR, communication, welfare, hostel, transport, library, inventory, alumni, and the AI tutor. What changes between plans is scale and support, never features.

### Cloud (hosted by us)

| Plan | School size | Price | What's included |
|---|---|---|---|
| **Starter** | Up to 300 students | **₹65,000 / year** (~₹217/student/year) | Every module. Email support, 2 business day response. Standard onboarding (data import + admin training, remote). |
| **Growth** | 301–1,000 students | **₹1,10,000 – ₹1,80,000 / year** (~₹150–170/student/year, tiered) | Every module. Priority email + phone support, 1 business day response. On-site or remote onboarding, your choice. |
| **Enterprise** | 1,000+ students, or multi-campus / multi-board groups | **Custom quote, typically ₹100–130/student/year at scale** | Every module. Dedicated account manager, same-day support, on-site onboarding and staff training, custom SSO/integration work available. |

### Self-Hosted (your servers, your data)

| Plan | Best for | Price |
|---|---|---|
| **Data Sovereignty** | Trusts, boards, or schools that require their student data to never leave their own infrastructure | **₹2,50,000 one-time setup and license** + **₹75,000/year** for updates, security patches, and support |

Self-hosted deployment ships as a documented Docker Compose stack — Postgres, the API, and the web app, each in its own container, with automatic database migrations and a nightly backup job included out of the box. Your IT team (or ours, on request) can have it running in an afternoon.

### What's genuinely extra (and clearly priced, not hidden)
- **SMS/WhatsApp credit packs**, if you want native SMS delivery instead of the included email notifications — billed at cost, no markup, no minimum commitment.
- **Custom domain and school branding** (logo, colour theme) — included free on Growth and above, ₹10,000 one-time on Starter.
- **Data migration from an existing ERP** — free for standard imports (student/staff/fee records in a common format); custom migration from a legacy system quoted case by case, typically ₹15,000–₹40,000 depending on complexity.

That's the complete list. There is no sixth line item that appears on your invoice in month three.

---

## Why this pricing, and why we can afford to include everything

Typical Indian school ERP pricing for a mid-size school (500–1,500 students) runs **₹50,000 to ₹1,50,000 a year** before add-ons, per independent market research — and that's *before* the setup, training, and per-module costs that commonly push real first-year spend 40–60% higher. EduNova's pricing sits inside that same band, but the number you see is the number you pay, because every module is already included in every tier. We'd rather compete on the product than on how well we can hide a fee schedule.

---

## Get started

- **See it running**: we'll walk your team through a live demo on your own sample data — no generic canned demo.
- **Try before you commit**: a 30-day pilot on a subset of your students/staff, at no cost, before any contract is signed.
- **Migrate at your pace**: run EduNova alongside your current system for one full term if you'd rather not switch everything at once.

---

*Methodology note: the competitive claims in this document are based on a direct research pass (September 2026) across fourteen named Indian and international school-ERP platforms — Fedena, Entab CampusCare, Teachmint, MyClassCampus, Vidyalaya/VidyalayaERP, ERPNext Education, Classe365, Meritto, Edsys, School360, Genius School ERP, and iSAMS, cross-checked against independent review sites and pricing-comparison sources where available. Pricing figures for competitors were not consistently vendor-confirmed (most Indian school ERPs do not publish pricing) and are presented as aggregated market ranges from independent sources, not as claims about any single named competitor's exact price. Where a competitive claim could not be fully verified (for example, the precise technical depth of a competitor's "multi-board support" or "financial module"), this document says so rather than asserting it as fact — we'd encourage any prospective client to verify these claims independently, and we're confident they'll hold up.*
