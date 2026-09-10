-- CreateTable
CREATE TABLE "TimetableSession" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "teachingAssignmentId" TEXT,
    "teacherId" TEXT,
    "roomId" TEXT,
    "sessionType" TEXT NOT NULL DEFAULT 'SINGLE',
    "durationPeriods" INTEGER NOT NULL DEFAULT 1,
    "isSplittable" BOOLEAN NOT NULL DEFAULT false,
    "timetableVersionId" TEXT,
    "jobId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "TimetableSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimetableSessionEntry" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "periodIdx" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimetableSessionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionCohort" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionCohort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionRequirement" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "teachingRequirementId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElectiveBlock" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "gradeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "periodIdx" INTEGER NOT NULL,
    "durationPeriods" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ElectiveBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElectiveOffering" (
    "id" TEXT NOT NULL,
    "electiveBlockId" TEXT NOT NULL,
    "teachingRequirementId" TEXT NOT NULL,
    "sessionId" TEXT,
    "capacity" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ElectiveOffering_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElectiveChoice" (
    "id" TEXT NOT NULL,
    "electiveOfferingId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Registered',
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ElectiveChoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimetableGenerationJob" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "scopeCohortIds" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentStage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "solverVersion" TEXT NOT NULL,
    "timeLimit" INTEGER NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "constraintSnapshot" JSONB NOT NULL,
    "preferenceSnapshot" JSONB NOT NULL,
    "randomSeed" INTEGER NOT NULL,
    "solverParameters" JSONB NOT NULL DEFAULT '{}',
    "resultVersionId" TEXT,
    "outputHash" TEXT,
    "draftEntries" JSONB,
    "diagnostics" JSONB,
    "errorCode" TEXT,
    "errorDetails" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimetableGenerationJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimetableSession_schoolId_idx" ON "TimetableSession"("schoolId");

-- CreateIndex
CREATE INDEX "TimetableSession_schoolId_termId_idx" ON "TimetableSession"("schoolId", "termId");

-- CreateIndex
CREATE INDEX "TimetableSession_jobId_idx" ON "TimetableSession"("jobId");

-- CreateIndex
CREATE INDEX "TimetableSessionEntry_sessionId_idx" ON "TimetableSessionEntry"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "TimetableSessionEntry_sessionId_dayOfWeek_periodIdx_key" ON "TimetableSessionEntry"("sessionId", "dayOfWeek", "periodIdx");

-- CreateIndex
CREATE INDEX "SessionCohort_cohortId_idx" ON "SessionCohort"("cohortId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionCohort_sessionId_cohortId_key" ON "SessionCohort"("sessionId", "cohortId");

-- CreateIndex
CREATE INDEX "SessionRequirement_teachingRequirementId_idx" ON "SessionRequirement"("teachingRequirementId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionRequirement_sessionId_teachingRequirementId_key" ON "SessionRequirement"("sessionId", "teachingRequirementId");

-- CreateIndex
CREATE INDEX "ElectiveBlock_schoolId_idx" ON "ElectiveBlock"("schoolId");

-- CreateIndex
CREATE INDEX "ElectiveBlock_schoolId_termId_idx" ON "ElectiveBlock"("schoolId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "ElectiveOffering_teachingRequirementId_key" ON "ElectiveOffering"("teachingRequirementId");

-- CreateIndex
CREATE UNIQUE INDEX "ElectiveOffering_sessionId_key" ON "ElectiveOffering"("sessionId");

-- CreateIndex
CREATE INDEX "ElectiveOffering_electiveBlockId_idx" ON "ElectiveOffering"("electiveBlockId");

-- CreateIndex
CREATE INDEX "ElectiveChoice_electiveOfferingId_idx" ON "ElectiveChoice"("electiveOfferingId");

-- CreateIndex
CREATE INDEX "ElectiveChoice_studentId_idx" ON "ElectiveChoice"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "ElectiveChoice_electiveOfferingId_studentId_key" ON "ElectiveChoice"("electiveOfferingId", "studentId");

-- CreateIndex
CREATE INDEX "TimetableGenerationJob_schoolId_idx" ON "TimetableGenerationJob"("schoolId");

-- CreateIndex
CREATE INDEX "TimetableGenerationJob_schoolId_termId_idx" ON "TimetableGenerationJob"("schoolId", "termId");

-- AddForeignKey
ALTER TABLE "TimetableSession" ADD CONSTRAINT "TimetableSession_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSession" ADD CONSTRAINT "TimetableSession_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSession" ADD CONSTRAINT "TimetableSession_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSession" ADD CONSTRAINT "TimetableSession_teachingAssignmentId_fkey" FOREIGN KEY ("teachingAssignmentId") REFERENCES "TeachingAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSession" ADD CONSTRAINT "TimetableSession_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSession" ADD CONSTRAINT "TimetableSession_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSession" ADD CONSTRAINT "TimetableSession_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "TimetableGenerationJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSession" ADD CONSTRAINT "TimetableSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSessionEntry" ADD CONSTRAINT "TimetableSessionEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TimetableSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionCohort" ADD CONSTRAINT "SessionCohort_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TimetableSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionCohort" ADD CONSTRAINT "SessionCohort_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRequirement" ADD CONSTRAINT "SessionRequirement_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TimetableSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRequirement" ADD CONSTRAINT "SessionRequirement_teachingRequirementId_fkey" FOREIGN KEY ("teachingRequirementId") REFERENCES "TeachingRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectiveBlock" ADD CONSTRAINT "ElectiveBlock_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectiveBlock" ADD CONSTRAINT "ElectiveBlock_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectiveBlock" ADD CONSTRAINT "ElectiveBlock_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectiveBlock" ADD CONSTRAINT "ElectiveBlock_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectiveOffering" ADD CONSTRAINT "ElectiveOffering_electiveBlockId_fkey" FOREIGN KEY ("electiveBlockId") REFERENCES "ElectiveBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectiveOffering" ADD CONSTRAINT "ElectiveOffering_teachingRequirementId_fkey" FOREIGN KEY ("teachingRequirementId") REFERENCES "TeachingRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectiveOffering" ADD CONSTRAINT "ElectiveOffering_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TimetableSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectiveChoice" ADD CONSTRAINT "ElectiveChoice_electiveOfferingId_fkey" FOREIGN KEY ("electiveOfferingId") REFERENCES "ElectiveOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectiveChoice" ADD CONSTRAINT "ElectiveChoice_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableGenerationJob" ADD CONSTRAINT "TimetableGenerationJob_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableGenerationJob" ADD CONSTRAINT "TimetableGenerationJob_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableGenerationJob" ADD CONSTRAINT "TimetableGenerationJob_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableGenerationJob" ADD CONSTRAINT "TimetableGenerationJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
