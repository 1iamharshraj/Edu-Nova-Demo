-- CreateTable
CREATE TABLE "ExamSeatingPlan" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "assessmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "date" DATE NOT NULL,
    "roomId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedById" TEXT,

    CONSTRAINT "ExamSeatingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamSeat" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "seatNumber" INTEGER NOT NULL,
    "assessmentId" TEXT NOT NULL,

    CONSTRAINT "ExamSeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvigilationDuty" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Assigned',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvigilationDuty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExamSeatingPlan_schoolId_date_idx" ON "ExamSeatingPlan"("schoolId", "date");

-- CreateIndex
CREATE INDEX "ExamSeatingPlan_roomId_idx" ON "ExamSeatingPlan"("roomId");

-- CreateIndex
CREATE INDEX "ExamSeat_planId_idx" ON "ExamSeat"("planId");

-- CreateIndex
CREATE INDEX "ExamSeat_studentId_idx" ON "ExamSeat"("studentId");

-- CreateIndex
CREATE INDEX "ExamSeat_assessmentId_idx" ON "ExamSeat"("assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamSeat_planId_seatNumber_key" ON "ExamSeat"("planId", "seatNumber");

-- CreateIndex
CREATE INDEX "InvigilationDuty_schoolId_date_idx" ON "InvigilationDuty"("schoolId", "date");

-- CreateIndex
CREATE INDEX "InvigilationDuty_teacherId_idx" ON "InvigilationDuty"("teacherId");

-- CreateIndex
CREATE INDEX "InvigilationDuty_assessmentId_idx" ON "InvigilationDuty"("assessmentId");

-- CreateIndex
CREATE INDEX "InvigilationDuty_roomId_idx" ON "InvigilationDuty"("roomId");

-- AddForeignKey
ALTER TABLE "ExamSeatingPlan" ADD CONSTRAINT "ExamSeatingPlan_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSeatingPlan" ADD CONSTRAINT "ExamSeatingPlan_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSeatingPlan" ADD CONSTRAINT "ExamSeatingPlan_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSeat" ADD CONSTRAINT "ExamSeat_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ExamSeatingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSeat" ADD CONSTRAINT "ExamSeat_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSeat" ADD CONSTRAINT "ExamSeat_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvigilationDuty" ADD CONSTRAINT "InvigilationDuty_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvigilationDuty" ADD CONSTRAINT "InvigilationDuty_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvigilationDuty" ADD CONSTRAINT "InvigilationDuty_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvigilationDuty" ADD CONSTRAINT "InvigilationDuty_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
