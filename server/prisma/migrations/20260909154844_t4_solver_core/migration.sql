-- CreateTable
CREATE TABLE "TeachingRequirement" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "requiredPeriodsPerWeek" INTEGER NOT NULL,
    "sessionDuration" TEXT NOT NULL DEFAULT 'SINGLE',
    "roomRequirement" TEXT NOT NULL DEFAULT 'ANY',
    "specificRoomId" TEXT,
    "labDoubleAllowed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeachingRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeachingAssignment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "teachingRequirementId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "assignmentMode" TEXT NOT NULL DEFAULT 'FIXED',
    "selectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "TeachingAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Constraint" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'SCHOOL',
    "scopeId" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'HARD',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "source" TEXT NOT NULL DEFAULT 'SYSTEM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Constraint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeachingRequirement_schoolId_idx" ON "TeachingRequirement"("schoolId");

-- CreateIndex
CREATE INDEX "TeachingRequirement_cohortId_idx" ON "TeachingRequirement"("cohortId");

-- CreateIndex
CREATE UNIQUE INDEX "TeachingRequirement_cohortId_subjectId_key" ON "TeachingRequirement"("cohortId", "subjectId");

-- CreateIndex
CREATE INDEX "TeachingAssignment_schoolId_idx" ON "TeachingAssignment"("schoolId");

-- CreateIndex
CREATE INDEX "TeachingAssignment_teacherId_idx" ON "TeachingAssignment"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "TeachingAssignment_teachingRequirementId_key" ON "TeachingAssignment"("teachingRequirementId");

-- CreateIndex
CREATE INDEX "Constraint_schoolId_idx" ON "Constraint"("schoolId");

-- CreateIndex
CREATE INDEX "Constraint_schoolId_type_idx" ON "Constraint"("schoolId", "type");

-- AddForeignKey
ALTER TABLE "TeachingRequirement" ADD CONSTRAINT "TeachingRequirement_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingRequirement" ADD CONSTRAINT "TeachingRequirement_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingRequirement" ADD CONSTRAINT "TeachingRequirement_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingRequirement" ADD CONSTRAINT "TeachingRequirement_specificRoomId_fkey" FOREIGN KEY ("specificRoomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingAssignment" ADD CONSTRAINT "TeachingAssignment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingAssignment" ADD CONSTRAINT "TeachingAssignment_teachingRequirementId_fkey" FOREIGN KEY ("teachingRequirementId") REFERENCES "TeachingRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingAssignment" ADD CONSTRAINT "TeachingAssignment_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Constraint" ADD CONSTRAINT "Constraint_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
