-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN     "remarks" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "GeneratedWorksheet" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classSubjectId" TEXT NOT NULL,
    "chapterIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "pdfFileId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedWorksheet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GeneratedWorksheet_schoolId_idx" ON "GeneratedWorksheet"("schoolId");

-- CreateIndex
CREATE INDEX "GeneratedWorksheet_classSubjectId_idx" ON "GeneratedWorksheet"("classSubjectId");

-- AddForeignKey
ALTER TABLE "GeneratedWorksheet" ADD CONSTRAINT "GeneratedWorksheet_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedWorksheet" ADD CONSTRAINT "GeneratedWorksheet_classSubjectId_fkey" FOREIGN KEY ("classSubjectId") REFERENCES "ClassSubject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedWorksheet" ADD CONSTRAINT "GeneratedWorksheet_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
