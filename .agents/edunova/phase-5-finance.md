# Phase 5 — Finance (fees, payments, payroll)

> Same conventions. Replaces blob key `receipts`; fee defaulters and AI-call reminders become derived/real.

## Model
```
FeeHead          id, schoolId, name "Tuition", isRecurring, createdAt                       unique(schoolId, name)
FeeStructure     id, schoolId, classId, termId, dueDate, lines Json [{ feeHeadId, amount }]   unique(classId, termId)
FeeInvoice       id, schoolId, studentId, feeStructureId?, termId, lines Json [{feeHeadId, name, amount}], total, concession (default 0), dueDate,
                 status Due|PartiallyPaid|Paid|Waived, invoiceNo "INV/2026/0001", createdAt        unique(studentId, feeStructureId) when structureId set
Payment          id, schoolId, invoiceId, amount, method UPI|Card|NetBanking|Cash|Cheque, reference?, paidAt, recordedById, receiptNo "RCPT/2026/0001", note?
FeeReminder      id, schoolId, invoiceId, sentById, channel InApp|Email|SMS, sentAt, note?
SalaryStructure  id, schoolId, userId, basic, allowances Json [{name, amount}], deductions Json [{name, amount}], effectiveFrom    unique(userId)
Payslip          id, schoolId, userId, month "2026-06", basic, allowances, deductions, gross, net, status Generated|Paid, paidAt?, paidById?, slipNo    unique(userId, month)
```
Invoice `status` derived from payments: paid ≥ total−concession → Paid; >0 → PartiallyPaid; Waived set explicitly.

## Endpoints
### `/api/fees` (staff/admin/superadmin write; parents/students read own)
| GET/POST/PATCH/DELETE | `/heads` | |
| GET/POST/PATCH/DELETE | `/structures?classId&termId` | `{classId, termId, dueDate, lines}` |
| POST | `/structures/:id/generate` | creates an invoice for every **active** enrollment in the class (idempotent: skips students who already have one for this structure) → `{ created, skipped }` |
| GET | `/invoices?studentId&termId&status&classId` | student/parent: own/wards only |
| POST | `/invoices` | ad-hoc invoice `{ studentId, termId, lines, dueDate }` |
| PATCH | `/invoices/:id` | `{ concession?, dueDate?, status:"Waived"? }` |
| GET | `/invoices/:id/receipt.pdf` | PDF statement listing payments |
| POST | `/payments` | `{ invoiceId, amount, method, reference?, note? }` — staff/admin any method; **parent/student may only pay their own invoice with method UPI|Card|NetBanking through the gateway flow below** |
| GET | `/payments?invoiceId&studentId&from&to` | |
| GET | `/payments/:id/receipt.pdf` | |
| POST | `/gateway/order` | parent/student `{ invoiceId, amount }` → if `RAZORPAY_KEY_ID` set: creates a Razorpay order (test mode) and returns `{ orderId, key, amount }`; else returns `{ sandbox: true, orderId }` |
| POST | `/gateway/confirm` | `{ orderId, invoiceId, amount, method, paymentId?, signature? }` → verifies (HMAC when keys are set; sandbox accepts) and records a `Payment` |
| GET | `/defaulters?termId&classId` | derived: students with any invoice Due/PartiallyPaid past dueDate → `{ studentId, name, classLabel, parent{name,phone,email}, outstanding, oldestDue, reminders: n }` |
| POST | `/reminders` | `{ invoiceId, channel, note? }` → creates FeeReminder and a Notification (Phase 7; if notifications don't exist yet, just the reminder row) |
| GET | `/summary?termId` | collected, outstanding, invoiced, byHead[] for the Overview tiles |

### `/api/payroll` (admin/superadmin; employees read own)
| GET/PUT | `/structures/:userId` | upsert `{ basic, allowances, deductions, effectiveFrom }` |
| POST | `/run` | `{ month }` → generates a Payslip for every teacher/staff/admin with a SalaryStructure and an Active contract (Phase 6; until then: with a structure) — idempotent |
| GET | `/payslips?userId&month` | |
| PATCH | `/payslips/:id/mark-paid` | |
| GET | `/payslips/:id.pdf` | |

`GET /api/data` drops `receipts`; PUT strips it.

## Sample data
Fee heads Tuition/Transport/Lab & Activity; structures for X-A and X-B for t1–t3 (42500/9000/6500), invoices generated, payments so that Aarav has Lab & Activity due (₹6,500), Diya has Lab due, Kabir has everything due (defaulter), Rohan paid in full. Salary structures for all 11 contracts (basic = seed salary), payslips for Jan–Mar 2026 marked Paid.

## Frontend
- **Admin/staff · Fee Setup** (`FeesMod` rewrite): tabs Heads · Structures (class + term grid, lines editor, Generate invoices with created/skipped toast) · Invoices (filter class/term/status; concession; waive; open receipt PDF).
- **Staff · Collections** (new in `FeesMod` or own module): search a student → invoices → record a cash/cheque/UPI payment → print receipt.
- **Parent/student · Payments** (`PaymentGatewayMod` rewrite): own invoices with status; Pay → gateway order → (sandbox: confirm immediately, with a clear "Sandbox" banner) → receipt; remove the fake "I have paid" and the desktop-only gate.
- **Fee Defaulters** (`feeDefaulters.tsx`): derived list from `/fees/defaulters`; **Send reminder** real (`POST /reminders`, shows history count); keep the AI-call log but delete `simulateCall`'s random transcript/outcome — "Simulate" button removed; scheduling a call stays as a log row (Phase 9 decides telephony).
- **Payroll** (admin, `PaymentsMod salary` for admin → new `PayrollMod`): structures table, Run month, payslips list, mark paid, PDF. **My Payslips** (teacher/staff): own payslips + PDF.
- Overview: parent "Fees due" from `/fees/invoices`; admin "Collected this term" from `/fees/summary`.
