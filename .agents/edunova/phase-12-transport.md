# Phase 12 — Transport / Bus Management (Track B2 of the ERP roadmap)

**Key constraint from the product owner**: a dedicated native mobile app (Kotlin Multiplatform) will be built later specifically to have the driver/conductor report live GPS location. **Do NOT build a browser-based/PWA driver-facing GPS-reporting screen** — that would be throwaway work. This phase builds everything else: the data model, admin setup UI, and a parent-facing live tracking view that reads from a location endpoint the future native app will call. The location-ping endpoint should be built and testable (e.g. via curl) even though nothing in this web app calls it as a "driver" — that's expected and correct.

## Data model

- `Route { id, schoolId, name, description?, createdAt }`
- `Stop { id, routeId, name, sequence (int, order along the route), latitude?, longitude?, arrivalOffsetMin? (minutes from route start, for an ETA estimate) }`
- `Vehicle { id, schoolId, registrationNo, capacity, routeId? (a vehicle can be unassigned), driverName, driverPhone, conductorName?, conductorPhone? }` — driver/conductor are plain fields here, NOT `User` accounts, since drivers/conductors are very unlikely to need portal logins for anything except the future native app (which will authenticate some other way — out of scope for this phase; if you want to link a driver to an existing staff `User` optionally via a nullable `driverUserId`, that's fine and probably a good idea for the future app's auth, but don't require it).
- `StudentStopAssignment { id, studentId, stopId, boardingType (Pickup | Drop | Both), createdAt }` — which stop a student uses.
- `VehicleLocation { id, vehicleId, latitude, longitude, recordedAt, tripDate }` — the live-location log. Only the LATEST row per vehicle matters for "where is the bus now," but keep history (don't overwrite in place) since it's cheap and could be useful later (e.g. a "was the bus on time" report) — just make the "current location" query efficient (index on `vehicleId, recordedAt desc`, or a cheap denormalized "latest" pointer if you prefer, your call).

## Endpoints

- `/api/transport/routes` — CRUD, staff/admin/superadmin write, everyone read (a student/parent needs to see their route/stop info).
- `/api/transport/stops` — CRUD scoped to a route, same RBAC.
- `/api/transport/vehicles` — CRUD, staff/admin/superadmin.
- `/api/transport/assignments` — assign/unassign a student to a stop, staff/admin. A parent/student can read their own assignment.
- `POST /api/transport/vehicles/:id/ping` — `{ latitude, longitude, tripDate? }`, records a `VehicleLocation` row. Auth: for now, gate this the same way other write endpoints are gated (e.g. staff/admin, or — more realistic for a future driver — any authenticated user, your call, but document the choice clearly since the future KMM app's auth story isn't decided yet; a reasonable middle ground is to gate it to staff/admin/superadmin for now, matching "whoever the driver logs in as today" being a staff account, and leave a clear comment that this will need revisiting when the native app defines its own driver-auth flow).
- `GET /api/transport/vehicles/:id/location` — latest location (or `null`/404 if none recorded yet, don't error confusingly). RBAC: a parent/student may only read the vehicle covering a stop they're actually assigned to; staff/admin can read any.
- `GET /api/transport/my-stop` (parent/student convenience) — returns their stop, route, and the assigned vehicle's latest location in one call, since that's what the parent-facing UI actually wants (avoid the frontend having to stitch 3 calls together).

## Frontend

- **Admin/staff screen** ("Transport" or "Routes & Vehicles"): manage routes (with their ordered stops), vehicles (assign to a route, driver/conductor contact info), and student-stop assignments (a simple picker: student → route → stop).
- **Parent/student screen** ("My Bus" or "Transport"): shows their assigned stop/route, and if a location has been recorded recently (e.g. within the last 30 min — treat anything older as "not currently tracked," don't show a stale pin as if it's live), a simple map or at minimum a clear "last seen near <lat,lng> at <time>" readout. A real embedded map (e.g. Leaflet via a CDN-safe approach, or even just a static representation) is nice if straightforward; if map-library integration proves complex or risky in the time available, a clean non-map readout (stop name, last-seen time, distance/ETA if you can cheaply compute it) is an acceptable fallback — note which you built.
- Sample data: 1-2 routes with 3-4 stops each, 1-2 vehicles assigned, a handful of students assigned to stops, and (to make the parent view demonstrable) one or two seeded `VehicleLocation` pings with a recent timestamp.

## Ground rules
Same as every previous phase: additive migrations, `{router,service,schema}.ts` pattern, zod, `requireRole()`, `HttpError`, `audit()` on mutations, no git commands, no `/admin/reset`/`/admin/load-sample-data` except your own final step, server/frontend split with Portal.tsx changes described-not-made by the frontend agent, full tsc/eslint/test verification, live curl+UI verification.
