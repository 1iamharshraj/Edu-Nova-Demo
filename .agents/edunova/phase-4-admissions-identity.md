# Phase 4 — Admissions, certificates, identity

> Same conventions. Replaces blob keys `applications`, `boardDetails`, `marksheets`. Adds real account hygiene.

## Model
```
Application     id, schoolId, kind Admission|TC|Bonafide|Character, applicantName, dob?, gender?,
                guardian Json {name, phone, email, relation}, targetClassId?, targetBoardId?, studentId? (for TC/Bonafide: the existing student; set on Admission approval),
                documents String[] (File ids), status Pending|Verified|Approved|Declined, notes?, submittedById?, decidedById?, decidedAt?, createdAt
Certificate     id, schoolId, kind TC|Bonafide|Character, studentId, serialNo (per school, sequential "EDN/TC/2026/0001"), issuedById, issuedAt, pdfFileId, applicationId?
BoardRegistration  id, schoolId, studentId, boardId, academicYearId, registrationNo?, rollNo?, nameOnCertificate, dob, affiliationNo?,
                status Draft|Pending|Validated|SentToBoard, validatedById?, validatedAt?, sentAt?, mismatchNote?     unique(studentId, academicYearId)
PasswordReset   id, userId, tokenHash, expiresAt, usedAt?
ParentVerification id, schoolId, parentId, method Document|InPerson|Aadhaar, status Pending|Verified|Rejected, documentFileId?, verifiedById?, verifiedAt?, note?   unique(parentId)
User            + photoFileId?, emergencyContact?, address?, lastLoginAt?  ; `verified` becomes derived from ParentVerification.status === Verified (server keeps the column in sync)
```

## Endpoints
### `/api/applications`
| GET | `/?kind&status` | staff/admin: all; student/parent: own (`studentId` in wards/self or submittedById) |
| POST | `/` | parent/student: TC/Bonafide/Character for self/ward; staff/admin: any incl. Admission |
| PATCH | `/:id` | applicant before decision; staff/admin any |
| POST | `/:id/verify` | staff/admin → Verified |
| POST | `/:id/approve` | staff/admin. **Admission**: transaction creates student User (from applicantName/dob), Enrollment in `targetClassId` (next free rollNo), parent User from guardian (or links an existing parent by email) + Guardian; returns `{ item, created: { student:{email,password}, parent?:{email,password} } }`. **TC**: sets the student's active enrollment `status:"transferred"`, issues a Certificate (PDF). **Bonafide/Character**: issues a Certificate. |
| POST | `/:id/decline` | `{ notes }` |
| DELETE | `/:id` | admin |

### `/api/certificates`
| GET | `/?studentId` | |
| POST | `/` | `{ kind, studentId }` staff/admin — direct issue without an application |
| GET | `/:id/pdf` | streams the PDF (generated with `pdfkit`, stored as a File): school name, serial, student name, class, DOB, issue date, issuer, QR with the serial |

### `/api/board-registrations`
CRUD + `POST /:id/validate` (teacher of the class or staff/admin), `POST /:id/send` (admin/superadmin) ; `POST /prefill` `{studentId}` builds a Draft from Enrollment + profile. List scoped like the old MarksheetMod (student self, parent wards, teacher classes, staff/admin all). Marksheet PDF: `GET /:id/marksheet?termId` — builds from Phase 3 report-card (via the assessments service) + the registration details; served as a Certificate-like PDF (not stored).

### `/api/auth` additions
| POST | `/change-password` | `{ currentPassword, newPassword }` (min 8) → clears `mustChangePassword` |
| POST | `/forgot` | `{ email }` → always 200; creates PasswordReset; in dev, logs the reset URL to the server console and returns `{ devResetUrl }` when `NODE_ENV!=='production'` |
| POST | `/reset` | `{ token, newPassword }` |
| POST | `/admin/set-password` | admin/superadmin for a manageable user `{ userId, newPassword? }` → returns the (generated) password once and sets `mustChangePassword` |
`/api/auth/me` and login responses include `mustChangePassword`. Update `lastLoginAt` on login.

### `/api/users/me`
`PATCH /api/users/me` `{ name?, phone?, address?, emergencyContact?, photoFileId?, dob? }` (self only; students cannot change name).

### `/api/verification` (parents)
| GET | `/me` | parent's own record |
| POST | `/me` | `{ method, documentFileId? }` → Pending |
| GET | `/?status` | staff/admin |
| POST | `/:id/verify` · `/reject` `{note}` | staff/admin |

### Admin management
`POST /api/users` already supports admins; add `PATCH /api/users/:id/role` (superadmin only) `{ role }` within admin/staff/teacher.

`GET /api/admin/audit` gains `?entity&actorId` filters. `GET /api/data` drops `applications`, `boardDetails`, `marksheets`.

## Frontend
- **Forced password change**: after login, if `user.mustChangePassword`, route to `/change-password` (new page) before the portal.
- **Profile** page (all roles, top-right avatar → Profile): edit self fields, photo upload, change password, see wards/classes. Header avatar becomes a button.
- **Login**: "Forgot password?" → `/forgot` (email form; in dev, shows the reset link) → `/reset?token=…`.
- `ApplicationsMod` rewrite: staff/admin pipeline (tabs by kind; filters; Verify / Approve / Decline; the approve dialog for Admission shows the accounts that will be created and, after success, the credentials once); parent/student: apply for TC/Bonafide/Character with document upload, track status, download the certificate when approved.
- `MarksheetMod` → **Board Registration** on `/board-registrations` with prefill, validate, send, mismatch note, and "Download marksheet" (PDF).
- **Parent verification** (`ui.tsx` `VerifyButton` flow): replace the fake OTP/face with: parent uploads an ID document → Pending; staff/admin **Verifications** screen (new, in `office.tsx`) approves/rejects; the `verified` badge follows. Slip approval and e-sign require `verified`.
- **Admin Management**: create admin, change role, revoke.
- **Settings → Audit**: filters by entity/actor.
- Landing/Login copy: drop "Aadhaar + face" claims.
