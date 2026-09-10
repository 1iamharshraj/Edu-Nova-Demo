-- AlterTable
ALTER TABLE "TeachingRequirement" ADD COLUMN     "assignmentMode" TEXT NOT NULL DEFAULT 'FIXED';

-- CreateTable
CREATE TABLE "TeachingAssignmentPool" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "teachingRequirementId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeachingAssignmentPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherAvailability" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "periodIdx" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeacherAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Preference" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Preference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreferenceProfile" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "weightOverrides" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreferenceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeachingAssignmentPool_schoolId_idx" ON "TeachingAssignmentPool"("schoolId");

-- CreateIndex
CREATE INDEX "TeachingAssignmentPool_teachingRequirementId_idx" ON "TeachingAssignmentPool"("teachingRequirementId");

-- CreateIndex
CREATE UNIQUE INDEX "TeachingAssignmentPool_teachingRequirementId_teacherId_key" ON "TeachingAssignmentPool"("teachingRequirementId", "teacherId");

-- CreateIndex
CREATE INDEX "TeacherAvailability_schoolId_idx" ON "TeacherAvailability"("schoolId");

-- CreateIndex
CREATE INDEX "TeacherAvailability_teacherId_idx" ON "TeacherAvailability"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherAvailability_teacherId_dayOfWeek_periodIdx_key" ON "TeacherAvailability"("teacherId", "dayOfWeek", "periodIdx");

-- CreateIndex
CREATE INDEX "Preference_schoolId_idx" ON "Preference"("schoolId");

-- CreateIndex
CREATE INDEX "Preference_schoolId_scope_idx" ON "Preference"("schoolId", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "Preference_schoolId_type_key" ON "Preference"("schoolId", "type");

-- CreateIndex
CREATE INDEX "PreferenceProfile_schoolId_idx" ON "PreferenceProfile"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "PreferenceProfile_schoolId_name_key" ON "PreferenceProfile"("schoolId", "name");

-- AddForeignKey
ALTER TABLE "TeachingAssignmentPool" ADD CONSTRAINT "TeachingAssignmentPool_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingAssignmentPool" ADD CONSTRAINT "TeachingAssignmentPool_teachingRequirementId_fkey" FOREIGN KEY ("teachingRequirementId") REFERENCES "TeachingRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingAssignmentPool" ADD CONSTRAINT "TeachingAssignmentPool_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherAvailability" ADD CONSTRAINT "TeacherAvailability_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherAvailability" ADD CONSTRAINT "TeacherAvailability_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preference" ADD CONSTRAINT "Preference_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferenceProfile" ADD CONSTRAINT "PreferenceProfile_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
