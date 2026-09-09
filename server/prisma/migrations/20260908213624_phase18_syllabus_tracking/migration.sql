-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "chapterIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "SyllabusChapter" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "curriculumSubjectId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "estimatedPeriods" INTEGER NOT NULL,
    "examWeightagePct" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyllabusChapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChapterProgress" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classSubjectId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NotStarted',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChapterProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TermSyllabusTarget" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "curriculumSubjectId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "targetChapterId" TEXT NOT NULL,
    "classId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TermSyllabusTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChapterResource" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChapterResource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyllabusChapter_schoolId_idx" ON "SyllabusChapter"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "SyllabusChapter_curriculumSubjectId_order_key" ON "SyllabusChapter"("curriculumSubjectId", "order");

-- CreateIndex
CREATE INDEX "ChapterProgress_schoolId_idx" ON "ChapterProgress"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "ChapterProgress_classSubjectId_chapterId_key" ON "ChapterProgress"("classSubjectId", "chapterId");

-- CreateIndex
CREATE INDEX "TermSyllabusTarget_schoolId_idx" ON "TermSyllabusTarget"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "TermSyllabusTarget_curriculumSubjectId_termId_classId_key" ON "TermSyllabusTarget"("curriculumSubjectId", "termId", "classId");

-- CreateIndex
CREATE INDEX "ChapterResource_schoolId_idx" ON "ChapterResource"("schoolId");

-- CreateIndex
CREATE INDEX "ChapterResource_chapterId_idx" ON "ChapterResource"("chapterId");

-- AddForeignKey
ALTER TABLE "SyllabusChapter" ADD CONSTRAINT "SyllabusChapter_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyllabusChapter" ADD CONSTRAINT "SyllabusChapter_curriculumSubjectId_fkey" FOREIGN KEY ("curriculumSubjectId") REFERENCES "CurriculumSubject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterProgress" ADD CONSTRAINT "ChapterProgress_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterProgress" ADD CONSTRAINT "ChapterProgress_classSubjectId_fkey" FOREIGN KEY ("classSubjectId") REFERENCES "ClassSubject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterProgress" ADD CONSTRAINT "ChapterProgress_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "SyllabusChapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterProgress" ADD CONSTRAINT "ChapterProgress_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermSyllabusTarget" ADD CONSTRAINT "TermSyllabusTarget_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermSyllabusTarget" ADD CONSTRAINT "TermSyllabusTarget_curriculumSubjectId_fkey" FOREIGN KEY ("curriculumSubjectId") REFERENCES "CurriculumSubject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermSyllabusTarget" ADD CONSTRAINT "TermSyllabusTarget_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermSyllabusTarget" ADD CONSTRAINT "TermSyllabusTarget_targetChapterId_fkey" FOREIGN KEY ("targetChapterId") REFERENCES "SyllabusChapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermSyllabusTarget" ADD CONSTRAINT "TermSyllabusTarget_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterResource" ADD CONSTRAINT "ChapterResource_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterResource" ADD CONSTRAINT "ChapterResource_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "SyllabusChapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterResource" ADD CONSTRAINT "ChapterResource_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterResource" ADD CONSTRAINT "ChapterResource_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
