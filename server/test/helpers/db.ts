import { PrismaClient } from '@prisma/client'

// vitest.config.ts points DATABASE_URL at DATABASE_URL_TEST (edunova_test) before this (or any test
// file, or src/prisma.ts) is ever imported. This guard just makes a misconfiguration loud instead of
// quietly running against the dev database.
if (!/edunova_test/.test(process.env.DATABASE_URL || '')) {
  throw new Error(`Tests must run against edunova_test, got DATABASE_URL=${process.env.DATABASE_URL}`)
}

export const prisma = new PrismaClient()

// Wipes every school-scoped table between test files (each test file gets a clean database). Order
// matters for FK constraints; TRUNCATE ... CASCADE sidesteps needing an exact dependency order.
export async function resetDatabase() {
  await prisma.$transaction([
    prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "School", "User",
        "AcademicYear", "Term", "Board", "Grade", "Stream", "CurriculumSubject",
        "Class", "Subject", "ClassSubject", "Room", "Enrollment", "Guardian", "AuditLog",
        "PeriodTemplate", "TimetableEntry", "TimetablePublish", "Substitution",
        "File", "AttendanceSession", "AttendanceRecord", "StaffAttendance",
        "GradeScale", "Assessment", "Mark", "Homework", "HomeworkSubmission",
        "Application", "Certificate", "BoardRegistration", "PasswordReset", "ParentVerification",
        "FeeHead", "FeeStructure", "FeeInvoice", "Payment", "FeeReminder",
        "SalaryStructure", "Payslip", "LeaveType", "LeaveRequest", "Contract", "Resignation", "Duty",
        "Post", "PostReaction", "PostComment", "Conversation", "Participant", "Message", "Notification",
        "Meeting", "CalendarEvent",
        "HealthRecord", "PermissionSlip", "SlipResponse", "Achievement", "DisciplinaryCase",
        "DisciplinaryNote", "CallLog", "Activity", "ActivityRegistration",
        "AiConversation", "AiMessage", "Highlight", "PushSubscription",
        "AuthorizedPickupPerson", "PickupEvent", "Visitor",
        "CounselingRecord", "CounselingSettings", "AnonymousReport",
        "MedicationSchedule", "MedicationLog",
        "ParentDigestSend",
        "SchoolGroup", "GroupAdmin",
        "Cohort", "CohortClass", "Capability", "RoomCapability", "TeacherQualification", "WorkingDayPattern"
      RESTART IDENTITY CASCADE
    `),
  ])
}
