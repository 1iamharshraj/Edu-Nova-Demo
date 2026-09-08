# Phase 13 — Alumni Management (Track B5 of the ERP roadmap)

Smallest of the new ERP domains. Lets a school track former students after they leave (via TC or graduation), run alumni events, and optionally track donations.

## Data model

- `AlumniProfile { id, schoolId, studentUserId? (nullable link back to their original User record, if they were in this system as a student), name, email?, phone?, graduationYear, lastClassLabel (free text, e.g. "XII-A CBSE" — denormalized at conversion time since the class itself may later change/be deleted), currentOccupation?, currentOrganization?, currentCity?, linkedInUrl?, notes?, convertedAt, convertedById }`
- `AlumniEvent { id, schoolId, title, description?, date, location?, createdById }`
- `AlumniEventRsvp { id, eventId, alumniId, status (Interested | Going | Declined), respondedAt }`
- `AlumniDonation { id, schoolId, alumniId, amount, purpose?, donatedAt, recordedById, note? }` — this is a RECORD-KEEPING feature (staff manually logs a donation that came in through some external channel — cheque, bank transfer, whatever), NOT a payment gateway integration. Do not try to build a donation payment flow — that's out of scope; if you want, you MAY reuse the existing sandbox-gateway pattern from the Fees module for a "pledge now" flow if it's genuinely simple to bolt on, but a manual record-entry screen is the actual requirement and is sufficient on its own.

## Conversion flow

- `POST /alumni/convert-student` — takes a `studentId` (must currently be `role: 'student'`), creates an `AlumniProfile` from their current data (name, class from their active enrollment, etc.), and — this is a product decision, make a reasonable call and document it — either (a) leaves their `User` account as-is (still `role: 'student'`, just also has an alumni profile now) or (b) actually changes their role/deactivates the student account (similar to how a TC certificate already ends an enrollment, per the existing Applications module — check `applications/service.ts`'s TC-issuance logic for the precedent). Prefer whichever is more consistent with how TC issuance already works, since a natural trigger for "this student is now an alumnus" is exactly the TC-issuance moment — check if it makes sense to offer alumni conversion as an option at that same point in the Applications module (staff/admin, when approving/issuing a TC), rather than only as a fully separate standalone action elsewhere. Use your judgement, but explain the choice clearly.
- Staff/admin/superadmin only for conversion and all write operations.

## Endpoints

- `/api/alumni/profiles` — CRUD (staff/admin write; read can be broader — teachers/staff/admin, your call, but NOT student/parent, since this is institutional data about other people, not something a random logged-in parent should browse).
- `POST /alumni/convert-student` as above.
- `/api/alumni/events` — CRUD (staff/admin write, broader read is fine).
- `/api/alumni/events/:id/rsvp` — an alumni profile's own RSVP. **Important**: alumni do NOT have portal logins in this system (they're not a `User` role) — so RSVP in this phase is recorded BY staff/admin on an alumnus's behalf (e.g. "mark so-and-so as Going"), not a self-service action. Do not build alumni authentication/login — that's a much bigger, separate decision (a whole new actor type) not in scope here.
- `/api/alumni/donations` — CRUD, staff/admin/superadmin only (financial data).

## Frontend

One admin/staff module ("Alumni") with tabs or sections: Directory (search/filter alumni by graduation year, list with contact info and current occupation), Events (create an event, mark RSVPs on behalf of alumni), Donations (log a donation, see a running total per alumnus and school-wide). Plus, if you took the "offer conversion at TC-issuance time" integration route above and it's genuinely low-risk to add, a small addition to the existing Applications module's TC-approval flow (describe this precisely in your report rather than making it yourself if it touches a file the frontend agent doesn't own — check first).

Sample data: 3-4 seeded alumni profiles (a couple linked to an existing/former sample student if convenient, others just standalone historical records), one seeded event with a couple of RSVPs, one or two seeded donations.

## Ground rules
Same as every previous phase: additive migrations, `{router,service,schema}.ts` pattern, zod, `requireRole()`, `HttpError`, `audit()` on mutations, no git commands, no `/admin/reset`/`/admin/load-sample-data` except your own final step, server/frontend split with Portal.tsx changes described-not-made by the frontend agent, full tsc/eslint/test verification, live curl+UI verification.
