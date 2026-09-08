# Phase 14 — Hostel Management (Track B1 of the ERP roadmap)

## Data model

- `Hostel { id, schoolId, name, type (Boys | Girls | Mixed), wardenUserId? (nullable link to a staff User), address? }`
- `HostelRoom { id, hostelId, roomNumber, floor?, capacity (int), roomType? (e.g. "Dorm", "Double", "Single") }`
- `HostelBed { id, roomId, bedLabel (e.g. "A", "B", or 1/2/3) }` — one row per physical bed, so occupancy is exact, not just a capacity counter. `capacity` on `HostelRoom` should equal the count of `HostelBed` rows for that room (enforce this at creation — when a room is created with a capacity N, auto-create N beds, or require beds to be added explicitly, your call, but keep them consistent).
- `HostelAllocation { id, studentId, bedId, checkInDate, checkOutDate? (null while active), status (Active | Vacated | Transferred), allocatedById, notes? }` — a student can have at most one `Active` allocation at a time (enforce in service logic, not just trust the caller).
- Optional, only if time allows and it's low-risk: `HostelVisitorLog { id, hostelId, studentId, visitorName, visitorRelation?, purpose?, checkInAt, checkOutAt?, recordedById }` — a simple front-desk visitor register. Treat as a nice-to-have; the allocation system is the core requirement.
- Optional, only if time allows: a `Mess`/meal-plan concept — explicitly SKIP this unless everything else is done early and low-risk to add; it's the least essential part of "hostel management" for a first pass and adds real scope (menu, attendance-at-meals, etc.).

## Allocation logic (the core of this phase)

- Allocating a student to a bed: bed must not already have an `Active` allocation (a bed holds one student at a time — no bunk-sharing concept needed). Reject with a clear error (not a 500) if the bed is occupied.
- Checking a student out / vacating: sets `status: Vacated`, `checkOutDate: now`, frees the bed.
- Transferring a student to a different bed/room: implemented as vacate-old + allocate-new in one transaction (`status: Transferred` on the old row, a fresh `Active` row on the new bed) — don't just mutate the `bedId` on the existing row, keep the history honest.
- A student with a currently-`Active` allocation cannot be allocated a second bed without first being vacated/transferred (enforce server-side, don't rely on the frontend to prevent this).

## Fee integration

- Reuse the EXISTING Fees module (`server/src/modules/fees/`) — do not build a separate hostel-fee system. When a hostel allocation is created, this phase does NOT need to auto-generate an invoice (that's real scope creep for a first pass) — it's enough that an admin can create a "Hostel" `FeeHead` (already fully supported by the existing Fees module with zero code change) and build a fee structure that includes it, the same way "Transport" already works as a fee-head example in the sample data. Just make sure your sample data demonstrates this: seed one `FeeHead` named "Hostel" if one doesn't already exist, to show the integration point working end to end through the existing, unmodified Fees UI.

## Endpoints

- `/api/hostel/hostels`, `/api/hostel/rooms`, `/api/hostel/beds` — CRUD, staff/admin/superadmin write, broader read (teachers might reasonably want to see occupancy for their own students — your call on exact read scope, document it).
- `/api/hostel/allocations` — create (allocate), `POST /:id/vacate`, `POST /:id/transfer` (body: new bedId), `GET /allocations?studentId=` (self/guardian can see their own/their ward's; staff/admin see all).
- A student/parent should be able to see "which hostel/room/bed am I / is my ward in" on their own — a simple read endpoint, reuse existing guardian/self-scoping helpers from `server/src/lib/scope.ts` rather than writing new ones if an equivalent pattern already exists (check how e.g. health records or the student dossier scope "self or guardian" access).

## Frontend

- **Admin/staff screen** ("Hostel" or "Hostel Management"): manage hostels/rooms/beds (a simple hierarchical view — hostel → rooms → beds with occupancy status per bed), and an allocation flow (pick a student, pick an available bed, allocate; vacate/transfer from an occupied bed's row). A visual occupancy summary (e.g. "42/60 beds occupied" per hostel) is a nice, low-effort addition.
- **Student/parent screen** ("My Hostel" or a section wherever makes sense — check if it fits better as its own module or a card on the Student Report, your call): shows their current allocation (hostel, room, bed, warden contact) if any, or a clear "not allocated" state.
- Sample data: 1 hostel with 2-3 rooms (mixed capacities), beds fully generated, 2-3 students allocated (using existing sample students), one "Hostel" fee head.

## Ground rules
Same as every previous phase: additive migrations, `{router,service,schema}.ts` pattern, zod, `requireRole()`, `HttpError`, `audit()` on mutations, no git commands, no `/admin/reset`/`/admin/load-sample-data` except your own final step, server/frontend split with Portal.tsx changes described-not-made by the frontend agent, full tsc/eslint/test verification, live curl+UI verification.
