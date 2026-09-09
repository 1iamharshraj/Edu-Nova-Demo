-- CreateTable
CREATE TABLE "StudentRiskSnapshot" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "classId" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attendancePct" DOUBLE PRECISION NOT NULL,
    "avgMarksPct" DOUBLE PRECISION NOT NULL,
    "homeworkOverdueCount" INTEGER NOT NULL,
    "feeOverdueAmount" DOUBLE PRECISION NOT NULL,
    "openDisciplineCaseCount" INTEGER NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "factors" JSONB NOT NULL,

    CONSTRAINT "StudentRiskSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsSettings" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "highLoadThreshold" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudentRiskSnapshot_schoolId_idx" ON "StudentRiskSnapshot"("schoolId");

-- CreateIndex
CREATE INDEX "StudentRiskSnapshot_classId_idx" ON "StudentRiskSnapshot"("classId");

-- CreateIndex
CREATE INDEX "StudentRiskSnapshot_riskLevel_idx" ON "StudentRiskSnapshot"("riskLevel");

-- CreateIndex
CREATE UNIQUE INDEX "StudentRiskSnapshot_studentId_termId_key" ON "StudentRiskSnapshot"("studentId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsSettings_schoolId_key" ON "AnalyticsSettings"("schoolId");

-- AddForeignKey
ALTER TABLE "StudentRiskSnapshot" ADD CONSTRAINT "StudentRiskSnapshot_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentRiskSnapshot" ADD CONSTRAINT "StudentRiskSnapshot_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentRiskSnapshot" ADD CONSTRAINT "StudentRiskSnapshot_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentRiskSnapshot" ADD CONSTRAINT "StudentRiskSnapshot_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsSettings" ADD CONSTRAINT "AnalyticsSettings_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
