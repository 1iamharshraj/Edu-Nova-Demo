-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "trackCohortId" TEXT;

-- CreateTable
CREATE TABLE "CohortMembership" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CohortMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceBand" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "minScore" DOUBLE PRECISION NOT NULL,
    "maxScore" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceBand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectioningTemplate" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "gradeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "scoreSource" TEXT NOT NULL,
    "subjectWeights" JSONB,
    "bandIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "distributionConfig" JSONB,
    "sectionOrder" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "respectExisting" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SectioningTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackEligibilityRule" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "trackActivityId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "subjectScoreRules" JSONB NOT NULL,
    "enforcementMode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackEligibilityRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackEligibilityException" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "trackActivityId" TEXT NOT NULL,
    "ruleId" TEXT,
    "studentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "unmetDetails" JSONB NOT NULL,
    "reason" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackEligibilityException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectioningVersion" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "scopeCohortId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "parentVersionId" TEXT,
    "summary" JSONB NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SectioningVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectioningAssignment" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "previousCohortId" TEXT,
    "band" TEXT,
    "score" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SectioningAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CohortMembership_schoolId_idx" ON "CohortMembership"("schoolId");

-- CreateIndex
CREATE INDEX "CohortMembership_studentId_idx" ON "CohortMembership"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "CohortMembership_cohortId_studentId_key" ON "CohortMembership"("cohortId", "studentId");

-- CreateIndex
CREATE INDEX "PerformanceBand_schoolId_idx" ON "PerformanceBand"("schoolId");

-- CreateIndex
CREATE INDEX "PerformanceBand_academicYearId_idx" ON "PerformanceBand"("academicYearId");

-- CreateIndex
CREATE INDEX "SectioningTemplate_schoolId_idx" ON "SectioningTemplate"("schoolId");

-- CreateIndex
CREATE INDEX "SectioningTemplate_academicYearId_idx" ON "SectioningTemplate"("academicYearId");

-- CreateIndex
CREATE INDEX "SectioningTemplate_gradeId_idx" ON "SectioningTemplate"("gradeId");

-- CreateIndex
CREATE INDEX "TrackEligibilityRule_schoolId_idx" ON "TrackEligibilityRule"("schoolId");

-- CreateIndex
CREATE INDEX "TrackEligibilityRule_trackActivityId_idx" ON "TrackEligibilityRule"("trackActivityId");

-- CreateIndex
CREATE INDEX "TrackEligibilityException_schoolId_idx" ON "TrackEligibilityException"("schoolId");

-- CreateIndex
CREATE INDEX "TrackEligibilityException_trackActivityId_idx" ON "TrackEligibilityException"("trackActivityId");

-- CreateIndex
CREATE INDEX "TrackEligibilityException_studentId_idx" ON "TrackEligibilityException"("studentId");

-- CreateIndex
CREATE INDEX "SectioningVersion_schoolId_idx" ON "SectioningVersion"("schoolId");

-- CreateIndex
CREATE INDEX "SectioningVersion_templateId_idx" ON "SectioningVersion"("templateId");

-- CreateIndex
CREATE INDEX "SectioningAssignment_versionId_idx" ON "SectioningAssignment"("versionId");

-- CreateIndex
CREATE INDEX "SectioningAssignment_schoolId_idx" ON "SectioningAssignment"("schoolId");

-- CreateIndex
CREATE INDEX "SectioningAssignment_studentId_idx" ON "SectioningAssignment"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "SectioningAssignment_versionId_studentId_key" ON "SectioningAssignment"("versionId", "studentId");

-- AddForeignKey
ALTER TABLE "CohortMembership" ADD CONSTRAINT "CohortMembership_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CohortMembership" ADD CONSTRAINT "CohortMembership_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CohortMembership" ADD CONSTRAINT "CohortMembership_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_trackCohortId_fkey" FOREIGN KEY ("trackCohortId") REFERENCES "Cohort"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceBand" ADD CONSTRAINT "PerformanceBand_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceBand" ADD CONSTRAINT "PerformanceBand_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectioningTemplate" ADD CONSTRAINT "SectioningTemplate_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectioningTemplate" ADD CONSTRAINT "SectioningTemplate_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectioningTemplate" ADD CONSTRAINT "SectioningTemplate_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackEligibilityRule" ADD CONSTRAINT "TrackEligibilityRule_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackEligibilityRule" ADD CONSTRAINT "TrackEligibilityRule_trackActivityId_fkey" FOREIGN KEY ("trackActivityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackEligibilityException" ADD CONSTRAINT "TrackEligibilityException_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackEligibilityException" ADD CONSTRAINT "TrackEligibilityException_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackEligibilityException" ADD CONSTRAINT "TrackEligibilityException_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectioningVersion" ADD CONSTRAINT "SectioningVersion_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectioningVersion" ADD CONSTRAINT "SectioningVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "SectioningTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectioningVersion" ADD CONSTRAINT "SectioningVersion_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectioningVersion" ADD CONSTRAINT "SectioningVersion_parentVersionId_fkey" FOREIGN KEY ("parentVersionId") REFERENCES "SectioningVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectioningVersion" ADD CONSTRAINT "SectioningVersion_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectioningAssignment" ADD CONSTRAINT "SectioningAssignment_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "SectioningVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectioningAssignment" ADD CONSTRAINT "SectioningAssignment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectioningAssignment" ADD CONSTRAINT "SectioningAssignment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectioningAssignment" ADD CONSTRAINT "SectioningAssignment_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;
