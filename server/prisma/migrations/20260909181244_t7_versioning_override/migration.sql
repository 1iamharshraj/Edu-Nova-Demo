-- AlterTable
ALTER TABLE "TimetableEntry" ADD COLUMN     "timetableVersionId" TEXT;

-- CreateTable
CREATE TABLE "TimetableVersion" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "scopeCohortIds" JSONB NOT NULL DEFAULT '[]',
    "scopeClassIds" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "parentVersionId" TEXT,
    "generationJobId" TEXT,
    "changeReason" TEXT,
    "entries" JSONB NOT NULL,
    "diffFromParent" JSONB,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimetableVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimetableLock" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "timetableVersionId" TEXT NOT NULL,
    "lockType" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "dayOfWeek" INTEGER,
    "periodIdx" INTEGER,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "releasedById" TEXT,

    CONSTRAINT "TimetableLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimetableEditEvent" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "timetableVersionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undone" BOOLEAN NOT NULL DEFAULT false,
    "undoneAt" TIMESTAMP(3),

    CONSTRAINT "TimetableEditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimetableVersion_schoolId_termId_idx" ON "TimetableVersion"("schoolId", "termId");

-- CreateIndex
CREATE INDEX "TimetableVersion_schoolId_status_idx" ON "TimetableVersion"("schoolId", "status");

-- CreateIndex
CREATE INDEX "TimetableVersion_parentVersionId_idx" ON "TimetableVersion"("parentVersionId");

-- CreateIndex
CREATE INDEX "TimetableVersion_generationJobId_idx" ON "TimetableVersion"("generationJobId");

-- CreateIndex
CREATE INDEX "TimetableLock_schoolId_timetableVersionId_idx" ON "TimetableLock"("schoolId", "timetableVersionId");

-- CreateIndex
CREATE INDEX "TimetableLock_timetableVersionId_lockType_idx" ON "TimetableLock"("timetableVersionId", "lockType");

-- CreateIndex
CREATE INDEX "TimetableEditEvent_schoolId_timetableVersionId_idx" ON "TimetableEditEvent"("schoolId", "timetableVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "TimetableEditEvent_timetableVersionId_seq_key" ON "TimetableEditEvent"("timetableVersionId", "seq");

-- CreateIndex
CREATE INDEX "TimetableEntry_timetableVersionId_idx" ON "TimetableEntry"("timetableVersionId");

-- AddForeignKey
ALTER TABLE "TimetableEntry" ADD CONSTRAINT "TimetableEntry_timetableVersionId_fkey" FOREIGN KEY ("timetableVersionId") REFERENCES "TimetableVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableVersion" ADD CONSTRAINT "TimetableVersion_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableVersion" ADD CONSTRAINT "TimetableVersion_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableVersion" ADD CONSTRAINT "TimetableVersion_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableVersion" ADD CONSTRAINT "TimetableVersion_parentVersionId_fkey" FOREIGN KEY ("parentVersionId") REFERENCES "TimetableVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableVersion" ADD CONSTRAINT "TimetableVersion_generationJobId_fkey" FOREIGN KEY ("generationJobId") REFERENCES "TimetableGenerationJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableVersion" ADD CONSTRAINT "TimetableVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableLock" ADD CONSTRAINT "TimetableLock_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableLock" ADD CONSTRAINT "TimetableLock_timetableVersionId_fkey" FOREIGN KEY ("timetableVersionId") REFERENCES "TimetableVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableLock" ADD CONSTRAINT "TimetableLock_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableEditEvent" ADD CONSTRAINT "TimetableEditEvent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableEditEvent" ADD CONSTRAINT "TimetableEditEvent_timetableVersionId_fkey" FOREIGN KEY ("timetableVersionId") REFERENCES "TimetableVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableEditEvent" ADD CONSTRAINT "TimetableEditEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
